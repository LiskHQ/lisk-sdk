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

import { ForkStatus, BFT } from '@liskhq/lisk-bft';
import {
	Chain,
	Block,
	GenesisBlock,
	StateStore,
	Transaction,
	getValidators,
	Account,
	BlockHeader,
} from '@liskhq/lisk-chain';
import { objects, jobHandlers } from '@liskhq/lisk-utils';
import { EventEmitter } from 'events';
import { codec } from '@liskhq/lisk-codec';
import { validator, LiskValidationError } from '@liskhq/lisk-validator';
import { APP_EVENT_CHAIN_FORK } from '../../constants';
import { Logger } from '../../logger';
import { InMemoryChannel } from '../../controller/channels';
import { BaseModule, BaseAsset } from '../../modules';
import { ReducerHandler, Consensus, Delegate, StateStore as ModuleStateStore } from '../../types';
import { TransactionApplyError, ApplyPenaltyError } from '../../errors';

const forkStatusList = [
	ForkStatus.IDENTICAL_BLOCK,
	ForkStatus.VALID_BLOCK,
	ForkStatus.DOUBLE_FORGING,
	ForkStatus.TIE_BREAK,
	ForkStatus.DIFFERENT_CHAIN,
	ForkStatus.DISCARD,
];

export const EVENT_PROCESSOR_SYNC_REQUIRED = 'EVENT_PROCESSOR_SYNC_REQUIRED';
export const EVENT_PROCESSOR_BROADCAST_BLOCK = 'EVENT_PROCESSOR_BROADCAST_BLOCK';

interface ProcessorInput {
	readonly channel: InMemoryChannel;
	readonly logger: Logger;
	readonly chainModule: Chain;
	readonly bftModule: BFT;
}

const BLOCK_VERSION = 2;

export class Processor {
	public readonly events: EventEmitter;
	private readonly _channel: InMemoryChannel;
	private readonly _logger: Logger;
	private readonly _chain: Chain;
	private readonly _bft: BFT;
	private readonly _mutex: jobHandlers.Mutex;
	private readonly _modules: BaseModule[] = [];
	private _stop = false;

	public constructor({ channel, logger, chainModule, bftModule }: ProcessorInput) {
		this._channel = channel;
		this._logger = logger;
		this._chain = chainModule;
		this._bft = bftModule;
		this._mutex = new jobHandlers.Mutex();
		this.events = new EventEmitter();
	}

	public register(customModule: BaseModule): void {
		const existingModule = this._modules.find(m => m.id === customModule.id);
		if (existingModule) {
			throw new Error(`Module id ${customModule.id} is already registered`);
		}
		this._modules.push(customModule);
	}

	public async init(genesisBlock: GenesisBlock): Promise<void> {
		this._logger.debug(
			{
				id: genesisBlock.header.id,
				transactionRoot: genesisBlock.header.transactionRoot,
			},
			'Initializing processor',
		);
		const genesisExist = await this._chain.genesisBlockExist(genesisBlock);
		// do init check for block state. We need to load the blockchain
		const stateStore = await this._chain.newStateStore();
		if (!genesisExist) {
			this._chain.validateGenesisBlockHeader(genesisBlock);
			await this._chain.applyGenesisBlock(genesisBlock, stateStore);
			for (const customModule of this._modules) {
				if (customModule.afterGenesisBlockApply) {
					await customModule.afterGenesisBlockApply({
						genesisBlock,
						stateStore: this._createScopedStateStore(stateStore, customModule.name),
						reducerHandler: this._createReducerHandler(stateStore),
					});
				}
			}
			// TODO: saveBlock should accept both genesis and normal block
			await this._chain.saveBlock((genesisBlock as unknown) as Block, stateStore, 0);
		}
		await this._chain.init();
		await this._bft.init(stateStore);
		this._logger.info('Blockchain ready');
	}

	public async stop(): Promise<void> {
		this._stop = true;
		// Add mutex to wait for the current mutex to finish
		await this._mutex.acquire();
	}

