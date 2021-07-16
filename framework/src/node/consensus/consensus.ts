/*
 * Copyright © 2021 Lisk Foundation
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
import { EventEmitter } from 'events';
import { Block, Chain, GenesisBlock } from '@liskhq/lisk-chain';
import { jobHandlers, objects } from '@liskhq/lisk-utils';
import { KVStore } from '@liskhq/lisk-db';
import { BFT, ForkStatus } from '@liskhq/lisk-bft';
import { codec } from '@liskhq/lisk-codec';
import { Logger } from '../../logger';
import { StateMachine } from '../state_machine/state_machine';
import { BlockContext } from '../state_machine/block_context';
import {
	BlockSynchronizationMechanism,
	FastChainSwitchingMechanism,
	Synchronizer,
} from './synchronizer';
import { ApplyPenaltyError } from '../../errors';
import { AbortError, ApplyPenaltyAndRestartError, RestartError } from './synchronizer/errors';
import { EventQueue } from '../state_machine/event_queue';
import { BlockExecutor } from './synchronizer/type';
import { GenesisBlockContext } from '../state_machine/genesis_block_context';
import { Network } from '../network';
import { Endpoint } from './endpoints';
import { EventPostBlockData, postBlockEventSchema } from './schema';
import { BlockHeader, StateStore } from '../state_machine/types';
import {
	EVENT_BLOCK_BROADCAST,
	EVENT_FORK_DETECTED,
	NETWORK_EVENT_POST_BLOCK,
	NETWORK_RPC_GET_BLOCKS_FROM_ID,
	NETWORK_RPC_GET_HIGHEST_COMMON_BLOCK,
	NETWORK_RPC_GET_LAST_BLOCK,
} from './constants';

interface ConsensusArgs {
	stateMachine: StateMachine;
	chain: Chain;
	network: Network;
}

interface InitArgs {
	logger: Logger;
	genesisBlock: Block;
	db: KVStore;
}

interface ExecuteOptions {
	skipBroadcast?: boolean;
	removeFromTempTable?: boolean;
}
interface DeleteOptions {
	saveTempBlock?: boolean;
}

const BLOCK_VERSION = 2;
const forkStatusList = [
	ForkStatus.IDENTICAL_BLOCK,
	ForkStatus.VALID_BLOCK,
	ForkStatus.DOUBLE_FORGING,
	ForkStatus.TIE_BREAK,
	ForkStatus.DIFFERENT_CHAIN,
	ForkStatus.DISCARD,
];

export class Consensus {
	public readonly events: EventEmitter;

	private readonly _stateMachine: StateMachine;
	private readonly _chain: Chain;
	private readonly _network: Network;
	private readonly _mutex: jobHandlers.Mutex;

	// init paramters
	private _logger!: Logger;
	// private _db!: KVStore;
	private _endpoint!: Endpoint;
	private _synchronizer!: Synchronizer;

	// TODO: migrate to module
	private readonly _bft: BFT;

	private _stop = false;

	public constructor(args: ConsensusArgs) {
		this.events = new EventEmitter();
		this._stateMachine = args.stateMachine;
		this._chain = args.chain;
		this._network = args.network;
		this._mutex = new jobHandlers.Mutex();
		this._bft = new BFT({
			chain: this._chain,
			genesisHeight: 0,
			threshold: 23,
		});
	}

	public async init(args: InitArgs): Promise<void> {
		this._logger = args.logger;
		// this._db = args.db;
		this._endpoint = new Endpoint({
			chain: this._chain,
			logger: this._logger,
			network: this._network,
		});
		const blockExecutor = this._createBlockExecutor();
		const blockSyncMechanism = new BlockSynchronizationMechanism({
			bft: this._bft,
			chain: this._chain,
			logger: this._logger,
			network: this._network,
			blockExecutor,
		});
		const fastChainSwitchMechanism = new FastChainSwitchingMechanism({
			bft: this._bft,
			chain: this._chain,
			logger: this._logger,
			network: this._network,
			blockExecutor,
		});
		this._synchronizer = new Synchronizer({
			chainModule: this._chain,
			bftModule: this._bft,
			logger: this._logger,
			blockExecutor,
			mechanisms: [blockSyncMechanism, fastChainSwitchMechanism],
		});

		this._network.registerEndpoint(NETWORK_RPC_GET_LAST_BLOCK, ({ peerId }) => {
			this._endpoint.handleRPCGetLastBlock(peerId);
		});
		this._network.registerEndpoint(NETWORK_RPC_GET_BLOCKS_FROM_ID, async ({ data, peerId }) =>
			this._endpoint.handleRPCGetBlocksFromId(data, peerId),
		);
		this._network.registerEndpoint(NETWORK_RPC_GET_HIGHEST_COMMON_BLOCK, async ({ data, peerId }) =>
			this._endpoint.handleRPCGetHighestCommonBlock(data, peerId),
		);

		this._logger.debug(
			{
				id: args.genesisBlock.header.id,
				transactionRoot: args.genesisBlock.header.transactionRoot,
			},
			'Initializing consensus component',
		);
		const genesisExist = await this._chain.genesisBlockExist(
			(args.genesisBlock as unknown) as GenesisBlock,
		);
		// do init check for block state. We need to load the blockchain
		const stateStore = await this._chain.newStateStore();
		if (!genesisExist) {
			this._chain.validateGenesisBlockHeader((args.genesisBlock as unknown) as GenesisBlock);
			await this._chain.applyGenesisBlock(
				(args.genesisBlock as unknown) as GenesisBlock,
				stateStore,
			);
			const eventQueue = new EventQueue();
			const ctx = new GenesisBlockContext({
				eventQueue,
				header: (args.genesisBlock.header as unknown) as BlockHeader,
				logger: this._logger,
				stateStore: (stateStore as unknown) as StateStore,
			});
			await this._stateMachine.executeGenesisBlock(ctx);
			// TODO: saveBlock should accept both genesis and normal block
			await this._chain.saveBlock((args.genesisBlock as unknown) as Block, stateStore, 0);
		}
		await this._chain.init();
		await this._bft.init(stateStore);
		this._logger.info('Consensus component ready.');
	}

	public syncing(): boolean {
		return this._synchronizer.isActive;
	}

	public finalizedHeight(): number {
		return this._bft.finalizedHeight;
	}

	public async onBlockReceive(data: unknown, peerId: string): Promise<void> {
		// Should ignore received block if syncing
		if (this.syncing()) {
			this._logger.debug("Client is syncing. Can't process new block at the moment.");
			return;
		}

		if (!Buffer.isBuffer(data)) {
			const errorMessage = 'Received invalid post block data';
			this._logger.warn(
				{
					peerId,
					error: '',
				},
				errorMessage,
			);
			this._network.applyPenaltyOnPeer({
				peerId,
				penalty: 100,
			});
			return;
		}

		let decodedData: EventPostBlockData;
		try {
			decodedData = codec.decode<EventPostBlockData>(postBlockEventSchema, data);
		} catch (error) {
			this._logger.warn(
				{
					err: error as Error,
					data,
				},
				'Received post block broadcast request in unexpected format',
			);
			this._network.applyPenaltyOnPeer({
				peerId,
				penalty: 100,
			});
			throw error;
		}

		const { block: blockBytes } = decodedData;

		let block: Block;
		try {
			block = this._chain.dataAccess.decode(blockBytes);
		} catch (error) {
			this._logger.warn(
				{
					err: error as Error,
					data,
				},
				'Received post block broadcast request in not decodable format',
			);
			this._network.applyPenaltyOnPeer({
				peerId,
				penalty: 100,
			});
			throw error;
		}

		try {
			await this._execute(block, peerId);
		} catch (error) {
			if (error instanceof ApplyPenaltyError) {
				this._logger.warn(
					{
						err: error as Error,
						data,
					},
					'Received post block broadcast request with invalid block',
				);
				this._network.applyPenaltyOnPeer({
					peerId,
					penalty: 100,
				});
			}
			throw error;
		}
	}

	// excecute inter block passed from generator
	public async execute(block: Block): Promise<void> {
		await this._mutex.runExclusive(async () => {
			await this._executeValidated(block);
		});
	}

	public async stop(): Promise<void> {
		this._stop = true;
		// Add mutex to wait for the current mutex to finish
		await this._mutex.acquire();
	}

	private async _execute(block: Block, peerID: string): Promise<void> {
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
				this.events.emit(EVENT_FORK_DETECTED, {
					block,
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
				this.events.emit(EVENT_FORK_DETECTED, {
					block,
				});
				return;
			}
			// Discard block and move to different chain
			if (forkStatus === ForkStatus.DIFFERENT_CHAIN) {
				this._logger.debug(
					{ id: block.header.id, height: block.header.height },
					'Detected different chain to sync',
				);
				this.events.emit(EVENT_FORK_DETECTED, {
					block,
				});
				// Sync requires decoded block
				await this._sync(block, peerID);
				return;
			}
			// Replacing a block
			if (forkStatus === ForkStatus.TIE_BREAK) {
				this._logger.info(
					{ id: lastBlock.header.id, height: lastBlock.header.height },
					'Received tie breaking block',
				);
				this.events.emit(EVENT_FORK_DETECTED, {
					block,
				});

				await this._validate(block);
				const previousLastBlock = objects.cloneDeep(lastBlock);
				await this._deleteBlock(lastBlock);
				try {
					await this._executeValidated(block);
				} catch (err) {
					this._logger.error(
						{
							id: block.header.id,
							previousBlockId: previousLastBlock.header.id,
							err: err as Error,
						},
						'Failed to apply newly received block. restoring previous block.',
					);
					await this._executeValidated(previousLastBlock, {
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
			await this._executeValidated(block);
		});
	}

	private async _executeValidated(
		block: Block,
		options: {
			skipBroadcast?: boolean;
			removeFromTempTable?: boolean;
		} = {},
	): Promise<Block> {
		const stateStore = await this._chain.newStateStore();
		const eventQueue = new EventQueue();
		const ctx = new BlockContext({
			stateStore: (stateStore as unknown) as StateStore,
			eventQueue,
			networkIdentifier: Buffer.alloc(0),
			logger: this._logger,
			// eslint-disable-next-line
			header: block.header as any,
			transactions: block.payload,
		});
		await this._chain.verifyBlockHeader(block, stateStore);
		await this._bft.verifyBlockHeader(block.header, stateStore);
		await this._stateMachine.verifyBlock(ctx);

		if (!options.skipBroadcast) {
			this._network.send({ event: NETWORK_EVENT_POST_BLOCK, data: block });
			this.events.emit(EVENT_BLOCK_BROADCAST, {
				block,
			});
		}
		await this._stateMachine.executeBlock(ctx);

		await this._chain.saveBlock(block, stateStore, this._bft.finalizedHeight, {
			removeFromTempTable: options.removeFromTempTable ?? false,
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
					this._chain.validateTransaction(transaction);
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

	private async _deleteLastBlock({ saveTempBlock = false }: DeleteOptions = {}): Promise<void> {
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

	private async _sync(block: Block, peerID: string): Promise<void> {
		if (this._stop) {
			return;
		}
		try {
			await this._synchronizer.run(block, peerID);
		} catch (error) {
			if (error instanceof ApplyPenaltyAndRestartError) {
				this._network.applyPenaltyOnPeer({ peerId: peerID, penalty: 100 });
				await this._sync(block, peerID);
				return;
			}

			if (error instanceof RestartError) {
				await this._sync(block, peerID);
				return;
			}

			if (error instanceof AbortError) {
				this._logger.info({ error, reason: error.reason }, 'Aborting synchronization mechanism');
				return;
			}
			throw error;
		}
	}

	private _createBlockExecutor(): BlockExecutor {
		return {
			deleteLastBlock: async (options: DeleteOptions = {}) => this._deleteLastBlock(options),
			executeValidated: async (block: Block, options?: ExecuteOptions) =>
				this._executeValidated(block, options),
			validate: async (block: Block) => this._validate(block),
		};
	}
}
