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

import { dataStructures } from '@liskhq/lisk-utils';
import { BatchChain } from '@liskhq/lisk-db';
import { DataAccess } from '../data_access';
import { BlockHeader, StateDiff } from '../types';
import { DB_KEY_CHAIN_STATE } from '../data_access/constants';
import { concatKeys } from '../utils';

interface AdditionalInformation {
	readonly lastBlockHeaders: ReadonlyArray<BlockHeader>;
	readonly networkIdentifier: Buffer;
	readonly lastBlockReward: bigint;
}

export class ChainStateStore {
	private readonly _name = 'ChainState';
	private _data: dataStructures.BufferMap<Buffer>;
	private _originalData: dataStructures.BufferMap<Buffer>;
	private _updatedKeys: dataStructures.BufferSet;
	private _originalUpdatedKeys: dataStructures.BufferSet;
	private readonly _dataAccess: DataAccess;
	private readonly _lastBlockHeaders: ReadonlyArray<BlockHeader>;
	private readonly _networkIdentifier: Buffer;
	private readonly _lastBlockReward: bigint;
	private readonly _initialValue: dataStructures.BufferMap<Buffer>;

	public constructor(dataAccess: DataAccess, additionalInformation: AdditionalInformation) {
		this._dataAccess = dataAccess;
		this._lastBlockHeaders = additionalInformation.lastBlockHeaders;
		this._networkIdentifier = additionalInformation.networkIdentifier;
		this._lastBlockReward = additionalInformation.lastBlockReward;
		this._data = new dataStructures.BufferMap<Buffer>();
		this._originalData = new dataStructures.BufferMap<Buffer>();
		this._initialValue = new dataStructures.BufferMap<Buffer>();
		this._updatedKeys = new dataStructures.BufferSet();
		this._originalUpdatedKeys = new dataStructures.BufferSet();
	}

	public get networkIdentifier(): Buffer {
		return this._networkIdentifier;
	}

	public get lastBlockHeaders(): ReadonlyArray<BlockHeader> {
		return this._lastBlockHeaders;
	}

	public get lastBlockReward(): bigint {
		return this._lastBlockReward;
	}

	public createSnapshot(): void {
		this._originalData = this._data.clone();
		this._originalUpdatedKeys = this._updatedKeys.clone();
	}

	public restoreSnapshot(): void {
		this._data = this._originalData.clone();
		this._updatedKeys = this._originalUpdatedKeys.clone();
	}

	public async get(key: Buffer): Promise<Buffer | undefined> {
		const value = this._data.get(key);

		if (value) {
			return value;
		}

		const dbValue = await this._dataAccess.getChainState(key);
		// If it doesn't exist in the database, return undefined without caching
		if (dbValue === undefined) {
			return dbValue;
		}
		this._initialValue.set(key, dbValue);
		this._data.set(key, dbValue);

		return this._data.get(key);
	}

	public getOrDefault(): void {
		throw new Error(`getOrDefault cannot be called for ${this._name}`);
	}

	public find(): void {
		throw new Error(`getOrDefault cannot be called for ${this._name}`);
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	public async set(key: Buffer, value: Buffer): Promise<void> {
		this._data.set(key, value);
		this._updatedKeys.add(key);
	}

	public finalize(batch: BatchChain): StateDiff {
		const stateDiff = { updated: [], created: [], deleted: [] } as StateDiff;

		if (this._updatedKeys.size === 0) {
			return stateDiff;
		}

		for (const key of Array.from(this._updatedKeys)) {
			const dbKey = concatKeys(DB_KEY_CHAIN_STATE, key);
			const updatedValue = this._data.get(key) as Buffer;
			batch.put(dbKey, updatedValue);

			const initialValue = this._initialValue.get(key);
			if (initialValue !== undefined && !initialValue.equals(updatedValue)) {
				stateDiff.updated.push({
					key: dbKey,
					value: initialValue,
				});
			} else if (initialValue === undefined) {
				stateDiff.created.push(dbKey);
			}
		}

		return stateDiff;
	}
}