	// process is for standard processing of block, especially when received from network
	public async process(block: Block, { peerId }: { peerId?: string } = {}): Promise<void> {
		if (this._stop) {
			return;
		}
		await this._mutex.runExclusive(async () => {
			this._logger.debug(
				{ id: block.header.id, height: block.header.height },
				'Starting to process block',
			);
			const { lastBlock } = this._chain;
			const forkStatus = this._bft.forkChoice(block.header, lastBlock.header);

			if (!forkStatusList.includes(forkStatus)) {
				this._logger.debug({ status: forkStatus, blockId: block.header.id }, 'Unknown fork status');
				throw new Error('Unknown fork status');
			}

			// Discarding block
			if (forkStatus === ForkStatus.DISCARD) {
				this._logger.debug(
					{ id: block.header.id, height: block.header.height },
					'Discarding block',
				);
				const encodedBlock = this._chain.dataAccess.encode(block);
				this._channel.publish(APP_EVENT_CHAIN_FORK, {
					block: encodedBlock.toString('hex'),
				});
				return;
			}
			if (forkStatus === ForkStatus.IDENTICAL_BLOCK) {
				this._logger.debug(
					{ id: block.header.id, height: block.header.height },
					'Block already processed',
				);
				return;
			}
			if (forkStatus === ForkStatus.DOUBLE_FORGING) {
				this._logger.warn(
					{
						id: block.header.id,
						generatorPublicKey: block.header.generatorPublicKey,
					},
					'Discarding block due to double forging',
				);
				const encodedBlock = this._chain.dataAccess.encode(block);
				this._channel.publish(APP_EVENT_CHAIN_FORK, {
					block: encodedBlock.toString('hex'),
				});
				return;
			}
			// Discard block and move to different chain
			if (forkStatus === ForkStatus.DIFFERENT_CHAIN) {
				this._logger.debug(
					{ id: block.header.id, height: block.header.height },
					'Detected different chain to sync',
				);
				const encodedBlock = this._chain.dataAccess.encode(block);
				// Sync requires decoded block
				this.events.emit(EVENT_PROCESSOR_SYNC_REQUIRED, {
					block,
					peerId,
				});
				this._channel.publish(APP_EVENT_CHAIN_FORK, {
					block: encodedBlock.toString('hex'),
				});
				return;
			}
			// Replacing a block
			if (forkStatus === ForkStatus.TIE_BREAK) {
				this._logger.info(
					{ id: lastBlock.header.id, height: lastBlock.header.height },
					'Received tie breaking block',
				);
				const encodedBlock = this._chain.dataAccess.encode(block);
				this._channel.publish(APP_EVENT_CHAIN_FORK, {
					block: encodedBlock.toString('hex'),
				});

				await this._validate(block);
				const previousLastBlock = objects.cloneDeep(lastBlock);
				await this._deleteBlock(lastBlock);
				try {
					await this._processValidated(block);
				} catch (err) {
					this._logger.error(
						{
							id: block.header.id,
							previousBlockId: previousLastBlock.header.id,
							err: err as Error,
						},
						'Failed to apply newly received block. restoring previous block.',
					);
					await this._processValidated(previousLastBlock, {
						skipBroadcast: true,
					});
				}
				return;
			}

			this._logger.debug(
				{ id: block.header.id, height: block.header.height },
				'Processing valid block',
			);
			await this._validate(block);
			await this._processValidated(block);
		});
	}

	public async validate(block: Block): Promise<void> {
		this._logger.debug({ id: block.header.id, height: block.header.height }, 'Validating block');
		await this._validate(block);
	}

	// processValidated processes a block assuming that statically it's valid
	public async processValidated(
		block: Block,
		{ removeFromTempTable = false }: { removeFromTempTable?: boolean } = {},
	): Promise<void> {
		if (this._stop) {
			return;
		}
		await this._mutex.runExclusive(async () => {
			this._logger.debug(
				{ id: block.header.id, height: block.header.height },
				'Processing validated block',
			);
			return this._processValidated(block, {
				skipBroadcast: true,
				removeFromTempTable,
			});
		});
	}

	public async deleteLastBlock({
		saveTempBlock = false,
	}: { saveTempBlock?: boolean } = {}): Promise<void> {
		if (this._stop) {
			return;
		}
		await this._mutex.runExclusive(async () => {
			const { lastBlock } = this._chain;
			this._logger.debug(
				{ id: lastBlock.header.id, height: lastBlock.header.height },
				'Deleting last block',
			);
			await this._deleteBlock(lastBlock, saveTempBlock);
			return this._chain.lastBlock;
		});
	}

