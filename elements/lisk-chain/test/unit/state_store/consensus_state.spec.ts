/*
 * Copyright © 2020 Lisk Foundation
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
import { KVStore, BatchChain } from '@liskhq/lisk-db';
import { when } from 'jest-when';
import { StateStore } from '../../../src/state_store';
import { BlockHeader, StateDiff } from '../../../src/types';
import { DataAccess } from '../../../src/data_access';
import { defaultAccount, defaultAccountSchema } from '../../utils/account';
import { defaultNetworkIdentifier, registeredBlockHeaders } from '../../utils/block';

jest.mock('@liskhq/lisk-db');

describe('state store / chain_state', () => {
	let stateStore: StateStore;
	let db: any;

	const lastBlockHeaders = ([
		{ height: 30 },
		{ height: 20 },
	] as unknown) as ReadonlyArray<BlockHeader>;

	beforeEach(() => {
		db = new KVStore('temp');
		const dataAccess = new DataAccess({
			db,
			accountSchema: defaultAccountSchema,
			registeredBlockHeaders,
			maxBlockHeaderCache: 505,
			minBlockHeaderCache: 309,
		});
		stateStore = new StateStore(dataAccess, {
			lastBlockHeaders,
			networkIdentifier: defaultNetworkIdentifier,
			defaultAccount,
			lastBlockReward: BigInt(500000000),
		});
	});

	describe('get', () => {
		it('should get value from cache', async () => {
			// Arrange
			await stateStore.consensus.set(Buffer.from('key1', 'utf8'), Buffer.from('value1'));
			when(db.get)
				.calledWith(Buffer.from('consensus:key1', 'utf8'))
				.mockResolvedValue(Buffer.from('value5') as never);
			// Act & Assert
			expect(await stateStore.consensus.get(Buffer.from('key1', 'utf8'))).toEqual(
				Buffer.from('value1'),
			);
		});

		it('should try to get value from database if not in cache', async () => {
			// Arrange
			when(db.get)
				.calledWith(Buffer.from('consensus:key1', 'utf8'))
				.mockResolvedValue(Buffer.from('value5') as never);
			// Act & Assert
			expect(await stateStore.consensus.get(Buffer.from('key1', 'utf8'))).toEqual(
				Buffer.from('value5'),
			);
		});
	});

	describe('set', () => {
		it('should set value to data and set the updated keys', async () => {
			// Act
			await stateStore.consensus.set(Buffer.from('key3', 'utf8'), Buffer.from('value3'));
			// Assert
			expect(await stateStore.consensus.get(Buffer.from('key3', 'utf8'))).toEqual(
				Buffer.from('value3'),
			);
			expect((stateStore.consensus as any)._updatedKeys.size).toBe(1);
		});

		it('should set value to data and set the updated keys only once', async () => {
			// Act
			await stateStore.consensus.set(Buffer.from('key3', 'utf8'), Buffer.from('value3'));
			await stateStore.consensus.set(Buffer.from('key3', 'utf8'), Buffer.from('value4'));
			// Assert
			expect(await stateStore.consensus.get(Buffer.from('key3', 'utf8'))).toEqual(
				Buffer.from('value4'),
			);
			expect((stateStore.consensus as any)._updatedKeys.size).toBe(1);
		});
	});

	describe('finalize', () => {
		let batchStub: BatchChain;
		let stateDiff: StateDiff;

		beforeEach(() => {
			batchStub = { put: jest.fn() } as any;
		});

		it('should not call storage if nothing is set', () => {
			// Act
			stateStore.consensus.finalize(batchStub);
			// Assert
			expect(batchStub.put).not.toHaveBeenCalled();
		});

		it('should call storage for all the updated keys', async () => {
			// Act
			await stateStore.consensus.set(Buffer.from('finalizedHeight', 'utf8'), Buffer.from('3'));
			await stateStore.consensus.set(Buffer.from('key3', 'utf8'), Buffer.from('value3'));
			await stateStore.consensus.set(Buffer.from('key3', 'utf8'), Buffer.from('value4'));
			await stateStore.consensus.set(Buffer.from('key4', 'utf8'), Buffer.from('value5'));
			stateDiff = stateStore.consensus.finalize(batchStub);
			// Assert
			expect(batchStub.put).toHaveBeenCalledWith(
				Buffer.from('consensus:key3', 'utf8'),
				Buffer.from('value4'),
			);
			expect(batchStub.put).toHaveBeenCalledWith(
				Buffer.from('consensus:key4', 'utf8'),
				Buffer.from('value5'),
			);
			expect(batchStub.put).toHaveBeenCalledWith(
				Buffer.from('consensus:finalizedHeight', 'utf8'),
				Buffer.from('3'),
			);
		});

		it('should return state diff with created and updated values after finalize', async () => {
			// Act
			await stateStore.consensus.set(Buffer.from('finalizedHeight', 'utf8'), Buffer.from('3'));
			await stateStore.consensus.set(Buffer.from('key3', 'utf8'), Buffer.from('value3'));
			await stateStore.consensus.set(Buffer.from('key3', 'utf8'), Buffer.from('value4'));
			await stateStore.consensus.set(Buffer.from('key4', 'utf8'), Buffer.from('value5'));
			stateDiff = stateStore.consensus.finalize(batchStub);

			// Assert
			expect(stateDiff).toStrictEqual({
				updated: [],
				created: [
					Buffer.from('consensus:finalizedHeight', 'utf8'),
					Buffer.from('consensus:key3', 'utf8'),
					Buffer.from('consensus:key4', 'utf8'),
				],
				deleted: [],
			});
		});
	});
});
