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

import { Chain } from '@liskhq/lisk-chain';
import { codec } from '@liskhq/lisk-codec';
import { objects } from '@liskhq/lisk-utils';
import { LiskValidationError, validator } from '@liskhq/lisk-validator';
import { Logger } from '../../logger';
import { Network } from '../network';
import {
	NETWORK_RPC_GET_BLOCKS_FROM_ID,
	NETWORK_RPC_GET_HIGHEST_COMMON_BLOCK,
	NETWORK_RPC_GET_LAST_BLOCK,
} from './constants';
import {
	getBlocksFromIdRequestSchema,
	getBlocksFromIdResponseSchema,
	getHighestCommonBlockRequestSchema,
	RPCBlocksByIdData,
	RPCHighestCommonBlockData,
} from './schema';

interface EndpointArgs {
	logger: Logger;
	chain: Chain;
	network: Network;
}

interface RateTracker {
	[key: string]: { [key: string]: number };
}

const DEFAULT_LAST_BLOCK_RATE_LIMIT_FREQUENCY = 10;
const DEFAULT_COMMON_BLOCK_RATE_LIMIT_FREQUENCY = 10;
const DEFAULT_BLOCKS_FROM_IDS_RATE_LIMIT_FREQUENCY = 100;

export class Endpoint {
	private readonly _logger: Logger;
	private readonly _chain: Chain;
	private readonly _network: Network;

	private _rateTracker: RateTracker;

	public constructor(args: EndpointArgs) {
		this._logger = args.logger;
		this._chain = args.chain;
		this._network = args.network;
		this._rateTracker = {};
	}

	public handleRPCGetLastBlock(peerId: string): Buffer {
		this._addRateLimit(NETWORK_RPC_GET_LAST_BLOCK, peerId, DEFAULT_LAST_BLOCK_RATE_LIMIT_FREQUENCY);
		return this._chain.dataAccess.encode(this._chain.lastBlock);
	}

	public async handleRPCGetBlocksFromId(data: unknown, peerId: string): Promise<Buffer> {
		this._addRateLimit(
			NETWORK_RPC_GET_BLOCKS_FROM_ID,
			peerId,
			DEFAULT_BLOCKS_FROM_IDS_RATE_LIMIT_FREQUENCY,
		);
		let decodedData: RPCBlocksByIdData;
		try {
			decodedData = codec.decode<RPCBlocksByIdData>(getBlocksFromIdRequestSchema, data as never);
		} catch (error) {
			this._logger.warn(
				{
					err: error as Error,
					req: data,
				},
				'getblocksfromid request validation failed',
			);
			this._network.applyPenaltyOnPeer({
				peerId,
				penalty: 100,
			});
			throw error;
		}
		const errors = validator.validate(getBlocksFromIdRequestSchema, decodedData);

		if (errors.length) {
			const error = new LiskValidationError(errors);
			this._logger.warn(
				{
					err: error,
					req: data,
				},
				'getblocksfromid request validation failed',
			);
			this._network.applyPenaltyOnPeer({
				peerId,
				penalty: 100,
			});
			throw error;
		}

		const { blockId } = decodedData;

		// Get height of block with supplied ID
		const lastBlock = await this._chain.dataAccess.getBlockHeaderByID(blockId);

		const lastBlockHeight = lastBlock.height;

		// Calculate max block height for database query
		// 15kb * 103 is about 1.5MB where it's half of 3MB payload limit
		const fetchUntilHeight = lastBlockHeight + 103;

		const blocks = await this._chain.dataAccess.getBlocksByHeightBetween(
			lastBlockHeight + 1,
			fetchUntilHeight,
		);
		const encodedBlocks = blocks.map(block => this._chain.dataAccess.encode(block));

		return codec.encode(getBlocksFromIdResponseSchema, { blocks: encodedBlocks });
	}

	public async handleRPCGetHighestCommonBlock(
		data: unknown,
		peerId: string,
	): Promise<Buffer | undefined> {
		this._addRateLimit(
			NETWORK_RPC_GET_HIGHEST_COMMON_BLOCK,
			peerId,
			DEFAULT_COMMON_BLOCK_RATE_LIMIT_FREQUENCY,
		);
		const blockIds = codec.decode<RPCHighestCommonBlockData>(
			getHighestCommonBlockRequestSchema,
			data as never,
		);
		const errors = validator.validate(getHighestCommonBlockRequestSchema, blockIds);

		if (errors.length || !objects.bufferArrayUniqueItems(blockIds.ids)) {
			const error = new LiskValidationError(errors);
			// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
			this._logger.warn(
				{
					err: error,
					req: data,
				},
				'getHighestCommonBlock request validation failed',
			);
			this._network.applyPenaltyOnPeer({
				peerId,
				penalty: 100,
			});
			throw error;
		}

		const commonBlockHeader = await this._chain.dataAccess.getHighestCommonBlockHeader(
			blockIds.ids,
		);

		return commonBlockHeader
			? this._chain.dataAccess.encodeBlockHeader(commonBlockHeader)
			: undefined;
	}

	private _addRateLimit(procedure: string, peerId: string, limit: number): void {
		if (this._rateTracker[procedure] === undefined) {
			this._rateTracker[procedure] = { [peerId]: 0 };
		}
		this._rateTracker[procedure][peerId] = this._rateTracker[procedure][peerId]
			? this._rateTracker[procedure][peerId] + 1
			: 1;
		if (this._rateTracker[procedure][peerId] > limit) {
			this._network.applyPenaltyOnPeer({
				peerId,
				penalty: 10,
			});
		}
	}
}