	public validateTransaction(transaction: Transaction): void {
		this._chain.validateTransaction(transaction);
		const customAsset = this._getAsset(transaction);
		if (customAsset.validate) {
			const decodedAsset = codec.decode(customAsset.schema, transaction.asset);
			const assetSchemaErrors = validator.validate(customAsset.schema, decodedAsset as object);
			if (assetSchemaErrors.length) {
				throw new LiskValidationError(assetSchemaErrors);
			}
			customAsset.validate({
				asset: decodedAsset,
				transaction,
			});
		}
	}

	public async verifyTransactions(
		transactions: Transaction[],
		stateStore: StateStore,
	): Promise<void> {
		if (!transactions.length) {
			return;
		}
		for (const transaction of transactions) {
			try {
				for (const customModule of this._modules) {
					if (customModule.beforeTransactionApply) {
						await customModule.beforeTransactionApply({
							reducerHandler: this._createReducerHandler(stateStore),
							stateStore: this._createScopedStateStore(stateStore, customModule.name),
							transaction,
						});
					}
				}
				const moduleName = this._getModule(transaction).name;
				const customAsset = this._getAsset(transaction);
				const decodedAsset = codec.decode(customAsset.schema, transaction.asset);
				await customAsset.apply({
					asset: decodedAsset,
					reducerHandler: this._createReducerHandler(stateStore),
					stateStore: this._createScopedStateStore(stateStore, moduleName),
					transaction,
				});
				for (const customModule of this._modules) {
					if (customModule.afterTransactionApply) {
						await customModule.afterTransactionApply({
							reducerHandler: this._createReducerHandler(stateStore),
							stateStore: this._createScopedStateStore(stateStore, customModule.name),
							transaction,
						});
					}
				}
			} catch (err) {
				throw new TransactionApplyError(
					(err as Error).message ?? 'Transaction verification failed',
					transaction.id,
					err,
				);
			}
		}
	}

	private async _processValidated(
		block: Block,
		{
			skipBroadcast,
			removeFromTempTable = false,
		}: {
			skipBroadcast?: boolean;
			removeFromTempTable?: boolean;
		} = {},
	): Promise<Block> {
		const stateStore = await this._chain.newStateStore();
		const reducerHandler = this._createReducerHandler(stateStore);
		await this._chain.verifyBlockHeader(block, stateStore);
		await this._bft.verifyBlockHeader(block.header, stateStore);

		if (!skipBroadcast) {
			this.events.emit(EVENT_PROCESSOR_BROADCAST_BLOCK, {
				block,
			});
		}

		for (const customModule of this._modules) {
			if (customModule.beforeBlockApply) {
				await customModule.beforeBlockApply({
					block,
					stateStore: this._createScopedStateStore(stateStore, customModule.name),
					reducerHandler,
				});
			}
		}

		await this._bft.applyBlockHeader(block.header, stateStore);

		if (block.payload.length) {
			for (const transaction of block.payload) {
				for (const customModule of this._modules) {
					if (customModule.beforeTransactionApply) {
						await customModule.beforeTransactionApply({
							reducerHandler: this._createReducerHandler(stateStore),
							stateStore: this._createScopedStateStore(stateStore, customModule.name),
							transaction,
						});
					}
				}
				const moduleName = this._getModule(transaction).name;
				const customAsset = this._getAsset(transaction);
				const decodedAsset = codec.decode(customAsset.schema, transaction.asset);
				await customAsset.apply({
					asset: decodedAsset,
					reducerHandler,
					stateStore: this._createScopedStateStore(stateStore, moduleName),
					transaction,
				});
				for (const customModule of this._modules) {
					if (customModule.afterTransactionApply) {
						await customModule.afterTransactionApply({
							reducerHandler: this._createReducerHandler(stateStore),
							stateStore: this._createScopedStateStore(stateStore, customModule.name),
							transaction,
						});
					}
				}
			}
		}

		// Apply should always be executed after save as it performs database calculations
		// i.e. Dpos.apply expects to have this processing block in the database
		for (const customModule of this._modules) {
			if (customModule.afterBlockApply) {
				await customModule.afterBlockApply({
					block,
					reducerHandler,
					stateStore: this._createScopedStateStore(stateStore, customModule.name),
					consensus: this._createConsensus(stateStore, block.header),
				});
			}
		}
		await this._chain.saveBlock(block, stateStore, this._bft.finalizedHeight, {
			removeFromTempTable,
		});

		return block;
	}

