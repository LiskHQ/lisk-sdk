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

import {
	Chain,
	events as chainEvents,
	GenesisBlock,
	Block,
	blockSchema,
	blockHeaderSchema,
	Account,
	AccountSchema,
	readGenesisBlockJSON,
	Transaction,
	transactionSchema,
	getAccountSchemaWithDefault,
	getRegisteredBlockAssetSchema,
	AccountDefaultProps,
} from '@liskhq/lisk-chain';
import { EVENT_BFT_BLOCK_FINALIZED, BFT } from '@liskhq/lisk-bft';
import { getNetworkIdentifier } from '@liskhq/lisk-cryptography';
import { TransactionPool, events as txPoolEvents } from '@liskhq/lisk-transaction-pool';
import { KVStore, NotFoundError } from '@liskhq/lisk-db';
import { jobHandlers } from '@liskhq/lisk-utils';
import {
	APP_EVENT_BLOCK_DELETE,
	APP_EVENT_BLOCK_NEW,
	APP_EVENT_CHAIN_VALIDATORS_CHANGE,
	APP_EVENT_NETWORK_EVENT,
	APP_EVENT_NETWORK_READY,
} from '../constants';

import { Forger } from './forger';
import { Transport, handlePostTransactionReturn } from './transport';
import {
	Synchronizer,
	BlockSynchronizationMechanism,
	FastChainSwitchingMechanism,
} from './synchronizer';
import { Processor } from './processor';
import { Logger } from '../logger';
import {
	ApplicationConfig,
	EventPostTransactionData,
	ForgingStatus,
	RegisteredModule,
	RegisteredSchema,
	UpdateForgingStatusInput,
} from '../types';
import { InMemoryChannel } from '../controller/channels';
import { ActionsDefinition } from '../controller/action';
import {
	EVENT_PROCESSOR_BROADCAST_BLOCK,
	EVENT_PROCESSOR_SYNC_REQUIRED,
} from './processor/processor';
import { EVENT_SYNCHRONIZER_SYNC_REQUIRED } from './synchronizer/base_synchronizer';
import { Network } from './network';
import { BaseAsset, BaseModule } from '../modules';
import { Bus } from '../controller/bus';

const forgeInterval = 1000;
const { EVENT_NEW_BLOCK, EVENT_DELETE_BLOCK, EVENT_VALIDATORS_CHANGED } = chainEvents;
const { EVENT_TRANSACTION_REMOVED } = txPoolEvents;
const MINIMUM_MODULE_ID = 2;

export type NodeOptions = Omit<ApplicationConfig, 'plugins'>;

interface NodeConstructor {
	readonly genesisBlockJSON: Record<string, unknown>;
	readonly options: NodeOptions;
}

interface NodeInitInput {
	readonly logger: Logger;
	readonly channel: InMemoryChannel;
	readonly forgerDB: KVStore;
	readonly blockchainDB: KVStore;
	readonly nodeDB: KVStore;
	readonly bus: Bus;
}

interface ForgingStatusResponse extends Omit<ForgingStatus, 'address'> {
	readonly address: string;
}

export class Node {
	private readonly _options: NodeOptions;
	private readonly _registeredModules: BaseModule[] = [];
	private readonly _genesisBlockJSON: Record<string, unknown>;
	private _bus!: Bus;
	private _channel!: InMemoryChannel;
	private _logger!: Logger;
	private _nodeDB!: KVStore;
	private _forgerDB!: KVStore;
	private _blockchainDB!: KVStore;
	private _networkIdentifier!: Buffer;
	private _genesisBlock!: GenesisBlock;
	private _registeredAccountSchemas: { [moduleName: string]: AccountSchema } = {};
	private _networkModule!: Network;
	private _chain!: Chain;
	private _bft!: BFT;
	private _processor!: Processor;
	private _synchronizer!: Synchronizer;
	private _transactionPool!: TransactionPool;
	private _transport!: Transport;
	private _forger!: Forger;
	private _forgingJob!: jobHandlers.Scheduler<void>;

