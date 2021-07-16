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

import { getAddressFromPublicKey } from '@liskhq/lisk-cryptography';
import { BFT } from '@liskhq/lisk-bft';
import { Chain, Block, BlockHeader } from '@liskhq/lisk-chain';
import { BaseSynchronizer } from './base_synchronizer';
import { clearBlocksTempTable, restoreBlocks, deleteBlocksAfterHeight } from './utils';
import { ApplyPenaltyAndAbortError, AbortError, BlockProcessingError } from './errors';
import { Logger } from '../../../logger';
import { BlockExecutor } from './type';
import { Network } from '../../network';

interface FastChainSwitchingMechanismInput {
	readonly logger: Logger;
	readonly bft: BFT;
	readonly chain: Chain;
	readonly blockExecutor: BlockExecutor;
	readonly network: Network;
}

export class FastChainSwitchingMechanism extends BaseSynchronizer {
	private readonly bft: BFT;
	private readonly blockExecutor: BlockExecutor;

	public constructor({
		logger,
		chain,
		bft,
		blockExecutor,
		network,
	}: FastChainSwitchingMechanismInput) {
		super(logger, chain, network);
		this._chain = chain;
		this.bft = bft;
		this.blockExecutor = blockExecutor;
	}

	public async run(receivedBlock: Block, peerId: string): Promise<void> {
		const highestCommonBlock = await this._requestLastCommonBlock(peerId);
		const blocks = await this._queryBlocks(receivedBlock, highestCommonBlock, peerId);
		await this._validateBlocks(blocks, peerId);
		await this._switchChain(highestCommonBlock as BlockHeader, blocks, peerId);
	}

	public async isValidFor(receivedBlock: Block, peerId: string): Promise<boolean> {
		if (!peerId) {
			// If peerId is not specified, fast chain switching cannot be done
			return false;
		}
		const { lastBlock } = this._chain;

		// 3. Step: Check whether B justifies fast chain switching mechanism
		const twoRounds = this._chain.numberOfValidators * 2;
		if (Math.abs(receivedBlock.header.height - lastBlock.header.height) > twoRounds) {
			return false;
		}

		const generatorAddress = getAddressFromPublicKey(receivedBlock.header.generatorPublicKey);

		const validators = await this._chain.getValidators();

		return (
			validators.find(v => v.address.equals(generatorAddress) && v.isConsensusParticipant) !==
			undefined
		);
	}

	private async _requestBlocksWithinIDs(
		peerId: string,
		fromId: Buffer,
		toId: Buffer,
	): Promise<Block[]> {
		const maxFailedAttempts = 10;
		const blocks = [];
		let failedAttempts = 0; // Failed attempt === the peer doesn't return any block or there is a network failure (no response or takes too long to answer)
		let lastFetchedID = fromId;
		while (failedAttempts < maxFailedAttempts) {
			let chunkOfBlocks: Block[] = [];
			try {
				chunkOfBlocks = await this._getBlocksFromNetwork(peerId, lastFetchedID);
			} catch (error) {
				failedAttempts += 1;
				continue;
			}

			// Sort blocks with height in ascending order because blocks are returned in descending order
			chunkOfBlocks.sort((a, b) => a.header.height - b.header.height);
			blocks.push(...chunkOfBlocks);
			[
				{
					header: { id: lastFetchedID },
				},
			] = chunkOfBlocks.slice(-1);
			const index = blocks.findIndex(block => block.header.id.equals(toId));
			if (index > -1) {
				return blocks.splice(0, index + 1); // Removes unwanted extra blocks
			}
		}

		return blocks;
	}

	private async _queryBlocks(
		receivedBlock: Block,
		highestCommonBlock: BlockHeader | undefined,
		peerId: string,
	): Promise<Block[]> {
		if (!highestCommonBlock) {
			throw new ApplyPenaltyAndAbortError(peerId, "Peer didn't return a common block");
		}

		if (highestCommonBlock.height < this.bft.finalizedHeight) {
			throw new ApplyPenaltyAndAbortError(
				peerId,
				`Common block height ${highestCommonBlock.height} is lower than the finalized height of the chain ${this.bft.finalizedHeight}`,
			);
		}

		if (
			this._chain.lastBlock.header.height - highestCommonBlock.height >
				this._chain.numberOfValidators * 2 ||
			receivedBlock.header.height - highestCommonBlock.height > this._chain.numberOfValidators * 2
		) {
			throw new AbortError(
				`Height difference between both chains is higher than ${
					this._chain.numberOfValidators * 2
				}`,
			);
		}

		this._logger.debug(
			{
				peerId,
				fromBlockId: highestCommonBlock.id,
				toBlockId: receivedBlock.header.id,
			},
			'Requesting blocks within ID range from peer',
		);

		const blocks = await this._requestBlocksWithinIDs(
			peerId,
			highestCommonBlock.id,
			receivedBlock.header.id,
		);

		if (!blocks.length) {
			throw new ApplyPenaltyAndAbortError(
				peerId,
				`Peer didn't return any requested block within IDs ${highestCommonBlock.id.toString(
					'hex',
				)} and ${receivedBlock.header.id.toString('hex')}`,
			);
		}

		return blocks;
	}

