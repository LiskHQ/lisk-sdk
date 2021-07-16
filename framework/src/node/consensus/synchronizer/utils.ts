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
import { Chain } from '@liskhq/lisk-chain';
import { BlockExecutor } from './type';
import { Logger } from '../../../logger';

export const restoreBlocks = async (
	chainModule: Chain,
	processorModule: BlockExecutor,
): Promise<boolean> => {
	const tempBlocks = await chainModule.dataAccess.getTempBlocks();

	if (tempBlocks.length === 0) {
		return false;
	}

	for (const tempBlock of tempBlocks.reverse()) {
		await processorModule.executeValidated(tempBlock, {
			removeFromTempTable: true,
		});
	}

	return true;
};

export const clearBlocksTempTable = async (chainModule: Chain): Promise<void> =>
	chainModule.dataAccess.clearTempBlocks();

export const deleteBlocksAfterHeight = async (
	processorModule: BlockExecutor,
	chainModule: Chain,
	logger: Logger,
	desiredHeight: number,
	backup = false,
): Promise<void> => {
	let { height: currentHeight } = chainModule.lastBlock.header;
	logger.debug({ desiredHeight, lastBlockHeight: currentHeight }, 'Deleting blocks after height');
	while (desiredHeight < currentHeight) {
		logger.trace(
			{
				height: chainModule.lastBlock.header.height,
				blockId: chainModule.lastBlock.header.id,
			},
			'Deleting block and backing it up to temporary table',
		);
		await processorModule.deleteLastBlock({
			saveTempBlock: backup,
		});
		currentHeight = chainModule.lastBlock.header.height;
	}
};

/**
 * Allows to restore blocks if there are blocks left upon startup in temp_blocks table (e.g. node crashed)
 * Depends upon fork choice rule if blocks will be applied
 *
 * 1. Gets all blocks from temp_blocks table
 * 2. Sort blocks according to height as we want to lowest height (the next block to be applied)
 * 3. Uses next block with fork choice rule - if fork status indicates we should switch to different chain
 * we continue applying blocks using the `restoreBlocks` function.
 * Otherwise we truncate the temp_blocks table.
 */
export const restoreBlocksUponStartup = async (
	logger: Logger,
	chainModule: Chain,
	bftModule: BFT,
	processorModule: BlockExecutor,
): Promise<void> => {
	// Get all blocks and find lowest height (next one to be applied), as it should return in height desc
	const tempBlocks = await chainModule.dataAccess.getTempBlocks();
	const blockLowestHeight = tempBlocks[tempBlocks.length - 1];
	const blockHighestHeight = tempBlocks[0];

	const forkStatus = bftModule.forkChoice(blockHighestHeight.header, chainModule.lastBlock.header);
	const blockHasPriority =
		forkStatus === ForkStatus.DIFFERENT_CHAIN || forkStatus === ForkStatus.VALID_BLOCK;

	// Block in the temp table has preference over current tip of the chain
	if (blockHasPriority) {
		logger.info('Restoring blocks from temporary table');
		await deleteBlocksAfterHeight(
			processorModule,
			chainModule,
			logger,
			blockLowestHeight.header.height - 1,
			false,
		);
		// In case fork status is DIFFERENT_CHAIN - try to apply blocks from temp_blocks table
		await restoreBlocks(chainModule, processorModule);
		logger.info('Chain successfully restored');
	} else {
		// Not different chain - Delete remaining blocks from temp_blocks table
		await clearBlocksTempTable(chainModule);
	}
};

export const computeBlockHeightsList = (
	finalizedHeight: number,
	activeDelegates: number,
	listSizeLimit: number,
	currentRound: number,
): number[] => {
	const startingHeight = Math.max((currentRound - 1) * activeDelegates, 0);
	const heightList = new Array(listSizeLimit)
		.fill(0)
		.map((_, i) => startingHeight - i * activeDelegates)
		.filter(height => height >= 0);
	const heightListAfterFinalized = heightList.filter(height => height > finalizedHeight);
	return heightList.length !== heightListAfterFinalized.length
		? [...heightListAfterFinalized, finalizedHeight]
		: heightListAfterFinalized;
};

export const computeLargestSubsetMaxBy = <T>(
	arrayOfObjects: T[],
	propertySelectorFunc: (param: T) => number,
): T[] => {
	const comparableValues = arrayOfObjects.map(propertySelectorFunc);
	const absoluteMax = Math.max(...comparableValues);
	const largestSubset = [];
	// eslint-disable-next-line no-restricted-syntax
	for (const item of arrayOfObjects) {
		if (propertySelectorFunc(item) === absoluteMax) {
			largestSubset.push(item);
		}
	}
	return largestSubset;
};
