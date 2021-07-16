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

import { ForkStatus } from '@liskhq/lisk-bft';
import { Block } from '@liskhq/lisk-chain';
import {
	restoreBlocks,
	restoreBlocksUponStartup,
} from '../../../../../src/node/consensus/synchronizer/utils';
import { createValidDefaultBlock } from '../../../../fixtures';

describe('#synchronizer/utils', () => {
	let chainMock: any;
	let bftMock: any;
	let blockExecutor: any;
	let loggerMock: any;

	beforeEach(async () => {
		chainMock = {
			lastBlock: await createValidDefaultBlock({ header: { height: 1 } }),
			dataAccess: {
				getTempBlocks: jest.fn(),
				clearTempBlocks: jest.fn(),
			},
		};

		bftMock = {
			forkChoice: jest.fn(),
		};

		loggerMock = {
			info: jest.fn(),
			debug: jest.fn(),
			error: jest.fn(),
		};

		blockExecutor = {
			executeValidated: jest.fn(),
			deleteLastBlock: jest.fn(),
		};
	});

	describe('restoreBlocks()', () => {
		it('should return true on success', async () => {
			// Arrange
			const blocks = [await createValidDefaultBlock(), await createValidDefaultBlock()];
			chainMock.dataAccess.getTempBlocks = jest.fn().mockReturnValue(blocks);

			// Act
			const result = await restoreBlocks(chainMock, blockExecutor);

			// Assert
			expect(result).toBeTruthy();
		});

		it('should pass block to executeValidated with right flags', async () => {
			// Arrange
			const blocks = [await createValidDefaultBlock(), await createValidDefaultBlock()];
			chainMock.dataAccess.getTempBlocks = jest.fn().mockReturnValue(blocks);

			// Act
			await restoreBlocks(chainMock, blockExecutor);

			// Assert
			expect(chainMock.dataAccess.getTempBlocks).toHaveBeenCalled();
			expect(blockExecutor.executeValidated).toHaveBeenCalledTimes(2);
			expect(blockExecutor.executeValidated).toHaveBeenNthCalledWith(1, blocks[0], {
				removeFromTempTable: true,
			});
			expect(blockExecutor.executeValidated).toHaveBeenNthCalledWith(2, blocks[1], {
				removeFromTempTable: true,
			});
		});

		it('should return false when temp_blocks table is empty', async () => {
			// Arrange
			chainMock.dataAccess.getTempBlocks = jest.fn().mockReturnValue([]);

			// Act
			const result = await restoreBlocks(chainMock, blockExecutor);

			// Assert
			expect(result).toBeFalsy();
			expect(chainMock.dataAccess.getTempBlocks).toHaveBeenCalled();
			expect(blockExecutor.executeValidated).not.toHaveBeenCalled();
		});
	});

	describe('restoreBlocksUponStartup()', () => {
		let tempBlocks: Block[];
		beforeEach(async () => {
			tempBlocks = [
				await createValidDefaultBlock({
					header: {
						height: 11,
						asset: {
							maxHeightPrevoted: 5,
							seedReveal: Buffer.alloc(0),
							maxHeightPreviouslyForged: 0,
						},
					},
				}),
				await createValidDefaultBlock({
					header: {
						height: 10,
						asset: {
							maxHeightPrevoted: 6,
							seedReveal: Buffer.alloc(0),
							maxHeightPreviouslyForged: 0,
						},
					},
				}),
			];
			chainMock.dataAccess.getTempBlocks.mockResolvedValue(tempBlocks);
		});

		it('should restore blocks if fork status = ForkStatus.DIFFERENT_CHAIN', async () => {
			// Arrange
			bftMock.forkChoice.mockReturnValue(ForkStatus.DIFFERENT_CHAIN);

			// Act
			await restoreBlocksUponStartup(loggerMock, chainMock, bftMock, blockExecutor);

			// Assert
			expect(chainMock.dataAccess.getTempBlocks).toHaveBeenCalled();
		});

		it('should restore blocks if fork status = ForkStatus.VALID_BLOCK', async () => {
			// Arrange
			bftMock.forkChoice.mockReturnValue(ForkStatus.VALID_BLOCK);

			// Act
			await restoreBlocksUponStartup(loggerMock, chainMock, bftMock, blockExecutor);

			// Assert
			expect(chainMock.dataAccess.getTempBlocks).toHaveBeenCalled();
		});

		it('should truncate temp_blocks table if fork status != ForkStatus.DIFFERENT_CHAIN || != ForkStatus.VALID_BLOCK', async () => {
			// Arrange
			bftMock.forkChoice.mockReturnValue(ForkStatus.DISCARD);
			blockExecutor.deleteLastBlock.mockResolvedValue({ height: 0 });

			chainMock.lastBlock = {
				header: {
					id: Buffer.from('999999'),
					height: 1,
				},
			};

			// Act
			await restoreBlocksUponStartup(loggerMock, chainMock, bftMock, blockExecutor);

			// Assert
			expect(chainMock.dataAccess.getTempBlocks).toHaveBeenCalled();
		});

		it('should call forkStatus with lowest block object', async () => {
			// Arrange
			bftMock.forkChoice.mockReturnValue(ForkStatus.DIFFERENT_CHAIN);

			// Act
			await restoreBlocksUponStartup(loggerMock, chainMock, bftMock, blockExecutor);

			// Assert
			expect(bftMock.forkChoice).toHaveBeenCalledWith(
				tempBlocks[1].header,
				chainMock.lastBlock.header,
			);
		});
	});
});