	public constructor({ options, genesisBlockJSON }: NodeConstructor) {
		this._options = options;
		this._genesisBlockJSON = genesisBlockJSON;
		if (this._options.forging.waitThreshold >= this._options.genesisConfig.blockTime) {
			throw Error(
				`forging.waitThreshold=${this._options.forging.waitThreshold} is greater or equal to genesisConfig.blockTime=${this._options.genesisConfig.blockTime}. It impacts the forging and propagation of blocks. Please use a smaller value for forging.waitThreshold`,
			);
		}
	}

	public getSchema(): RegisteredSchema {
		const transactionsAssets: RegisteredSchema['transactionsAssets'] = [];
		for (const customModule of this._registeredModules) {
			for (const customAsset of customModule.transactionAssets) {
				transactionsAssets.push({
					moduleID: customModule.id,
					moduleName: customModule.name,
					assetID: customAsset.id,
					assetName: customAsset.name,
					schema: customAsset.schema,
				});
			}
		}
		const { default: defaultAccount, ...accountSchema } = getAccountSchemaWithDefault(
			this._registeredAccountSchemas,
		);
		const blockHeadersAssets = getRegisteredBlockAssetSchema(accountSchema);
		return {
			account: accountSchema,
			block: blockSchema,
			blockHeader: blockHeaderSchema,
			blockHeadersAssets,
			transaction: transactionSchema,
			transactionsAssets,
		};
	}

	public getDefaultAccount(): Record<string, unknown> {
		const { default: defaultAccount } = getAccountSchemaWithDefault(this._registeredAccountSchemas);
		return defaultAccount;
	}

	public getRegisteredModules(): RegisteredModule[] {
		return this._registeredModules.reduce<RegisteredModule[]>((prev, current) => {
			const assets = current.transactionAssets.map(asset => ({ id: asset.id, name: asset.name }));
			prev.push({
				id: current.id,
				name: current.name,
				actions: Object.keys(current.actions).map(key => `${current.name}:${key}`),
				events: current.events.map(key => `${current.name}:${key}`),
				reducers: Object.keys(current.reducers).map(key => `${current.name}:${key}`),
				transactionAssets: assets,
			});
			return prev;
		}, []);
	}

	public registerModule(customModule: BaseModule): void {
		const exist = this._registeredModules.find(rm => rm.id === customModule.id);
		if (exist) {
			throw new Error(`Custom module with id ${customModule.id} already exists.`);
		}

		if (!customModule.name || !customModule.id) {
			throw new Error(
				`Custom module '${customModule.constructor.name}' is missing either one or both of the required properties: 'id', 'name'.`,
			);
		}

		if (customModule.id < MINIMUM_MODULE_ID) {
			throw new Error(`Custom module must have id greater than ${MINIMUM_MODULE_ID}.`);
		}
		if (customModule.accountSchema) {
			this._registeredAccountSchemas[customModule.name] = {
				...customModule.accountSchema,
				fieldNumber: customModule.id,
			};
		}

		for (const asset of customModule.transactionAssets) {
			if (!(asset instanceof BaseAsset)) {
				throw new Error('Custom module contains asset which does not extend `BaseAsset` class.');
			}

			if (typeof asset.name !== 'string' || asset.name === '') {
				throw new Error('Custom module contains asset with invalid `name` property.');
			}

			if (typeof asset.id !== 'number') {
				throw new Error('Custom module contains asset with invalid `id` property.');
			}

			if (typeof asset.schema !== 'object') {
				throw new Error('Custom module contains asset with invalid `schema` property.');
			}

			if (typeof asset.apply !== 'function') {
				throw new Error('Custom module contains asset with invalid `apply` property.');
			}
		}

		this._registeredModules.push(customModule);
	}