	private async _validateBlocks(blocks: ReadonlyArray<Block>, peerId: string): Promise<void> {
		this._logger.debug(
			{
				blocks: blocks.map(block => ({
					blockId: block.header.id,
					height: block.header.height,
				})),
			},
			'Validating blocks',
		);
		try {
			for (const block of blocks) {
				this._logger.trace(
					{
						blockId: block.header.id,
						height: block.header.height,
					},
					'Validating block',
				);
				await this.blockExecutor.validate(block);
			}
		} catch (err) {
			throw new ApplyPenaltyAndAbortError(peerId, 'Block validation failed');
		}
		this._logger.debug('Successfully validated blocks');
	}

	private async _applyBlocks(blocksToApply: ReadonlyArray<Block>): Promise<void> {
		try {
			for (const block of blocksToApply) {
				if (this._stop) {
					return;
				}
				this._logger.trace(
					{
						blockId: block.header.id,
						height: block.header.height,
					},
					'Applying blocks',
				);
				await this.blockExecutor.executeValidated(block);
			}
		} catch (e) {
			throw new BlockProcessingError();
		}
	}

	private async _handleBlockProcessingFailure(
		error: Error,
		highestCommonBlock: BlockHeader,
		peerId: string,
	): Promise<void> {
		this._logger.error({ err: error }, 'Error while processing blocks');
		this._logger.debug({ height: highestCommonBlock.height }, 'Deleting blocks after height');
		await deleteBlocksAfterHeight(
			this.blockExecutor,
			this._chain,
			this._logger,
			highestCommonBlock.height,
		);
		this._logger.debug('Restoring blocks from temporary table');
		await restoreBlocks(this._chain, this.blockExecutor);
		throw new ApplyPenaltyAndAbortError(
			peerId,
			'Detected invalid block while processing list of requested blocks',
		);
	}

	private async _switchChain(
		highestCommonBlock: BlockHeader,
		blocksToApply: ReadonlyArray<Block>,
		peerId: string,
	): Promise<void> {
		this._logger.info('Switching chain');
		this._logger.debug(
			{ height: highestCommonBlock.height },
			`Deleting blocks after height ${highestCommonBlock.height}`,
		);

		await deleteBlocksAfterHeight(
			this.blockExecutor,
			this._chain,
			this._logger,
			highestCommonBlock.height,
			true,
		);

		try {
			this._logger.debug(
				{
					blocks: blocksToApply.map(block => ({
						blockId: block.header.id,
						height: block.header.height,
					})),
				},
				'Applying blocks',
			);
			await this._applyBlocks(blocksToApply);
			this._logger.info(
				{
					currentHeight: this._chain.lastBlock.header.height,
					highestCommonBlockHeight: highestCommonBlock.height,
				},
				'Successfully switched chains. Node is now up to date',
			);
		} catch (err) {
			if (err instanceof BlockProcessingError) {
				await this._handleBlockProcessingFailure(err, highestCommonBlock, peerId);
			} else {
				throw err;
			}
		} finally {
			this._logger.debug('Cleaning blocks temp table');
			await clearBlocksTempTable(this._chain);
		}
	}

	private _computeLastTwoRoundsHeights(): number[] {
		return new Array(
			Math.min(this._chain.numberOfValidators * 2, this._chain.lastBlock.header.height),
		)
			.fill(0)
			.map((_, index) => this._chain.lastBlock.header.height - index);
	}

	/**
	 * Requests the last common block in common with the targeted peer.
	 * In order to do that, sends a set of network calls which include a set of block ids
	 * corresponding to the first block of descendent consecutive rounds (starting from the last one).
	 */
	private async _requestLastCommonBlock(peerId: string): Promise<BlockHeader | undefined> {
		this._logger.debug({ peerId }, 'Requesting the last common block with peer');
		const requestLimit = 10; // Maximum number of requests to be made to the remote peer
		let numberOfRequests = 1; // Keeps track of the number of requests made to the remote peer

		const heightList = this._computeLastTwoRoundsHeights();

		while (numberOfRequests < requestLimit) {
			const blockIds = (await this._chain.dataAccess.getBlockHeadersWithHeights(heightList)).map(
				block => block.id,
			);

			// Request the highest common block with the previously computed list
			// to the given peer
			try {
				const commonBlock = await this._getHighestCommonBlockFromNetwork(peerId, blockIds);
				return commonBlock;
			} catch (error) {
				numberOfRequests += 1;
			}
		}

		return undefined;
	}
}
