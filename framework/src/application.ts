/*
 * Copyright © 2019 Lisk Foundation
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Unless otherwise agreed in a custom licensing agreement with the Lisk Foundation,
 * no part of this software, including this file, may be copied, modified,
 * propagated, or distributed except according to the terms contained in the
 * LICENSE file.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as psList from 'ps-list';
import * as assert from 'assert';
import { promisify } from 'util';
import { KVStore } from '@liskhq/lisk-db';
import { validator, LiskValidationError } from '@liskhq/lisk-validator';
import { objects, jobHandlers } from '@liskhq/lisk-utils';
import {
	APP_EVENT_BLOCK_NEW,
	APP_EVENT_CHAIN_FORK,
	APP_EVENT_SHUTDOWN,
	APP_EVENT_READY,
	APP_IDENTIFIER,
	APP_EVENT_NETWORK_EVENT,
	APP_EVENT_TRANSACTION_NEW,
	APP_EVENT_BLOCK_DELETE,
	APP_EVENT_CHAIN_VALIDATORS_CHANGE,
	APP_EVENT_NETWORK_READY,
} from './constants';

import {
	BasePlugin,
	getPluginExportPath,
	InstantiablePlugin,
	validatePluginSpec,
} from './plugins/base_plugin';
import { systemDirs } from './system_dirs';
import { Controller, InMemoryChannel } from './controller';
import { applicationConfigSchema } from './schema';
import { Node } from './node';
import { Logger, createLogger } from './logger';

import { DuplicateAppInstanceError } from './errors';

import {
	ApplicationConfig,
	GenesisConfig,
	EventPostTransactionData,
	PluginOptions,
	RegisteredSchema,
	RegisteredModule,
	UpdateForgingStatusInput,
	PartialApplicationConfig,
	PluginOptionsWithAppConfig,
	AppConfigForPlugin,
} from './types';
import { BaseModule, TokenModule, SequenceModule, KeysModule, DPoSModule } from './modules';

const MINIMUM_EXTERNAL_MODULE_ID = 1000;
// eslint-disable-next-line @typescript-eslint/no-misused-promises
const rm = promisify(fs.unlink);

const isPidRunning = async (pid: number): Promise<boolean> =>
	psList().then(list => list.some(x => x.pid === pid));

const registerProcessHooks = (app: Application): void => {
	const handleShutdown = async (code: number, message: string) => {
		await app.shutdown(code, message);
	};

	process.title = `${app.config.label}(${app.config.version})`;

	process.on('uncaughtException', err => {
		// Handle error safely
		app.logger.error(
			{
				err,
			},
			'System error: uncaughtException',
		);

		handleShutdown(1, err.message).catch((error: Error) => app.logger.error({ error }));
	});

	process.on('unhandledRejection', err => {
		// Handle error safely
		app.logger.fatal(
			{
				err,
			},
			'System error: unhandledRejection',
		);

		handleShutdown(1, (err as Error).message).catch((error: Error) => app.logger.error({ error }));
	});

	process.once('SIGTERM', () => {
		handleShutdown(0, 'SIGTERM').catch((error: Error) => app.logger.error({ error }));
	});

	process.once('SIGINT', () => {
		handleShutdown(0, 'SIGINT').catch((error: Error) => app.logger.error({ error }));
	});

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	process.once('exit' as any, (code: number) => {
		handleShutdown(code, 'process.exit').catch((error: Error) => app.logger.error({ error }));
	});
};

type InstantiableBaseModule = new (genesisConfig: GenesisConfig) => BaseModule;

export class Application {
	public config: ApplicationConfig;
	public logger!: Logger;

	private readonly _node: Node;
	private _controller!: Controller;
	private _plugins: { [key: string]: InstantiablePlugin };
	private _channel!: InMemoryChannel;

	private readonly _genesisBlock: Record<string, unknown>;
	private _blockchainDB!: KVStore;
	private _nodeDB!: KVStore;
	private _forgerDB!: KVStore;

	private readonly _mutex = new jobHandlers.Mutex();

	public constructor(genesisBlock: Record<string, unknown>, config: PartialApplicationConfig = {}) {
		// Don't change the object parameters provided
		this._genesisBlock = genesisBlock;
		const appConfig = objects.cloneDeep(applicationConfigSchema.default);

		appConfig.label =
			// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
			config.label ?? `lisk-${config.genesisConfig?.communityIdentifier}`;

		const mergedConfig = objects.mergeDeep({}, appConfig, config) as ApplicationConfig;
		const applicationConfigErrors = validator.validate(applicationConfigSchema, mergedConfig);
		if (applicationConfigErrors.length) {
			throw new LiskValidationError(applicationConfigErrors);
		}
		this.config = mergedConfig;

		// Private members
		this._plugins = {};
		// Initialize node
		const { plugins, ...rootConfigs } = this.config;
		this._node = new Node({
			genesisBlockJSON: this._genesisBlock,
			options: rootConfigs,
		});
	}

	public get networkIdentifier(): Buffer {
		return this._node.networkIdentifier;
	}

	public static getDefaultModules(): typeof BaseModule[] {
		return [TokenModule, SequenceModule, KeysModule, DPoSModule];
	}

	public static defaultApplication(
		genesisBlock: Record<string, unknown>,
		config: PartialApplicationConfig = {},
	): Application {
		const application = new Application(genesisBlock, config);
		for (const Module of Application.getDefaultModules()) {
			application._registerModule(Module);
		}

		return application;
	}

	public registerPlugin<T extends BasePlugin>(
		pluginKlass: InstantiablePlugin<T>,
		options: PluginOptions = { loadAsChildProcess: false },
	): void {
		assert(pluginKlass, 'Plugin implementation is required');
		assert(typeof options === 'object', 'Plugin options must be provided or set to empty object.');

		const pluginAlias = options?.alias ?? pluginKlass.alias;

		assert(
			!Object.keys(this._plugins).includes(pluginAlias),
			`A plugin with alias "${pluginAlias}" already registered.`,
		);

		if (options.loadAsChildProcess) {
			if (!getPluginExportPath(pluginKlass)) {
				throw new Error(
					`Unable to register plugin "${pluginAlias}" to load as child process. \n -> To load plugin as child process it must be exported. \n -> You can specify npm package as "info.name". \n -> Or you can specify any static path as "info.exportPath". \n -> To fix this issue you can simply assign __filename to info.exportPath in your plugin.`,
				);
			}
		}

		this.config.plugins[pluginAlias] = Object.assign(
			this.config.plugins[pluginAlias] ?? {},
			options,
		);

		validatePluginSpec(pluginKlass, this.config.plugins[pluginAlias]);

		this._plugins[pluginAlias] = pluginKlass;
	}

	public overridePluginOptions(alias: string, options?: PluginOptions): void {
		assert(Object.keys(this._plugins).includes(alias), `No plugin ${alias} is registered`);
		this.config.plugins[alias] = {
			...this.config.plugins[alias],
			...options,
		};
	}

	public registerModule(Module: typeof BaseModule): void {
		this._registerModule(Module, true);
	}

	public getSchema(): RegisteredSchema {
		return this._node.getSchema();
	}

	public getDefaultAccount(): Record<string, unknown> {
		return this._node.getDefaultAccount();
	}

	public getRegisteredModules(): RegisteredModule[] {
		return this._node.getRegisteredModules();
	}

	public async run(): Promise<void> {
		Object.freeze(this._genesisBlock);
		Object.freeze(this.config);

		registerProcessHooks(this);

		// Initialize directories
		await this._setupDirectories();

		// Initialize logger
		this.logger = this._initLogger();
		this.logger.info(`Starting the app - ${this.config.label}`);
		this.logger.info(
			'If you experience any type of error, please open an issue on Lisk GitHub: https://github.com/LiskHQ/lisk-sdk/issues',
		);
		this.logger.info(
			'Contribution guidelines can be found at Lisk-sdk: https://github.com/LiskHQ/lisk-sdk/blob/development/docs/CONTRIBUTING.md',
		);
		this.logger.info(`Booting the application with Lisk Framework(${this.config.version})`);

		// Validate the instance
		await this._validatePidFile();

		// Initialize database instances
		this._forgerDB = this._getDBInstance(this.config, 'forger.db');
		this._blockchainDB = this._getDBInstance(this.config, 'blockchain.db');
		this._nodeDB = this._getDBInstance(this.config, 'node.db');

		await this._mutex.runExclusive<void>(async () => {
			// Initialize all objects
			this._channel = this._initChannel();

			this._controller = this._initController();

			await this._controller.load();

			await this._node.init({
				bus: this._controller.bus,
				channel: this._channel,
				forgerDB: this._forgerDB,
				blockchainDB: this._blockchainDB,
				nodeDB: this._nodeDB,
				logger: this.logger,
			});

			await this._loadPlugins();
			this.logger.debug(this._controller.bus.getEvents(), 'Application listening to events');
			this.logger.debug(this._controller.bus.getActions(), 'Application ready for actions');

			this._channel.publish(APP_EVENT_READY);
		});
	}

	public async shutdown(errorCode = 0, message = ''): Promise<void> {
		this.logger.info({ errorCode, message }, 'Application shutdown started');
		// See if we can acquire mutex meant app is still loading or not
		const release = await this._mutex.acquire();

		try {
			this._channel.publish(APP_EVENT_SHUTDOWN);
			await this._node.cleanup();
			await this._controller.cleanup(errorCode, message);
			await this._blockchainDB.close();
			await this._forgerDB.close();
			await this._nodeDB.close();
			await this._emptySocketsDirectory();
			this._clearControllerPidFile();
			this.logger.info({ errorCode, message }, 'Application shutdown completed');
		} catch (error) {
			this.logger.fatal({ err: error as Error }, 'Application shutdown failed');
		} finally {
			// Unfreeze the configuration
			this.config = objects.mergeDeep({}, this.config) as ApplicationConfig;
			release();

			// To avoid redundant shutdown call
			process.removeAllListeners('exit');
			process.exit(errorCode);
		}
	}

	// --------------------------------------
	// Private
	// --------------------------------------

	private _registerModule(Module: typeof BaseModule, validateModuleID = false): void {
		assert(Module, 'Module implementation is required');
		const InstantiableModule = Module as InstantiableBaseModule;
		const moduleInstance = new InstantiableModule(this.config.genesisConfig);

		if (Application.getDefaultModules().includes(Module)) {
			this._node.registerModule(moduleInstance);
		} else if (validateModuleID && moduleInstance.id < MINIMUM_EXTERNAL_MODULE_ID) {
			throw new Error(
				`Custom module must have id greater than or equal to ${MINIMUM_EXTERNAL_MODULE_ID}`,
			);
		} else {
			this._node.registerModule(moduleInstance);
		}
	}

	private async _loadPlugins(): Promise<void> {
		const dirs = systemDirs(this.config.label, this.config.rootPath);
		const pluginOptions: { [key: string]: PluginOptionsWithAppConfig } = {};

		const appConfigForPlugin: AppConfigForPlugin = {
			version: this.config.version,
			networkVersion: this.config.networkVersion,
			genesisConfig: this.config.genesisConfig,
			logger: {
				consoleLogLevel: this.config.logger.consoleLogLevel,
				fileLogLevel: this.config.logger.fileLogLevel,
			},
			rootPath: this.config.rootPath,
			label: this.config.label,
		};

		Object.keys(this._plugins).forEach(alias => {
			pluginOptions[alias] = {
				...this.config.plugins[alias],
				// TODO: Remove data path from here and use from appConfig later on
				dataPath: dirs.dataPath,
				appConfig: appConfigForPlugin,
			};
		});

		await this._controller.loadPlugins(this._plugins, pluginOptions);
	}

	private _initLogger(): Logger {
		const dirs = systemDirs(this.config.label, this.config.rootPath);
		return createLogger({
			...this.config.logger,
			logFilePath: path.join(dirs.logs, this.config.logger.logFileName),
			module: 'lisk:app',
		});
	}

	private _initChannel(): InMemoryChannel {
		/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
		/* eslint-disable @typescript-eslint/explicit-function-return-type */
		return new InMemoryChannel(
			APP_IDENTIFIER,
			[
				APP_EVENT_READY.replace('app:', ''),
				APP_EVENT_SHUTDOWN.replace('app:', ''),
				APP_EVENT_NETWORK_EVENT.replace('app:', ''),
				APP_EVENT_NETWORK_READY.replace('app:', ''),
				APP_EVENT_TRANSACTION_NEW.replace('app:', ''),
				APP_EVENT_CHAIN_FORK.replace('app:', ''),
				APP_EVENT_CHAIN_VALIDATORS_CHANGE.replace('app:', ''),
				APP_EVENT_BLOCK_NEW.replace('app:', ''),
				APP_EVENT_BLOCK_DELETE.replace('app:', ''),
			],
			{
				getConnectedPeers: {
					handler: () => this._node.actions.getConnectedPeers(),
				},
				getDisconnectedPeers: {
					handler: () => this._node.actions.getDisconnectedPeers(),
				},
				getNetworkStats: {
					handler: () => this._node.actions.getNetworkStats(),
				},
				getForgers: {
					handler: async () => this._node.actions.getValidators(),
				},
				updateForgingStatus: {
					handler: async (params?: Record<string, unknown>) =>
						this._node.actions.updateForgingStatus((params as unknown) as UpdateForgingStatusInput),
				},
				getForgingStatus: {
					handler: async () => this._node.actions.getForgingStatus(),
				},
				getTransactionsFromPool: {
					handler: () => this._node.actions.getTransactionsFromPool(),
				},
				postTransaction: {
					handler: async (params?: Record<string, unknown>) =>
						this._node.actions.postTransaction((params as unknown) as EventPostTransactionData),
				},
				getLastBlock: {
					handler: () => this._node.actions.getLastBlock(),
				},
				getAccount: {
					handler: async (params?: Record<string, unknown>) =>
						this._node.actions.getAccount(params as { address: string }),
				},
				getAccounts: {
					handler: async (params?: Record<string, unknown>) =>
						this._node.actions.getAccounts(params as { address: readonly string[] }),
				},
				getBlockByID: {
					handler: async (params?: Record<string, unknown>) =>
						this._node.actions.getBlockByID(params as { id: string }),
				},
				getBlocksByIDs: {
					handler: async (params?: Record<string, unknown>) =>
						this._node.actions.getBlocksByIDs(params as { ids: readonly string[] }),
				},
				getBlockByHeight: {
					handler: async (params?: Record<string, unknown>) =>
						this._node.actions.getBlockByHeight(params as { height: number }),
				},
				getBlocksByHeightBetween: {
					handler: async (params?: Record<string, unknown>) =>
						this._node.actions.getBlocksByHeightBetween(params as { from: number; to: number }),
				},
				getTransactionByID: {
					handler: async (params?: Record<string, unknown>) =>
						this._node.actions.getTransactionByID(params as { id: string }),
				},
				getTransactionsByIDs: {
					handler: async (params?: Record<string, unknown>) =>
						this._node.actions.getTransactionsByIDs(params as { ids: readonly string[] }),
				},
				getSchema: {
					handler: () => this._node.actions.getSchema(),
				},
				getRegisteredModules: {
					handler: () => this._node.actions.getRegisteredModules(),
				},
				getNodeInfo: {
					handler: () => this._node.actions.getNodeInfo(),
				},
				getRegisteredActions: {
					handler: () => this._controller.bus.getActions(),
				},
				getRegisteredEvents: {
					handler: () => this._controller.bus.getEvents(),
				},
			},
			{ skipInternalEvents: true },
		);
		/* eslint-enable @typescript-eslint/explicit-module-boundary-types */
		/* eslint-enable @typescript-eslint/explicit-function-return-type */
	}

	private _initController(): Controller {
		return new Controller({
			appLabel: this.config.label,
			config: {
				rootPath: this.config.rootPath,
				rpc: this.config.rpc,
			},
			logger: this.logger,
			channel: this._channel,
		});
	}

	private async _setupDirectories(): Promise<void> {
		const dirs = systemDirs(this.config.label, this.config.rootPath);
		await Promise.all(Array.from(Object.values(dirs)).map(async dirPath => fs.ensureDir(dirPath)));
	}

	private async _emptySocketsDirectory(): Promise<void> {
		const { sockets } = systemDirs(this.config.label, this.config.rootPath);
		const socketFiles = fs.readdirSync(sockets);

		await Promise.all(socketFiles.map(async aSocketFile => rm(path.join(sockets, aSocketFile))));
	}

	private async _validatePidFile(): Promise<void> {
		const dirs = systemDirs(this.config.label, this.config.rootPath);
		const pidPath = path.join(dirs.pids, 'controller.pid');
		const pidExists = await fs.pathExists(pidPath);
		if (pidExists) {
			const pid = parseInt((await fs.readFile(pidPath)).toString(), 10);
			const pidRunning = await isPidRunning(pid);

			this.logger.info({ pid }, 'Previous Lisk PID');
			this.logger.info({ pid: process.pid }, 'Current Lisk PID');

			if (pidRunning && pid !== process.pid) {
				this.logger.error(
					{ appLabel: this.config.label },
					'An instance of application is already running, please change the application label to run another instance',
				);
				throw new DuplicateAppInstanceError(this.config.label, pidPath);
			}
		}
		await fs.writeFile(pidPath, process.pid.toString());
	}

	private _clearControllerPidFile() {
		const dirs = systemDirs(this.config.label, this.config.rootPath);
		fs.unlinkSync(path.join(dirs.pids, 'controller.pid'));
	}

	private _getDBInstance(options: ApplicationConfig, dbName: string): KVStore {
		const dirs = systemDirs(options.label, options.rootPath);
		const dbPath = `${dirs.data}/${dbName}`;
		this.logger.debug({ dbName, dbPath }, 'Create database instance.');
		return new KVStore(dbPath);
	}
}