	public async init({
		bus,
		channel,
		blockchainDB,
		forgerDB,
		logger,
		nodeDB,
	}: NodeInitInput): Promise<void> {
		this._channel = channel;
		this._logger = logger;
		this._blockchainDB = blockchainDB;
		this._forgerDB = forgerDB;
		this._nodeDB = nodeDB;
		this._bus = bus;

		this._genesisBlock = readGenesisBlockJSON(
			this._genesisBlockJSON,
			this._registeredAccountSchemas,
		);

		this._networkIdentifier = getNetworkIdentifier(
			this._genesisBlock.header.id,
			this._options.genesisConfig.communityIdentifier,
		);

		this._initModules();

		for (const customModule of this._registeredModules) {
			this._processor.register(customModule);

			const customModuleChannel = new InMemoryChannel(
				customModule.name,
				customModule.events,
				(customModule.actions as unknown) as ActionsDefinition,
			);
			await customModuleChannel.registerToBus(this._bus);
			// Give limited access of channel to custom module to publish events
			customModule.init({
				channel: {
					publish: (name: string, data?: Record<string, unknown>) =>
						customModuleChannel.publish(name, data),
				},
				dataAccess: {
					getChainState: async (key: Buffer) => this._chain.dataAccess.getChainState(key),
					getAccountByAddress: async <T = AccountDefaultProps>(address: Buffer) =>
						this._chain.dataAccess.getAccountByAddress<T>(address),
					getLastBlockHeader: async () => this._chain.dataAccess.getLastBlockHeader(),
				},
				logger: this._logger,
			});
		}
		// Initialize callable P2P endpoints
		this._networkModule.registerEndpoint('getTransactions', async ({ data, peerId }) =>
			this._transport.handleRPCGetTransactions(data, peerId),
		);
		this._networkModule.registerEndpoint('getLastBlock', ({ peerId }) =>
			this._transport.handleRPCGetLastBlock(peerId),
		);
		this._networkModule.registerEndpoint('getBlocksFromId', async ({ data, peerId }) =>
			this._transport.handleRPCGetBlocksFromId(data, peerId),
		);
		this._networkModule.registerEndpoint('getHighestCommonBlock', async ({ data, peerId }) =>
			this._transport.handleRPCGetHighestCommonBlock(data, peerId),
		);

		// Network needs to be initialized first to call events
		await this._networkModule.bootstrap(this.networkIdentifier);

		// Start subscribing to events, so that genesis block will also be included in event
		this._subscribeToEvents();
		// After binding, it should immediately load blockchain
		await this._processor.init(this._genesisBlock);
		// Check if blocks are left in temp_blocks table
		await this._synchronizer.init();

		this._networkModule.applyNodeInfo({
			height: this._chain.lastBlock.header.height,
			lastBlockID: this._chain.lastBlock.header.id,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
			maxHeightPrevoted:
				// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
				this._chain.lastBlock.header.asset.maxHeightPrevoted ?? 0,
			blockVersion: this._chain.lastBlock.header.version,
		});

		await this._transactionPool.start();
		await this._startForging();

		this._logger.info('Node ready and launched');

		this._networkModule.events.on(
			APP_EVENT_NETWORK_READY,
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			async () => {
				await this._startLoader();
			},
		);

		// Avoid receiving blocks/transactions from the network during snapshotting process
		this._networkModule.events.on(
			APP_EVENT_NETWORK_EVENT,
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			async (eventData?: Record<string, unknown>) => {
				const { event, data, peerId } = eventData as {
					event: string;
					data: Buffer | undefined;
					peerId: string;
				};

				try {
					if (event === 'postTransactionsAnnouncement') {
						await this._transport.handleEventPostTransactionsAnnouncement(data, peerId);
						return;
					}
					if (event === 'postBlock') {
						await this._transport.handleEventPostBlock(data, peerId);
						return;
					}
				} catch (err) {
					this._logger.warn(
						// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
						{ err, event },
						'Received invalid event message',
					);
				}
			},
		);
	}

