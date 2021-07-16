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

import { when } from 'jest-when';
import { Block, Chain } from '@liskhq/lisk-chain';
import { BFT } from '@liskhq/lisk-bft';
import { KVStore } from '@liskhq/lisk-db';

import { Synchronizer } from '../../../../../src/node/consensus/synchronizer/synchronizer';
import { constants } from '../../../../utils';
import {
	createValidDefaultBlock,
	defaultNetworkIdentifier,
	genesisBlock as getGenesisBlock,
} from '../../../../fixtures/blocks';
import * as synchronizerUtils from '../../../../../src/node/consensus/synchronizer/utils';
import { defaultAccountSchema } from '../../../../fixtures';
import { BlockExecutor } from '../../../../../src/node/consensus/synchronizer/type';

jest.mock('@liskhq/lisk-db');

describe('Synchronizer', () => {
	const genesisBlock = getGenesisBlock();
	let bftModule: any;
	let chainModule: any;
	let blockExecutor: BlockExecutor;
	let synchronizer: Synchronizer;
	let syncMechanism1: any;
	let syncMechanism2: any;

	let loggerMock: any;
	let syncParameters;
	let dataAccessMock;

	beforeEach(() => {
		jest.spyOn(synchronizerUtils, 'restoreBlocksUponStartup');
		loggerMock = {
			info: jest.fn(),
			debug: jest.fn(),
			error: jest.fn(),
			trace: jest.fn(),
		};

		const blockchainDB = new KVStore('blockchain.db');

		chainModule = new Chain({
			networkIdentifier: defaultNetworkIdentifier,
			db: blockchainDB,
			genesisBlock,
			accountSchemas: defaultAccountSchema,
			maxPayloadLength: constants.maxPayloadLength,
			rewardDistance: constants.rewards.distance,
			rewardOffset: constants.rewards.offset,
			rewardMilestones: constants.rewards.milestones,
			blockTime: constants.blockTime,
			minFeePerByte: constants.minFeePerByte,
			baseFees: constants.baseFees,
		});

		dataAccessMock = {
			getConsensusState: jest.fn(),
			getTempBlocks: jest.fn(),
			getBlockHeadersWithHeights: jest.fn(),
			getBlockByID: jest.fn(),
			getLastBlock: jest.fn(),
			getBlockHeadersByHeightBetween: jest.fn(),
			addBlockHeader: jest.fn(),
			getLastBlockHeader: jest.fn(),
			clearTempBlocks: jest.fn(),
			isTempBlockEmpty: jest.fn(),
			getAccountsByPublicKey: jest.fn(),
			getBlockHeaderByHeight: jest.fn(),
			getBlockHeaderByID: jest.fn(),
			decode: chainModule.dataAccess.decode.bind(chainModule.dataAccess),
			encodeBlockHeader: chainModule.dataAccess.encodeBlockHeader.bind(chainModule.dataAccess),
			decodeTransaction: chainModule.dataAccess.decodeTransaction.bind(chainModule.dataAccess),
			getBlockHeaderAssetSchema: chainModule.dataAccess.getBlockHeaderAssetSchema.bind(
				chainModule.dataAccess,
			),
		};
		chainModule.dataAccess = dataAccessMock;

		bftModule = new BFT({
			chain: chainModule,
			threshold: constants.bftThreshold,
			genesisHeight: genesisBlock.header.height,
		});

		blockExecutor = {
			validate: jest.fn(),
			executeValidated: jest.fn(),
			deleteLastBlock: jest.fn(),
		};

		syncMechanism1 = {
			run: jest.fn().mockResolvedValue({}),
			isValidFor: jest.fn().mockResolvedValue(false),
		};
		syncMechanism2 = {
			run: jest.fn().mockResolvedValue({}),
			isValidFor: jest.fn().mockResolvedValue(false),
		};

		syncParameters = {
			logger: loggerMock,
			blockExecutor,
			chainModule,
			bftModule,
			mechanisms: [syncMechanism1, syncMechanism2],
		};

		synchronizer = new Synchronizer(syncParameters);
	});

	describe('init()', () => {
		beforeEach(async () => {
			// Arrange
			const lastBlock = await createValidDefaultBlock({
				header: { height: genesisBlock.header.height + 1 },
			});
			when(chainModule.dataAccess.getBlockHeaderByID)
				.calledWith(genesisBlock.header.id)
				.mockResolvedValue(genesisBlock.header as never);
			when(chainModule.dataAccess.getLastBlock)
				.calledWith()
				.mockResolvedValue(lastBlock as never);
			when(chainModule.dataAccess.getBlockHeadersByHeightBetween)
				.calledWith(0, 1)
				.mockResolvedValue([lastBlock] as never);
			when(chainModule.dataAccess.getAccountsByPublicKey)
				.calledWith()
				.mockResolvedValue([{ publicKey: 'aPublicKey' }] as never);
		});

		describe('given that the blocks temporary table is not empty', () => {
			beforeEach(() => {
				// Simulate blocks temporary table to be empty
				chainModule.dataAccess.isTempBlockEmpty.mockResolvedValue(false);
			});

			it('should restore blocks from blocks temporary table into blocks table if tip of temp table chain has preference over current tip (FORK_STATUS_DIFFERENT_CHAIN)', async () => {
				// Arrange
				const blocksTempTableEntries = (
					await Promise.all(
						new Array(10).fill(0).map(async (_, index) =>
							createValidDefaultBlock({
								header: {
									height: index,
									version: 2,
								},
							}),
						),
					)
				).slice(genesisBlock.header.height + 2);
				const initialLastBlock = await createValidDefaultBlock({
					header: {
						height: genesisBlock.header.height + 3,
						previousBlockID: genesisBlock.header.id,
						version: 1,
					},
				});

				// To load storage tip block into lastBlock in memory variable
				when(chainModule.dataAccess.getBlockHeadersByHeightBetween)
					.calledWith(0, 3)
					.mockResolvedValue([initialLastBlock] as never);

				when(chainModule.dataAccess.getTempBlocks)
					.calledWith()
					.mockResolvedValue(blocksTempTableEntries.reverse() as never);

				when(chainModule.dataAccess.getLastBlock)
					.calledWith()
					.mockResolvedValue(initialLastBlock as never);

				when(blockExecutor.deleteLastBlock as jest.Mock)
					.calledWith({
						saveTempBlock: false,
					})
					.mockImplementationOnce(() => {
						chainModule._lastBlock = {
							header: { height: initialLastBlock.header.height - 1 },
						};
					})
					.mockImplementationOnce(() => {
						chainModule._lastBlock = {
							header: { height: initialLastBlock.header.height - 2 },
						};
					});

				await chainModule.init();

				// Act
				await synchronizer.init();

				// Assert
				expect(loggerMock.info).toHaveBeenNthCalledWith(1, 'Restoring blocks from temporary table');
				expect(loggerMock.info).toHaveBeenNthCalledWith(2, 'Chain successfully restored');
				expect(blockExecutor.deleteLastBlock).toHaveBeenCalledTimes(2);
				expect(blockExecutor.executeValidated).toHaveBeenCalledTimes(blocksTempTableEntries.length);

				// Assert whether temp blocks are being restored to main table
				expect.assertions(blocksTempTableEntries.length + 4);
				for (let i = 0; i < blocksTempTableEntries.length; i += 1) {
					const tempBlock = blocksTempTableEntries[i];
					expect(blockExecutor.executeValidated).toHaveBeenNthCalledWith(i + 1, tempBlock, {
						removeFromTempTable: true,
					});
				}
			});

			it('should restore blocks from blocks temporary table into blocks table if tip of temp table chain has preference over current tip (FORK_STATUS_VALID_BLOCK)', async () => {
				// Arrange
				const initialLastBlock = await createValidDefaultBlock({
					header: {
						height: genesisBlock.header.height + 1,
						previousBlockID: genesisBlock.header.id,
						version: 1,
					},
				});
				const blocksTempTableEntries = [
					{
						header: {
							height: genesisBlock.header.height + 2,
							version: 2,
							previousBlockID: initialLastBlock.header.id,
						},
					},
				];
				chainModule.dataAccess.getTempBlocks.mockResolvedValue(blocksTempTableEntries);
				// To load storage tip block into lastBlock in memory variable
				when(chainModule.dataAccess.getLastBlock)
					.calledWith()
					.mockResolvedValue(initialLastBlock as never);

				await chainModule.init();

				// Act
				await synchronizer.init();

				// Assert
				expect(loggerMock.info).toHaveBeenNthCalledWith(1, 'Restoring blocks from temporary table');
				expect(loggerMock.info).toHaveBeenNthCalledWith(2, 'Chain successfully restored');

				expect(blockExecutor.executeValidated).toHaveBeenCalledTimes(blocksTempTableEntries.length);

				// Assert whether temp blocks are being restored to main table
				expect.assertions(blocksTempTableEntries.length + 3);
				for (let i = 0; i < blocksTempTableEntries.length; i += 1) {
					const tempBlock = blocksTempTableEntries[i];
					expect(blockExecutor.executeValidated).toHaveBeenNthCalledWith(i + 1, tempBlock, {
						removeFromTempTable: true,
					});
				}
			});

			it('should clear the blocks temp table if the tip of the temp table does not have priority over current tip (Any other Fork Choice code', async () => {
				// Arrange
				const initialLastBlock = await createValidDefaultBlock({
					header: {
						height: genesisBlock.header.height + 1,
						previousBlockID: genesisBlock.header.id,
						version: 2,
					},
				});
				const blocksTempTableEntries = [initialLastBlock];
				chainModule.dataAccess.getTempBlocks.mockResolvedValue(blocksTempTableEntries);
				// To load storage tip block into lastBlock in memory variable
				when(chainModule.dataAccess.getLastBlock)
					.calledWith()
					.mockResolvedValue(initialLastBlock as never);

				await chainModule.init();

				// Act
				await synchronizer.init();

				// Assert
				expect(blockExecutor.executeValidated).not.toHaveBeenCalled();
				expect(blockExecutor.deleteLastBlock).not.toHaveBeenCalled();
			});
		});

		it('should not do anything if blocks temporary table is empty', async () => {
			// Arrange
			chainModule.dataAccess.isTempBlockEmpty.mockResolvedValue(true);

			// Act
			await synchronizer.init();

			// Assert
			expect(synchronizerUtils.restoreBlocksUponStartup).not.toHaveBeenCalled();
		});

		it('should catch any errors and error log it', async () => {
			// Arrange
			const blocksTempTableEntries = (
				await Promise.all(
					new Array(10).fill(0).map(async (_, index) =>
						createValidDefaultBlock({
							header: {
								height: index,
								version: 2,
							},
						}),
					),
				)
			).slice(genesisBlock.header.height + 2);
			const initialLastBlock = await createValidDefaultBlock({
				header: {
					height: genesisBlock.header.height + 1,
					previousBlockID: genesisBlock.header.id,
					version: 1,
				},
			});
			chainModule.dataAccess.getTempBlocks.mockResolvedValue(blocksTempTableEntries.reverse());
			// To load storage tip block into lastBlock in memory variable
			when(chainModule.dataAccess.getLastBlock)
				.calledWith()
				.mockResolvedValue(initialLastBlock as never);

			const error = new Error('error while deleting last block');
			(blockExecutor.executeValidated as jest.Mock).mockRejectedValue(error);

			await chainModule.init();

			// Act
			await synchronizer.init();

			// Assert
			expect(loggerMock.error).toHaveBeenCalledWith(
				{ err: error },
				'Failed to restore blocks from temp table upon startup',
			);
		});
	});

	describe('constructor', () => {
		it('should assign passed mechanisms', () => {
			const aSyncingMechanism = {
				run: jest.fn().mockResolvedValue({}),
				isValidFor: jest.fn().mockResolvedValue(false),
			};
			const anotherSyncingMechanism = {
				run: jest.fn().mockResolvedValue({}),
				isValidFor: jest.fn().mockResolvedValue(false),
			};

			const aSynchronizer = new Synchronizer({
				logger: loggerMock,
				blockExecutor,
				chainModule,
				bftModule,
				mechanisms: [aSyncingMechanism, anotherSyncingMechanism] as any,
			});

			expect(aSynchronizer['mechanisms']).toInclude(aSyncingMechanism as any);
			expect(aSynchronizer['mechanisms']).toInclude(anotherSyncingMechanism as any);
		});

		it('should enforce mandatory interfaces for passed mechanisms (isValidFor)', () => {
			const aSyncingMechanism = {
				run: jest.fn().mockResolvedValue({}),
			};

			expect(
				() =>
					new Synchronizer({
						logger: loggerMock,
						blockExecutor,
						chainModule,
						bftModule,
						mechanisms: [aSyncingMechanism] as any,
					}),
			).toThrow('Mechanism Object should implement "isValidFor" method');
		});

		it('should enforce mandatory interfaces for passed mechanisms (run)', () => {
			const aSyncingMechanism = {
				isValidFor: jest.fn().mockResolvedValue(false),
			};

			expect(
				() =>
					new Synchronizer({
						logger: loggerMock,
						blockExecutor,
						chainModule,
						bftModule,
						mechanisms: [aSyncingMechanism] as any,
					}),
			).toThrow('Mechanism Object should implement "run" method');
		});
	});

	describe('get isActive()', () => {
		it('should return false if the synchronizer is not running', async () => {
			const release = await synchronizer['_mutex'].acquire();
			release();
			expect(synchronizer.isActive).toBeFalsy();
		});

		it('should return true if the synchronizer is running', async () => {
			await synchronizer['_mutex'].acquire();
			expect(synchronizer.isActive).toBeTruthy();
		});
	});

	describe('async run()', () => {
		const aPeerId = '127.0.0.1:5000';
		let aReceivedBlock: Block;

		beforeEach(async () => {
			aReceivedBlock = await createValidDefaultBlock(); // newBlock() creates a block instance, and we want to simulate a block in JSON format that comes from the network
		});

		it('should reject with error if there is already an active mechanism', () => {
			// eslint-disable-next-line @typescript-eslint/no-floating-promises
			synchronizer.run(aReceivedBlock, aPeerId);
			// eslint-disable-next-line @typescript-eslint/no-floating-promises
			synchronizer.run(aReceivedBlock, aPeerId);
			expect(synchronizer['logger'].debug).toHaveBeenCalledTimes(1);
			expect(synchronizer['logger'].debug).toHaveBeenCalledWith('Synchronizer is already running.');
		});

		it('should reject with error if required properties are missing (block)', async () => {
			await expect((synchronizer as any).run()).rejects.toThrow(
				'A block must be provided to the Synchronizer in order to run',
			);
			expect(synchronizer.isActive).toBeFalsy();
		});

		it('should validate the block before sync', async () => {
			jest.spyOn(blockExecutor, 'validate');

			await synchronizer.run(aReceivedBlock, aPeerId);

			expect(blockExecutor.validate).toHaveBeenCalledWith(aReceivedBlock);
		});

		it('should reject with error if block validation failed', async () => {
			(blockExecutor.validate as jest.Mock).mockRejectedValueOnce(
				new Error('Invalid block signature'),
			);
			await expect(
				synchronizer.run(
					{
						...aReceivedBlock,
						header: {
							...aReceivedBlock.header,
							signature: Buffer.from(
								'84d95f9a9c02b1b216bc89610961ca886a454c252e0782f8c4c437f5dff7f720fd63461774fbec4622c85c1c15c3f1d55baf7a4ad41e4e0e50589c5c1e4c7301',
								'hex',
							),
						},
					},
					aPeerId,
				),
			).rejects.toThrow('Invalid block signature');

			expect(synchronizer.isActive).toBeFalsy();
		});

		it('should determine the sync mechanism for received block and run it', async () => {
			syncMechanism1.isValidFor.mockResolvedValue(true);
			syncMechanism2.isValidFor.mockResolvedValue(false);

			await synchronizer.run(aReceivedBlock, aPeerId);

			expect(syncMechanism1.isValidFor).toHaveBeenCalledTimes(1);
			expect(syncMechanism1.run).toHaveBeenCalledWith(aReceivedBlock, aPeerId);
			expect(syncMechanism2.run).not.toHaveBeenCalled();
			expect(loggerMock.info).toHaveBeenNthCalledWith(2, 'Triggering: Object');
			expect(loggerMock.info).toHaveBeenNthCalledWith(
				3,
				{
					lastBlockHeight: chainModule.lastBlock.header.height,
					lastBlockID: chainModule.lastBlock.header.id,
					mechanism: syncMechanism1.constructor.name,
				},
				'Synchronization finished.',
			);
			expect(synchronizer.isActive).toBeFalsy();
		});

		it('should log message if unable to determine syncing mechanism', async () => {
			syncMechanism1.isValidFor.mockResolvedValue(false);
			syncMechanism2.isValidFor.mockResolvedValue(false);
			await synchronizer.run(aReceivedBlock, aPeerId);

			expect(loggerMock.info).toHaveBeenCalledTimes(2);
			expect(loggerMock.info).toHaveBeenNthCalledWith(
				2,
				{ blockId: aReceivedBlock.header.id },
				'Syncing mechanism could not be determined for the given block',
			);
			expect(synchronizer.isActive).toBeFalsy();
			expect(syncMechanism1.run).not.toHaveBeenCalled();
			expect(syncMechanism2.run).not.toHaveBeenCalled();
		});
	});
});
