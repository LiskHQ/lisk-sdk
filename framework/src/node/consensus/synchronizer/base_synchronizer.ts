/* eslint-disable class-methods-use-this */
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
import { Block, Chain, BlockHeader } from '@liskhq/lisk-chain';
import { codec } from '@liskhq/lisk-codec';
import { Logger } from '../../../logger';
import { ApplyPenaltyAndRestartError, ApplyPenaltyAndAbortError } from './errors';
import {
	getBlocksFromIdRequestSchema,
	getHighestCommonBlockRequestSchema,
	getBlocksFromIdResponseSchema,
} from '../../transport/schemas';
import { Network } from '../../network';
import {
	NETWORK_RPC_GET_BLOCKS_FROM_ID,
	NETWORK_RPC_GET_HIGHEST_COMMON_BLOCK,
	NETWORK_RPC_GET_LAST_BLOCK,
} from '../constants';

export abstract class BaseSynchronizer {
	protected _logger: Logger;
	protected _chain: Chain;
	protected _network: Network;
	protected _stop = false;

	public constructor(logger: Logger, chain: Chain, network: Network) {
		this._logger = logger;
		this._chain = chain;
		this._network = network;
	}

	public stop(): void {
		this._stop = true;
	}

	protected async _getLastBlockFromNetwork(peerId: string): Promise<Block> {
		const { data } = (await this._network.requestFromPeer({
			procedure: NETWORK_RPC_GET_LAST_BLOCK,
			peerId,
		})) as {
			data: Buffer | undefined;
		};

		if (!data || !data.length) {
			throw new ApplyPenaltyAndRestartError(peerId, 'Peer did not provide its last block');
		}
		return this._chain.dataAccess.decode(data);
	}

	protected async _getHighestCommonBlockFromNetwork(
		peerId: string,
		ids: Buffer[],
	): Promise<BlockHeader> {
		const blockIds = codec.encode(getHighestCommonBlockRequestSchema, { ids });
		const { data } = (await this._network.requestFromPeer({
			procedure: NETWORK_RPC_GET_HIGHEST_COMMON_BLOCK,
			peerId,
			data: blockIds,
		})) as {
			data: Buffer | undefined;
		};

		if (!data || !data.length) {
			throw new ApplyPenaltyAndAbortError(peerId, 'Peer did not return a common block');
		}
		return this._chain.dataAccess.decodeBlockHeader(data);
	}

	protected async _getBlocksFromNetwork(peerId: string, fromID: Buffer): Promise<Block[]> {
		const blockId = codec.encode(getBlocksFromIdRequestSchema, { blockId: fromID });
		const { data } = (await this._network.requestFromPeer({
			procedure: NETWORK_RPC_GET_BLOCKS_FROM_ID,
			data: blockId,
			peerId,
		})) as {
			data: Buffer;
		}; // Note that the block matching lastFetchedID is not returned but only higher blocks.

		if (!data || !data.length) {
			throw new Error('Peer did not respond with block');
		}
		const encodedData = codec.decode<{ blocks: Buffer[] }>(getBlocksFromIdResponseSchema, data);
		return encodedData.blocks.map(block => this._chain.dataAccess.decode(block));
	}

	public abstract run(receivedBlock: Block, peerId: string): Promise<void>;
	public abstract isValidFor(receivedBlock: Block, peerId: string): Promise<boolean>;
}
