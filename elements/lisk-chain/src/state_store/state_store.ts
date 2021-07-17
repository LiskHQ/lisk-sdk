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

import { codec } from '@liskhq/lisk-codec';
import { BatchChain, formatInt } from '@liskhq/lisk-db';
import { BlockHeader, StateDiff, UpdatedDiff } from '../types';
import { AccountStore } from './account_store';
import { ChainStateStore } from './chain_state_store';
import { ConsensusStateStore } from './consensus_state_store';
import { DataAccess } from '../data_access';
import { DB_KEY_DIFF_STATE } from '../data_access/constants';
import { stateDiffSchema } from '../schema';
import { concatKeys } from '../utils';

interface AdditionalInformation {
	readonly lastBlockHeaders: ReadonlyArray<BlockHeader>;
	readonly networkIdentifier: Buffer;
	readonly lastBlockReward: bigint;
	readonly defaultAccount: Record<string, unknown>;
}

const saveDiff = (
	height: number | bigint,
	stateDiffs: Array<Readonly<StateDiff>>,
	batch: BatchChain,
): void => {
	const diffToEncode: { updated: UpdatedDiff[]; created: Buffer[]; deleted: UpdatedDiff[] } = {
		updated: [],
		created: [],
		deleted: [],
	};

	for (const diff of stateDiffs) {
		diffToEncode.updated = diffToEncode.updated.concat(diff.updated);
		diffToEncode.created = diffToEncode.created.concat(diff.created);
		diffToEncode.deleted = diffToEncode.deleted.concat(diff.deleted);
	}

	const encodedDiff = codec.encode(stateDiffSchema, diffToEncode);
	batch.put(concatKeys(DB_KEY_DIFF_STATE, formatInt(height)), encodedDiff);
};

export class StateStore {
	public readonly account: AccountStore;
	public readonly chain: ChainStateStore;
	public readonly consensus: ConsensusStateStore;

	public constructor(dataAccess: DataAccess, additionalInformation: AdditionalInformation) {
		this.account = new AccountStore(dataAccess, {
			defaultAccount: additionalInformation.defaultAccount,
		});
		this.consensus = new ConsensusStateStore(dataAccess);
		this.chain = new ChainStateStore(dataAccess, {
			lastBlockHeaders: additionalInformation.lastBlockHeaders,
			networkIdentifier: additionalInformation.networkIdentifier,
			lastBlockReward: additionalInformation.lastBlockReward,
		});
	}

	public createSnapshot(): void {
		this.account.createSnapshot();
		this.consensus.createSnapshot();
		this.chain.createSnapshot();
	}

	public restoreSnapshot(): void {
		this.account.restoreSnapshot();
		this.consensus.restoreSnapshot();
		this.chain.restoreSnapshot();
	}

	public finalize(height: number | bigint, batch: BatchChain): void {
		const accountStateDiff = this.account.finalize(batch);
		const chainStateDiff = this.chain.finalize(batch);
		const consensusStateDiff = this.consensus.finalize(batch);
		saveDiff(height, [accountStateDiff, chainStateDiff, consensusStateDiff], batch);
	}
}
