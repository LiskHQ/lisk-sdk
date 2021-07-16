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

import { Block, Chain } from '@liskhq/lisk-chain';
import { codec } from '@liskhq/lisk-codec';
import { getRandomBytes } from '@liskhq/lisk-cryptography';
import { Endpoint } from '../../../../src/node/consensus/endpoints';
import {
	getBlocksFromIdRequestSchema,
	getHighestCommonBlockRequestSchema,
} from '../../../../src/node/consensus/schema';
import { Network } from '../../../../src/node/network';
import { loggerMock } from '../../../../src/testing/mocks';
import {
	createValidDefaultBlock,
	encodeValidBlock,
	encodeValidBlockHeader,
} from '../../../fixtures';

describe('p2p endpoint', () => {
	const defaultPeerId = 'peer-id';
	const defaultRateLimit = 10000;

	let endpoint: Endpoint;
	let chain: Chain;
	let network: Network;
	let lastBlock: Block;

	beforeEach(async () => {
		lastBlock = await createValidDefaultBlock({ header: { height: 2 } });
		const nextBlock = await createValidDefaultBlock({ header: { height: 3 } });
		chain = ({
			dataAccess: {
				decode: jest.fn(),
				encode: jest.fn().mockReturnValue(encodeValidBlock(lastBlock)),
				getBlockHeaderByID: jest.fn().mockResolvedValue({ height: 2 }),
				getBlocksByHeightBetween: jest.fn().mockResolvedValue([lastBlock, nextBlock]),
				getHighestCommonBlockHeader: jest.fn(),
				encodeBlockHeader: jest.fn().mockReturnValue(encodeValidBlockHeader(lastBlock.header)),
			},
			lastBlock,
		} as unknown) as Chain;
		network = ({
			applyPenaltyOnPeer: jest.fn(),
		} as unknown) as Network;
		endpoint = new Endpoint({
			chain,
			logger: loggerMock,
			network,
		});
		jest.useFakeTimers();
	});

	describe('handleRPCGetLastBlock', () => {
		const DEFAULT_LAST_BLOCK_RATE_LIMIT_FREQUENCY = 10;

		it('should apply penalty if call exceeds rate limit', () => {
			// Arrange
			[...new Array(DEFAULT_LAST_BLOCK_RATE_LIMIT_FREQUENCY + 1)].map(() =>
				endpoint.handleRPCGetLastBlock(defaultPeerId),
			);
			jest.advanceTimersByTime(defaultRateLimit);

			// Assert
			expect(network.applyPenaltyOnPeer).toHaveBeenCalledWith({
				peerId: defaultPeerId,
				penalty: 10,
			});
		});

		it('should return last block as bytes', () => {
			const res = endpoint.handleRPCGetLastBlock(defaultPeerId);
			expect(res).toEqual(encodeValidBlock(lastBlock));
		});
	});

	describe('handleRPCGetBlocksFromId', () => {
		const DEFAULT_BLOCKS_FROM_IDS_RATE_LIMIT_FREQUENCY = 100;

		it('should apply penalty if call exceeds rate limit', () => {
			// Arrange
			const blockIds = codec.encode(getBlocksFromIdRequestSchema, {
				blockId: getRandomBytes(32),
			});
			[...new Array(DEFAULT_BLOCKS_FROM_IDS_RATE_LIMIT_FREQUENCY + 1)].map(async () =>
				endpoint.handleRPCGetBlocksFromId(blockIds, defaultPeerId),
			);
			jest.advanceTimersByTime(defaultRateLimit);

			// Assert
			expect(network.applyPenaltyOnPeer).toHaveBeenCalledWith({
				peerId: defaultPeerId,
				penalty: 10,
			});
		});

		it('should apply penalty on the peer if request data is invalid', async () => {
			const invalidBytes = Buffer.from([244, 21, 21]);
			await expect(
				endpoint.handleRPCGetBlocksFromId(invalidBytes, defaultPeerId),
			).rejects.toThrow();
			expect(network.applyPenaltyOnPeer).toHaveBeenCalledWith({
				peerId: defaultPeerId,
				penalty: 100,
			});
		});

		it('should apply penalty on the peer if request format is invalid', async () => {
			const blockIds = codec.encode(getBlocksFromIdRequestSchema, {
				blockId: getRandomBytes(1),
			});
			await expect(endpoint.handleRPCGetBlocksFromId(blockIds, defaultPeerId)).rejects.toThrow();
			expect(network.applyPenaltyOnPeer).toHaveBeenCalledWith({
				peerId: defaultPeerId,
				penalty: 100,
			});
		});

		it('should return blocks from next height', async () => {
			const id = getRandomBytes(32);
			const blockIds = codec.encode(getBlocksFromIdRequestSchema, {
				blockId: id,
			});
			await endpoint.handleRPCGetBlocksFromId(blockIds, defaultPeerId);
			expect(chain.dataAccess.getBlockHeaderByID).toHaveBeenCalledWith(id);
			expect(chain.dataAccess.getBlocksByHeightBetween).toHaveBeenCalledWith(3, 105);
		});
	});

	describe('handleRPCGetHighestCommonBlock', () => {
		const DEFAULT_COMMON_BLOCK_RATE_LIMIT_FREQUENCY = 10;

		it('should apply penalty if call exceeds rate limit', () => {
			const blockIds = codec.encode(getHighestCommonBlockRequestSchema, {
				ids: [getRandomBytes(32)],
			});
			[...new Array(DEFAULT_COMMON_BLOCK_RATE_LIMIT_FREQUENCY + 1)].map(async () =>
				endpoint.handleRPCGetHighestCommonBlock(blockIds, defaultPeerId),
			);
			jest.advanceTimersByTime(defaultRateLimit);

			// Assert
			expect(network.applyPenaltyOnPeer).toHaveBeenCalledWith({
				peerId: defaultPeerId,
				penalty: 10,
			});
		});

		describe('when commonBlock has not been found', () => {
			beforeEach(() => {
				(chain.dataAccess.getHighestCommonBlockHeader as jest.Mock).mockResolvedValue(undefined);
			});

			it('should return null', async () => {
				// Arrange
				const ids = [getRandomBytes(32)];
				const blockIds = codec.encode(getHighestCommonBlockRequestSchema, { ids });

				// Act
				const result = await endpoint.handleRPCGetHighestCommonBlock(blockIds, defaultPeerId);

				// Assert
				expect(chain.dataAccess.getHighestCommonBlockHeader).toHaveBeenCalledWith(ids);
				expect(result).toBeUndefined();
			});
		});

		describe('when commonBlock has been found', () => {
			const id = getRandomBytes(32);
			const validBlock = {
				ids: [id.toString('hex')],
			};

			beforeEach(() => {
				(chain.dataAccess.getHighestCommonBlockHeader as jest.Mock).mockResolvedValue(validBlock);
			});

			it('should return the result', async () => {
				// Arrange
				const ids = [id];
				const blockIds = codec.encode(getHighestCommonBlockRequestSchema, { ids });

				// Act
				const result = await endpoint.handleRPCGetHighestCommonBlock(blockIds, defaultPeerId);

				// Assert
				expect(chain.dataAccess.getHighestCommonBlockHeader).toHaveBeenCalledWith(ids);
				expect(result).toEqual(encodeValidBlockHeader(lastBlock.header));
			});
		});
	});
});