	public get networkIdentifier(): Buffer {
		return this._networkIdentifier;
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types,@typescript-eslint/explicit-function-return-type
	public get actions() {
		return {
			getValidators: async (): Promise<
				ReadonlyArray<{
					address: string;
					nextForgingTime: number;
					minActiveHeight: number;
					isConsensusParticipant: boolean;
				}>
			> => {
				const validators = await this._chain.getValidators();
				const slot = this._chain.slots.getSlotNumber();
				const startTime = this._chain.slots.getSlotTime(slot);

				let nextForgingTime = startTime;
				const slotInRound = slot % this._chain.numberOfValidators;
				const blockTime = this._chain.slots.blockTime();
				const forgersInfo = [];
				for (let i = slotInRound; i < slotInRound + this._chain.numberOfValidators; i += 1) {
					const validator = validators[i % validators.length];
					forgersInfo.push({
						...validator,
						address: validator.address.toString('hex'),
						nextForgingTime,
					});
					nextForgingTime += blockTime;
				}

				return forgersInfo;
			},
			updateForgingStatus: async (
				params: UpdateForgingStatusInput,
			): Promise<ForgingStatusResponse> => {
				const result = await this._forger.updateForgingStatus(
					Buffer.from(params.address, 'hex'),
					params.password,
					params.forging,
					params.height,
					params.maxHeightPreviouslyForged,
					params.maxHeightPrevoted,
					params.overwrite,
				);

				return {
					address: result.address.toString('hex'),
					forging: result.forging,
				};
			},
			getAccount: async (params: { address: string }): Promise<string> => {
				const account = await this._chain.dataAccess.getAccountByAddress(
					Buffer.from(params.address, 'hex'),
				);
				return this._chain.dataAccess.encodeAccount(account).toString('hex');
			},
			getAccounts: async (params: { address: readonly string[] }): Promise<readonly string[]> => {
				const accounts = await this._chain.dataAccess.getAccountsByAddress(
					params.address.map(address => Buffer.from(address, 'hex')),
				);
				return accounts.map(account =>
					this._chain.dataAccess.encodeAccount(account).toString('hex'),
				);
			},
			getBlockByID: async (params: { id: string }): Promise<string | undefined> => {
				const block = await this._chain.dataAccess.getBlockByID(Buffer.from(params.id, 'hex'));
				return this._chain.dataAccess.encode(block).toString('hex');
			},
			getBlocksByIDs: async (params: { ids: readonly string[] }): Promise<readonly string[]> => {
				const blocks = [];
				try {
					for (const id of params.ids) {
						const block = await this._chain.dataAccess.getBlockByID(Buffer.from(id, 'hex'));
						blocks.push(block);
					}
				} catch (error) {
					if (!(error instanceof NotFoundError)) {
						throw error;
					}
				}
				return blocks.map(block => this._chain.dataAccess.encode(block).toString('hex'));
			},
			getBlockByHeight: async (params: { height: number }): Promise<string | undefined> => {
				const block = await this._chain.dataAccess.getBlockByHeight(params.height);
				return this._chain.dataAccess.encode(block).toString('hex');
			},
			getBlocksByHeightBetween: async (params: {
				from: number;
				to: number;
			}): Promise<readonly string[]> => {
				const blocks = await this._chain.dataAccess.getBlocksByHeightBetween(
					params.from,
					params.to,
				);

				return blocks.map(b => this._chain.dataAccess.encode(b).toString('hex'));
			},
			getTransactionByID: async (params: { id: string }): Promise<string> => {
				const transaction = await this._chain.dataAccess.getTransactionByID(
					Buffer.from(params.id, 'hex'),
				);

				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
				return transaction.getBytes().toString('hex');
			},
			getTransactionsByIDs: async (params: { ids: readonly string[] }): Promise<string[]> => {
				const transactions = [];
				try {
					for (const id of params.ids) {
						const transaction = await this._chain.dataAccess.getTransactionByID(
							Buffer.from(id, 'hex'),
						);
						transactions.push(transaction);
					}
				} catch (error) {
					if (!(error instanceof NotFoundError)) {
						throw error;
					}
				}
				return transactions.map(tx => tx.getBytes().toString('hex'));
			},
			getForgingStatus: async (): Promise<ForgingStatusResponse[] | undefined> => {
				const forgingStatus = await this._forger.getForgingStatusOfAllDelegates();
				if (forgingStatus) {
					return forgingStatus.map(({ address, ...forgingStatusWithoutAddress }) => ({
						address: address.toString('hex'),
						...forgingStatusWithoutAddress,
					}));
				}
				return undefined;
			},
			getTransactionsFromPool: (): string[] =>
				this._transactionPool.getAll().map(tx => tx.getBytes().toString('hex')),
			postTransaction: async (
				params: EventPostTransactionData,
			): Promise<handlePostTransactionReturn> => this._transport.handleEventPostTransaction(params),
			// eslint-disable-next-line @typescript-eslint/require-await
			getLastBlock: (): string =>
				this._chain.dataAccess.encode(this._chain.lastBlock).toString('hex'),
			getSchema: () => this.getSchema(),
			getRegisteredModules: () => this.getRegisteredModules(),
			getNodeInfo: () => ({
				version: this._options.version,
				networkVersion: this._options.networkVersion,
				networkIdentifier: this._networkIdentifier.toString('hex'),
				lastBlockID: this._chain.lastBlock.header.id.toString('hex'),
				height: this._chain.lastBlock.header.height,
				finalizedHeight: this._bft.finalityManager.finalizedHeight,
				syncing: this._synchronizer.isActive,
				unconfirmedTransactions: this._transactionPool.getAll().length,
				genesisConfig: {
					...this._options.genesisConfig,
				},
				registeredModules: this.getRegisteredModules(),
				network: {
					port: this._options.network.port,
					hostIp: this._options.network.hostIp,
					seedPeers: this._options.network.seedPeers,
					blacklistedIPs: this._options.network.blacklistedIPs,
					fixedPeers: this._options.network.fixedPeers,
					whitelistedPeers: this._options.network.whitelistedPeers,
				},
			}),
			getConnectedPeers: () => this._networkModule.getConnectedPeers(),
			getDisconnectedPeers: () => this._networkModule.getDisconnectedPeers(),
			getNetworkStats: () => this._networkModule.getNetworkStats(),
		};
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	public async cleanup(): Promise<void> {
		this._logger.info('Node cleanup started');
		this._transactionPool.stop();
		this._unsubscribeToEvents();
		if (this._forgingJob) {
			this._forgingJob.stop();
		}
		await this._synchronizer.stop();
		await this._processor.stop();
		this._logger.info('Node cleanup completed');
		await this._networkModule.cleanup();
	}

	private _initModules(): void {
		this._networkModule = new Network({
			networkVersion: this._options.networkVersion,
			options: this._options.network,
			logger: this._logger,
			channel: this._channel,
			nodeDB: this._nodeDB,
		});

		this._chain = new Chain({
			db: this._blockchainDB,
			genesisBlock: this._genesisBlock,
			networkIdentifier: this._networkIdentifier,
			maxPayloadLength: this._options.genesisConfig.maxPayloadLength,
			rewardDistance: this._options.genesisConfig.rewards.distance,
			rewardOffset: this._options.genesisConfig.rewards.offset,
			rewardMilestones: this._options.genesisConfig.rewards.milestones.map(s => BigInt(s)),
			blockTime: this._options.genesisConfig.blockTime,
			accountSchemas: this._registeredAccountSchemas,
			minFeePerByte: this._options.genesisConfig.minFeePerByte,
			baseFees: this._options.genesisConfig.baseFees,
		});

		this._bft = new BFT({
			chain: this._chain,
			threshold: this._options.genesisConfig.bftThreshold,
			genesisHeight: this._genesisBlock.header.height,
		});

		this._processor = new Processor({
			channel: this._channel,
			logger: this._logger,
			chainModule: this._chain,
			bftModule: this._bft,
		});

		this._transactionPool = new TransactionPool({
			baseFees: this._options.genesisConfig.baseFees.map(fees => ({
				...fees,
				baseFee: BigInt(fees.baseFee),
			})),
			minFeePerByte: this._options.genesisConfig.minFeePerByte,
			applyTransactions: async (transactions: Transaction[]) => {
				const stateStore = await this._chain.newStateStore();
				return this._processor.verifyTransactions(transactions, stateStore);
			},
			...this._options.transactionPool,
			minEntranceFeePriority: BigInt(this._options.transactionPool.minEntranceFeePriority),
			minReplacementFeeDifference: BigInt(
				this._options.transactionPool.minReplacementFeeDifference,
			),
		});

		const blockSyncMechanism = new BlockSynchronizationMechanism({
			logger: this._logger,
			bft: this._bft,
			channel: this._channel,
			chain: this._chain,
			processorModule: this._processor,
			networkModule: this._networkModule,
		});

		const fastChainSwitchMechanism = new FastChainSwitchingMechanism({
			logger: this._logger,
			channel: this._channel,
			chain: this._chain,
			bft: this._bft,
			processor: this._processor,
			networkModule: this._networkModule,
		});

		this._synchronizer = new Synchronizer({
			channel: this._channel,
			logger: this._logger,
			chainModule: this._chain,
			bftModule: this._bft,
			processorModule: this._processor,
			transactionPoolModule: this._transactionPool,
			mechanisms: [blockSyncMechanism, fastChainSwitchMechanism],
			networkModule: this._networkModule,
		});

		blockSyncMechanism.events.on(
			EVENT_SYNCHRONIZER_SYNC_REQUIRED,
			({ block, peerId }: { block: Block; peerId: string }) => {
				this._synchronizer.run(block, peerId).catch(err => {
					this._logger.error({ err: err as Error }, 'Error occurred during synchronization.');
				});
			},
		);

		fastChainSwitchMechanism.events.on(
			EVENT_SYNCHRONIZER_SYNC_REQUIRED,
			({ block, peerId }: { block: Block; peerId: string }) => {
				this._synchronizer.run(block, peerId).catch(err => {
					this._logger.error({ err: err as Error }, 'Error occurred during synchronization.');
				});
			},
		);

		this._forger = new Forger({
			logger: this._logger,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			db: this._forgerDB,
			bftModule: this._bft,
			transactionPoolModule: this._transactionPool,
			processorModule: this._processor,
			chainModule: this._chain,
			forgingDelegates: this._options.forging.delegates.map(delegate => ({
				...delegate,
				address: Buffer.from(delegate.address, 'hex'),
				hashOnion: {
					...delegate.hashOnion,
					hashes: delegate.hashOnion.hashes.map(h => Buffer.from(h, 'hex')),
				},
			})),
			forgingForce: this._options.forging.force,
			forgingDefaultPassword: this._options.forging.defaultPassword,
			forgingWaitThreshold: this._options.forging.waitThreshold,
		});

		this._transport = new Transport({
			channel: this._channel,
			logger: this._logger,
			synchronizer: this._synchronizer,
			transactionPoolModule: this._transactionPool,
			processorModule: this._processor,
			chainModule: this._chain,
			networkModule: this._networkModule,
		});
	}

	private async _startLoader(): Promise<void> {
		return this._synchronizer.loadUnconfirmedTransactions();
	}

	private async _forgingTask(): Promise<void> {
		try {
			if (!this._forger.delegatesEnabled()) {
				this._logger.trace('No delegates are enabled');
				return;
			}
			if (this._synchronizer.isActive) {
				this._logger.debug('Client not ready to forge');
				return;
			}
			await this._forger.forge();
		} catch (err) {
			this._logger.error({ err: err as Error });
		}
	}

	private async _startForging(): Promise<void> {
		try {
			await this._forger.loadDelegates();
		} catch (err) {
			this._logger.error({ err: err as Error }, 'Failed to load delegates for forging');
		}
		this._forgingJob = new jobHandlers.Scheduler(async () => this._forgingTask(), forgeInterval);
		// eslint-disable-next-line @typescript-eslint/no-floating-promises
		this._forgingJob.start();
	}

	private _subscribeToEvents(): void {
		this._chain.events.on(
			EVENT_NEW_BLOCK,
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			async (eventData: {
				block: Block;
				accounts: Account[];
				// eslint-disable-next-line @typescript-eslint/require-await
			}): Promise<void> => {
				const { block } = eventData;
				// Publish to the outside
				this._channel.publish(APP_EVENT_BLOCK_NEW, {
					block: this._chain.dataAccess.encode(block).toString('hex'),
					accounts: eventData.accounts.map(acc =>
						this._chain.dataAccess.encodeAccount(acc).toString('hex'),
					),
				});

				// Remove any transactions from the pool on new block
				if (block.payload.length) {
					for (const transaction of block.payload) {
						this._transactionPool.remove(transaction);
					}
				}

				if (!this._synchronizer.isActive) {
					this._networkModule.applyNodeInfo({
						height: block.header.height,
						lastBlockID: block.header.id,
						// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
						maxHeightPrevoted: block.header.asset.maxHeightPrevoted,
						blockVersion: block.header.version,
					});
				}

				this._logger.info(
					{
						id: block.header.id,
						height: block.header.height,
						numberOfTransactions: block.payload.length,
					},
					'New block added to the chain',
				);
			},
		);

		// eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
		this._chain.events.on(
			EVENT_DELETE_BLOCK,
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			async (eventData: { block: Block; accounts: Account[] }) => {
				const { block } = eventData;
				// Publish to the outside
				this._channel.publish(APP_EVENT_BLOCK_DELETE, {
					block: this._chain.dataAccess.encode(block).toString('hex'),
					accounts: eventData.accounts.map(acc =>
						this._chain.dataAccess.encodeAccount(acc).toString('hex'),
					),
				});

				if (block.payload.length) {
					for (const transaction of block.payload) {
						try {
							await this._transactionPool.add(transaction);
						} catch (err) {
							this._logger.error(
								{ err: err as Error },
								'Failed to add transaction back to the pool',
							);
						}
					}
				}
				this._logger.info(
					{ id: block.header.id, height: block.header.height },
					'Deleted a block from the chain',
				);
			},
		);

		this._chain.events.on(
			EVENT_VALIDATORS_CHANGED,
			(eventData: {
				validators: [
					{
						address: Buffer;
						isConsensusParticipant: boolean;
						minActiveHeight: number;
					},
				];
			}): void => {
				const updatedValidatorsList = eventData.validators.map(aValidator => ({
					...aValidator,
					address: aValidator.address.toString('hex'),
				}));
				this._channel.publish(APP_EVENT_CHAIN_VALIDATORS_CHANGE, {
					validators: updatedValidatorsList,
				});
			},
		);

		this._processor.events.on(
			EVENT_PROCESSOR_BROADCAST_BLOCK,
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			async ({ block }) => {
				await this._transport.handleBroadcastBlock(block);
			},
		);

		this._processor.events.on(
			EVENT_PROCESSOR_SYNC_REQUIRED,
			({ block, peerId }: { block: Block; peerId: string }) => {
				this._synchronizer.run(block, peerId).catch(err => {
					this._logger.error({ err: err as Error }, 'Error occurred during synchronization.');
				});
			},
		);

		this._transactionPool.events.on(EVENT_TRANSACTION_REMOVED, event => {
			this._logger.debug(event, 'Transaction was removed from the pool.');
		});
	}

	private _unsubscribeToEvents(): void {
		this._bft.removeAllListeners(EVENT_BFT_BLOCK_FINALIZED);
	}
}