	private async _validate(block: Block): Promise<void> {
		// If the schema or bytes does not match with version 2, it fails even before this
		// This is for fail safe, and genesis block does not use this function
		if (block.header.version !== BLOCK_VERSION) {
			throw new ApplyPenaltyError(`Block version must be ${BLOCK_VERSION}`);
		}
		try {
			await this._chain.validateBlockHeader(block);
			if (block.payload.length) {
				for (const transaction of block.payload) {
					this.validateTransaction(transaction);
				}
			}
		} catch (error) {
			throw new ApplyPenaltyError((error as Error).message ?? 'Invalid block to be processed');
		}
	}

	private async _deleteBlock(block: Block, saveTempBlock = false): Promise<void> {
		if (block.header.height <= this._bft.finalizedHeight) {
			throw new Error('Can not delete block below or same as finalized height');
		}

		// Offset must be set to 1, because lastBlock is still this deleting block
		const stateStore = await this._chain.newStateStore(1);
		await this._chain.removeBlock(block, stateStore, { saveTempBlock });
	}

	private _createConsensus(stateStore: StateStore, blockHeader: BlockHeader): Consensus {
		return {
			getFinalizedHeight: (): number => this._bft.finalizedHeight,
			updateDelegates: async (delegates: Delegate[]): Promise<void> => {
				await this._chain.setValidators(delegates, stateStore, blockHeader);
			},
			getDelegates: async (): Promise<Delegate[]> => getValidators(stateStore),
		};
	}

	private _createScopedStateStore(stateStore: StateStore, moduleName: string): ModuleStateStore {
		return {
			account: {
				get: async <T>(key: Buffer): Promise<Account<T>> => {
					const account = await stateStore.account.get(key);
					return {
						address: account.address,
						[moduleName]: account[moduleName],
					} as Account<T>;
				},
				getOrDefault: async <T>(key: Buffer): Promise<Account<T>> => {
					const account = await stateStore.account.getOrDefault(key);
					return {
						address: account.address,
						[moduleName]: account[moduleName],
					} as Account<T>;
				},
				set: async (key: Buffer, value: Account): Promise<void> => {
					const account = await stateStore.account.getOrDefault(key);
					account[moduleName] = value[moduleName];
					await stateStore.account.set(key, account);
				},
				del: async (key: Buffer): Promise<void> => stateStore.account.del(key),
			},
			chain: {
				get: async (key: Buffer): Promise<Buffer | undefined> => stateStore.chain.get(key),
				lastBlockHeaders: stateStore.chain.lastBlockHeaders,
				lastBlockReward: stateStore.chain.lastBlockReward,
				networkIdentifier: stateStore.chain.networkIdentifier,
				// eslint-disable-next-line @typescript-eslint/require-await
				set: async (key: Buffer, value: Buffer): Promise<void> => {
					await stateStore.chain.set(key, value);
				},
			},
		};
	}

	private _createReducerHandler(stateStore: StateStore): ReducerHandler {
		return {
			invoke: async <T = unknown>(name: string, params?: Record<string, unknown>): Promise<T> => {
				const requestNames = name.split(':');
				if (requestNames.length !== 2) {
					throw new Error('Invalid format to call reducer');
				}
				const [moduleName, funcName] = requestNames;
				const customModule = this._getModuleByName(moduleName);
				const fn = customModule.reducers[funcName];
				if (!fn) {
					throw new Error(`${funcName} does not exist in module ${moduleName}`);
				}
				return fn(params ?? {}, this._createScopedStateStore(stateStore, moduleName)) as Promise<T>;
			},
		};
	}

	private _getModuleByName(name: string): BaseModule {
		const customModule = this._modules.find(m => m.name === name);
		if (!customModule) {
			throw new Error(`Module ${name} does not exist`);
		}
		return customModule;
	}

	private _getModule(transaction: Transaction): BaseModule {
		const customModule = this._modules.find(m => m.id === transaction.moduleID);
		if (!customModule) {
			throw new Error(`Module id ${transaction.moduleID} does not exist`);
		}
		return customModule;
	}

	private _getAsset(transaction: Transaction): BaseAsset {
		const customModule = this._getModule(transaction);
		const customAsset = customModule.transactionAssets.find(
			asset => asset.id === transaction.assetID,
		);
		if (!customAsset) {
			throw new Error(
				`Asset id ${transaction.assetID} does not exist in module id ${transaction.moduleID}.`,
			);
		}
		return customAsset;
	}
}
