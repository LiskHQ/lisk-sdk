/*
 * Copyright © 2018 Lisk Foundation
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
import { Block, Chain, BlockHeader } from '@liskhq/lisk-chain';
import { dataStructures } from '@liskhq/lisk-utils';
import { BaseSynchronizer } from './base_synchronizer';
import {
	computeLargestSubsetMaxBy,
	computeBlockHeightsList,
	deleteBlocksAfterHeight,
	restoreBlocks,
	clearBlocksTempTable,
} from './utils';
import {
	AbortError,
	ApplyPenaltyAndRestartError,
	RestartError,
	BlockProcessingError,
} from './errors';
import { BlockExecutor } from './type';
import { Logger } from '../../../logger';
import { Network } from '../../network';

interface Peer {
	readonly peerId: string;
	readonly options: {
		readonly maxHeightPrevoted: number;
		readonly lastBlockID: Buffer;
		readonly height: number;
		readonly blockVersion: number;
	};
}

interface BlockSynchronizationMechanismInput {
	readonly logger: Logger;
	readonly bft: BFT;
	readonly chain: Chain;
	readonly blockExecutor: BlockExecutor;
	readonly network: Network;
}

const groupByPeer = (peers: Peer[]): dataStructures.BufferMap<Peer[]> => {
	const groupedPeers = new dataStructures.BufferMap<Peer[]>();
	for (const peer of peers) {
		let grouped = groupedPeers.get(peer.options.lastBlockID);
		if (grouped === undefined) {
			grouped = [];
		}
		grouped.push(peer);
		groupedPeers.set(peer.options.lastBlockID, grouped);
	}
	return groupedPeers;
};

export class BlockSynchronizationMechanism extends BaseSynchronizer {
	private readonly bft: BFT;
	private readonly blockExecutor: BlockExecutor;

	public constructor({
		logger,
		bft,
		chain,
		blockExecutor: processorModule,
		network: networkModule,
	}: BlockSynchronizationMechanismInput) {
		super(logger, chain, networkModule);
		this.bft = bft;
		this._chain = chain;
		this.blockExecutor = processorModule;
	}

	// eslint-disable-next-line consistent-return
	public async run(receivedBlock: Block): Promise<void> {
		const bestPeer = this._computeBestPeer();
		await this._requestAndValidateLastBlock(bestPeer.peerId);
		const lastCommonBlock = await this._revertToLastCommonBlock(bestPeer.peerId);
		await this._requestAndApplyBlocksToCurrentChain(
			receivedBlock,
			lastCommonBlock,
			bestPeer.peerId,
		);
	}

	public async isValidFor(): Promise<boolean> {
		// 2. Step: Check whether current chain justifies triggering the block synchronization mechanism
		const finalizedBlock = await this._chain.dataAccess.getBlockHeaderByHeight(
			this.bft.finalizedHeight,
		);
		const finalizedBlockSlot = this._chain.slots.getSlotNumber(finalizedBlock.timestamp);
		const currentBlockSlot = this._chain.slots.getSlotNumber();
		const threeRounds = this._chain.numberOfValidators * 3;

		return currentBlockSlot - finalizedBlockSlot > threeRounds;
	}

	private async _requestAndApplyBlocksWithinIDs(
		peerId: string,
		fromId: Buffer,
		toId: Buffer,
	): Promise<void> {
		const maxFailedAttempts = 10;
		let failedAttempts = 0; // Failed attempt === the peer doesn't return any block or there is a network failure (no response or takes too long to answer)
		let lastFetchedID = fromId;
		let finished = false;

		while (!finished && failedAttempts < maxFailedAttempts) {
			let blocks: Block[] = [];
			try {
				blocks = await this._getBlocksFromNetwork(peerId, lastFetchedID);
			} catch (error) {
				failedAttempts += 1;
				continue;
			}

			// Sort blocks with height in ascending order because blocks are returned in descending order
			blocks.sort((a, b) => a.header.height - b.header.height);
			[
				{
					header: { id: lastFetchedID },
				},
			] = blocks.slice(-1);
			const index = blocks.findIndex(block => block.header.id.equals(toId));
			if (index > -1) {
				blocks.splice(index + 1); // Removes unwanted extra blocks
			}

			this._logger.debug(
				{
					fromId: blocks[0].header.id,
					toId: blocks[blocks.length - 1].header.id,
				},
				'Applying obtained blocks from peer',
			);

			try {
				for (const block of blocks) {
					if (this._stop) {
						return;
					}
					await this.blockExecutor.validate(block);
					await this.blockExecutor.executeValidated(block);
				}
			} catch (err) {
				this._logger.error({ err: err as Error }, 'Block processing failed');
				throw new BlockProcessingError();
			}

			finished = this._chain.lastBlock.header.id.equals(toId);
		}

		if (failedAttempts === maxFailedAttempts) {
			throw new ApplyPenaltyAndRestartError(
				peerId,
				"Peer didn't return any block after requesting blocks",
			);
		}
	}

	/**
	 * When there is a failure applying blocks received from the peer,
	 * it's required to check whether the tip of the temp block chain has
	 * preference over the current tip. If so, the temporary chain is restored
	 * on top of the current chain and the blocks temp table is cleaned up
	 */
	private async _handleBlockProcessingError(
		lastCommonBlock: BlockHeader,
		peerId: string,
	): Promise<void> {
		// If the list of blocks has not been fully applied
		this._logger.debug('Failed to apply obtained blocks from peer');
		const tempBlocks = await this._chain.dataAccess.getTempBlocks();
		const [tipBeforeApplying] = [...tempBlocks].sort((a, b) => b.header.height - a.header.height);

		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		if (!tipBeforeApplying) {
			this._logger.error('Blocks temp table should not be empty');
			throw new RestartError('Blocks temp table should not be empty');
		}

		// Check if the new tip has priority over the last tip we had before applying
		const forkStatus = this.bft.forkChoice(
			this._chain.lastBlock.header, // New tip of the chain
			tipBeforeApplying.header, // Previous tip of the chain
		);

		const newTipHasPreference = forkStatus === ForkStatus.DIFFERENT_CHAIN;

		if (!newTipHasPreference) {
			this._logger.debug(
				{
					currentTip: this._chain.lastBlock.header.id,
					previousTip: tipBeforeApplying.header.id,
				},
				'Previous tip of the chain has preference over current tip. Restoring chain from temp table',
			);
			try {
				this._logger.debug({ height: lastCommonBlock.height }, 'Deleting blocks after height');
				await deleteBlocksAfterHeight(
					this.blockExecutor,
					this._chain,
					this._logger,
					lastCommonBlock.height,
				);
				this._logger.debug('Restoring blocks from temporary table');
				await restoreBlocks(this._chain, this.blockExecutor);

				this._logger.debug('Cleaning blocks temp table');
				await clearBlocksTempTable(this._chain);
			} catch (error) {
				this._logger.error(
					{ err: error as Error },
					'Failed to restore blocks from blocks temp table',
				);
			}
			throw new ApplyPenaltyAndRestartError(
				peerId,
				'New tip of the chain has no preference over the previous tip before synchronizing',
			);
		}

		this._logger.debug(
			{
				currentTip: this._chain.lastBlock.header.id,
				previousTip: tipBeforeApplying.header.id,
			},
			'Current tip of the chain has preference over previous tip',
		);

		this._logger.debug('Cleaning blocks temporary table');
		await clearBlocksTempTable(this._chain);

		this._logger.info('Restarting block synchronization');

		throw new RestartError('The list of blocks has not been fully applied. Trying again');
	}

	private async _requestAndApplyBlocksToCurrentChain(
		receivedBlock: Block,
		lastCommonBlock: BlockHeader,
		peerId: string,
	): Promise<boolean> {
		this._logger.debug(
			{
				peerId,
				from: {
					blockId: lastCommonBlock.id,
					height: lastCommonBlock.height,
				},
				to: {
					blockId: receivedBlock.header.id,
					height: receivedBlock.header.height,
				},
			},
			'Requesting blocks within ID range from peer',
		);

		try {
			await this._requestAndApplyBlocksWithinIDs(
				peerId,
				lastCommonBlock.id,
				receivedBlock.header.id,
			);
		} catch (err) {
			if (!(err instanceof BlockProcessingError)) {
				throw err;
			}
			await this._handleBlockProcessingError(lastCommonBlock, peerId);
		}

		this._logger.debug('Cleaning up blocks temporary table');
		await clearBlocksTempTable(this._chain);

		this._logger.debug({ peerId }, 'Successfully requested and applied blocks from peer');

		return true;
	}

	private async _revertToLastCommonBlock(peerId: string): Promise<BlockHeader> {
		this._logger.debug({ peerId }, 'Reverting chain to the last common block with peer');

		this._logger.debug({ peerId }, 'Requesting the last common block from peer');
		const lastCommonBlock = await this._requestLastCommonBlock(peerId);

		if (!lastCommonBlock) {
			throw new ApplyPenaltyAndRestartError(
				peerId,
				'No common block has been found between the chain and the targeted peer',
			);
		}

		this._logger.debug(
			{
				blockId: lastCommonBlock.id,
				height: lastCommonBlock.height,
			},
			'Found common block',
		);

		if (lastCommonBlock.height < this.bft.finalizedHeight) {
			throw new ApplyPenaltyAndRestartError(
				peerId,
				'The last common block height is less than the finalized height of the current chain',
			);
		}

		this._logger.debug(
			{
				blockId: lastCommonBlock.id,
				height: lastCommonBlock.height,
			},
			'Deleting blocks after common block',
		);

		await deleteBlocksAfterHeight(
			this.blockExecutor,
			this._chain,
			this._logger,
			lastCommonBlock.height,
			true,
		);

		this._logger.debug(
			{ lastBlockID: this._chain.lastBlock.header.id },
			'Successfully deleted blocks',
		);

		return lastCommonBlock;
	}

	/**
	 * Requests the last common block in common with the targeted peer.
	 * In order to do that, sends a set of network calls which include a set of block ids
	 * corresponding to the first block of descendent consecutive rounds (starting from the last one).
	 */
	private async _requestLastCommonBlock(peerId: string): Promise<BlockHeader | undefined> {
		const blocksPerRequestLimit = 10; // Maximum number of block IDs to be included in a single request
		const requestLimit = 3; // Maximum number of requests to be made to the remote peer

		let numberOfRequests = 1; // Keeps track of the number of requests made to the remote peer
		let highestCommonBlock; // Holds the common block returned by the peer if found.
		let currentRound = Math.ceil(
			this._chain.lastBlock.header.height / this._chain.numberOfValidators,
		); // Holds the current round number
		let currentHeight = currentRound * this._chain.numberOfValidators;

		while (
			!highestCommonBlock &&
			numberOfRequests < requestLimit &&
			currentHeight >= this.bft.finalizedHeight
		) {
			const heightList = computeBlockHeightsList(
				this.bft.finalizedHeight,
				this._chain.numberOfValidators,
				blocksPerRequestLimit,
				currentRound,
			);

			const blockHeaders = await this._chain.dataAccess.getBlockHeadersWithHeights(heightList);

			let data: BlockHeader | undefined;

			try {
				// Request the highest common block with the previously computed list
				// to the given peer
				data = await this._getHighestCommonBlockFromNetwork(
					peerId,
					blockHeaders.map(block => block.id),
				);
			} catch (e) {
				numberOfRequests += 1;
				continue;
			}

			highestCommonBlock = data; // If no common block, data is undefined.

			currentRound -= blocksPerRequestLimit;
			currentHeight = currentRound * this._chain.numberOfValidators;
		}

		return highestCommonBlock;
	}

	/**
	 * Requests the last full block from an specific peer and performs
	 * validations against this block after it has been received.
	 * If valid, the full block is returned.
	 * If invalid, an exception is thrown.
	 *
	 * This behavior is defined in section `2. Step: Obtain tip of chain` in LIP-0014
	 * @link https://github.com/LiskHQ/lips/blob/master/proposals/lip-0014.md#block-synchronization-mechanism
	 */
	private async _requestAndValidateLastBlock(peerId: string): Promise<void> {
		this._logger.debug({ peerId }, 'Requesting tip of the chain from peer');

		const networkLastBlock = await this._getLastBlockFromNetwork(peerId);

		this._logger.debug(
			{ peerId, blockId: networkLastBlock.header.id },
			'Received tip of the chain from peer',
		);

		const { valid: validBlock } = await this._blockDetachedStatus(networkLastBlock);

		const forkStatus = this.bft.forkChoice(networkLastBlock.header, this._chain.lastBlock.header);

		const inDifferentChain =
			forkStatus === ForkStatus.DIFFERENT_CHAIN ||
			networkLastBlock.header.id.equals(this._chain.lastBlock.header.id);
		if (!validBlock || !inDifferentChain) {
			throw new ApplyPenaltyAndRestartError(
				peerId,
				'The tip of the chain of the peer is not valid or is not in a different chain',
			);
		}
	}

	/**
	 * This wrappers allows us to check using an if
	 * instead of forcing us to use a try/catch block
	 * for branching code execution.
	 * The original method works well in the context
	 * of the Pipeline but not in other cases
	 * that's why we wrap it here.
	 */
	private async _blockDetachedStatus(
		networkLastBlock: Block,
	): Promise<{ valid: boolean; err: Error | null }> {
		try {
			await this.blockExecutor.validate(networkLastBlock);
			return { valid: true, err: null };
		} catch (err) {
			return { valid: false, err: err as Error };
		}
	}

	/**
	 * Computes the best peer to continue working with
	 * according to the set of rules defined in Step 1. of Block Synchronization Mechanism
	 *
	 * @link https://github.com/LiskHQ/lips/blob/master/proposals/lip-0014.md#block-synchronization-mechanism
	 */
	private _computeBestPeer(): Peer {
		const peers = (this._network.getConnectedPeers() as unknown) as Peer[];

		if (!peers.length) {
			throw new Error('List of connected peers is empty');
		}

		this._logger.trace({ peers: peers.map(peer => peer.peerId) }, 'List of connected peers');

		const requiredProps = ['blockVersion', 'maxHeightPrevoted', 'height'];
		const compatiblePeers = peers.filter(p =>
			requiredProps.every(prop => Object.keys(p.options).includes(prop)),
		);

		if (!compatiblePeers.length) {
			throw new Error('Connected compatible peers list is empty');
		}

		this._logger.trace(
			{ peers: compatiblePeers.map(peer => peer.peerId) },
			'List of compatible peers connected peers',
		);
		this._logger.debug('Computing the best peer to synchronize from');
		// Largest subset of peers with largest maxHeightPrevoted
		const largestSubsetBymaxHeightPrevoted = computeLargestSubsetMaxBy(
			compatiblePeers,
			peer => peer.options.maxHeightPrevoted,
		);
		// Largest subset of peers with largest height
		const largestSubsetByHeight = computeLargestSubsetMaxBy(
			largestSubsetBymaxHeightPrevoted,
			peer => peer.options.height,
		);
		// Group peers by their block Id
		const peersGroupedByBlockId = groupByPeer(largestSubsetByHeight);

		const blockIds = peersGroupedByBlockId.entries();
		let maxNumberOfPeersInSet = 0;
		let selectedPeers: Peer[] = [];
		let selectedBlockId = blockIds[0][0];
		// Find the largest subset with same block ID
		// eslint-disable-next-line no-restricted-syntax
		for (const [blockId, peersByBlockId] of blockIds) {
			const numberOfPeersInSet = peersByBlockId.length;
			if (
				numberOfPeersInSet > maxNumberOfPeersInSet ||
				(numberOfPeersInSet === maxNumberOfPeersInSet && selectedBlockId.compare(blockId) > 0)
			) {
				maxNumberOfPeersInSet = numberOfPeersInSet;
				selectedPeers = peersByBlockId;
				selectedBlockId = blockId;
			}
		}

		// Pick random peer from list
		const randomPeerIndex = Math.floor(Math.random() * selectedPeers.length);
		const peersTip = {
			id: Buffer.alloc(0),
			height: selectedPeers[randomPeerIndex].options.height,
			version: selectedPeers[randomPeerIndex].options.blockVersion,
			previousBlockID: Buffer.alloc(0),
			asset: {
				maxHeightPrevoted: selectedPeers[randomPeerIndex].options.maxHeightPrevoted,
			},
		};

		const forkStatus = this.bft.forkChoice(peersTip as BlockHeader, this._chain.lastBlock.header);

		const tipHasPreference = forkStatus === ForkStatus.DIFFERENT_CHAIN;

		if (!tipHasPreference) {
			throw new AbortError(
				`Peer tip does not have preference over current tip. Fork status: ${forkStatus}`,
			);
		}

		const bestPeer = selectedPeers[Math.floor(Math.random() * selectedPeers.length)];

		this._logger.debug({ peer: bestPeer }, 'Successfully computed the best peer');

		return bestPeer;
	}
}
