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
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import * as path from 'path';
import * as fs from 'fs-extra';
import { codec } from '@liskhq/lisk-codec';
import { formatInt, KVStore } from '@liskhq/lisk-db';
import {
	createFakeDefaultAccount,
	defaultAccountSchema,
	AccountAsset,
	defaultAccount,
	encodeDefaultAccount,
} from '../../utils/account';
import { DataAccess } from '../../../src/data_access';
import { registeredBlockHeaders } from '../../utils/block';
import { StateStore } from '../../../src/state_store';
import { Account } from '../../../src/types';
import {
	DB_KEY_DIFF_STATE,
	DB_KEY_ACCOUNTS_ADDRESS,
	DB_KEY_CHAIN_STATE,
	DB_KEY_CONSENSUS_STATE,
} from '../../../src/data_access/constants';
import { stateDiffSchema } from '../../../src/schema';
import { concatKeys } from '../../../src/utils';

describe('stateStore.finalize.saveDiff', () => {
	const defaultNetworkIdentifier = Buffer.from(
		'93d00fe5be70d90e7ae247936a2e7d83b50809c79b73fa14285f02c842348b3e',
	);
	let db: KVStore;
	let dataAccess: DataAccess;
	let stateStore: StateStore;
	let accounts: Account<AccountAsset>[];

	beforeAll(() => {
		const parentPath = path.join(__dirname, '../../tmp/diff');
		fs.ensureDirSync(parentPath);
		db = new KVStore(path.join(parentPath, '/test-diff.db'));
		dataAccess = new DataAccess({
			db,
			accountSchema: defaultAccountSchema as any,
			registeredBlockHeaders,
			minBlockHeaderCache: 3,
			maxBlockHeaderCache: 5,
		});
	});

	beforeEach(() => {
		stateStore = new StateStore(dataAccess, {
			lastBlockHeaders: [],
			networkIdentifier: defaultNetworkIdentifier,
			lastBlockReward: BigInt(500000000),
			defaultAccount,
		});

		accounts = [
			createFakeDefaultAccount({
				address: Buffer.from('cc96c0a5db38b968f563e7af6fb435585c889111', 'hex'),
				token: { balance: BigInt(99) },
			}),
			createFakeDefaultAccount({
				address: Buffer.from('584dd8a902822a9469fb2911fcc14ed5fd98220d', 'hex'),
				token: { balance: BigInt('10000') },
				keys: {
					mandatoryKeys: [
						Buffer.from('456efe283f25ea5bb21476b6dfb77cec4dbd33a4d1b5e60e4dc28e8e8b10fc4e', 'hex'),
					],
					optionalKeys: [],
					numberOfSignatures: 3,
				},
			}),
		];
	});

	afterEach(async () => {
		await db.clear();
	});

	describe('finalize', () => {
		it('should save only account state changes diff', async () => {
			// Arrange
			for (const account of accounts) {
				await stateStore.account.set(account.address, account);
			}
			const fakeHeight = 1;
			const batch = db.batch();

			// Act
			stateStore.finalize(fakeHeight, batch);
			await batch.write();
			const diff = await db.get(concatKeys(DB_KEY_DIFF_STATE, formatInt(fakeHeight)));
			const decodedDiff = codec.decode(stateDiffSchema, diff);

			// Assert
			expect(decodedDiff).toStrictEqual({
				updated: [],
				created: [
					concatKeys(DB_KEY_ACCOUNTS_ADDRESS, accounts[0].address),
					concatKeys(DB_KEY_ACCOUNTS_ADDRESS, accounts[1].address),
				],
				deleted: [],
			});
		});

		it('should not save deleted account from memory', async () => {
			// Arrange
			for (const account of accounts) {
				await stateStore.account.set(account.address, account);
			}
			const fakeHeight = 1;
			const batch = db.batch();
			// Act
			await stateStore.account.del(accounts[0].address);
			stateStore.finalize(fakeHeight, batch);
			await batch.write();
			const diff = await db.get(concatKeys(DB_KEY_DIFF_STATE, formatInt(fakeHeight)));
			const decodedDiff = codec.decode(stateDiffSchema, diff);

			// Assert
			expect(decodedDiff).toStrictEqual({
				updated: [],
				created: [concatKeys(DB_KEY_ACCOUNTS_ADDRESS, accounts[1].address)],
				deleted: [],
			});
		});

		it('should save original value as deleted for deleted existed account', async () => {
			// Arrange
			for (const account of accounts) {
				await stateStore.account.set(account.address, account);
			}
			const fakeHeight = 1;
			const batch = db.batch();
			stateStore.finalize(fakeHeight, batch);
			await batch.write();

			// Act
			const nextHeight = 2;
			const newStateStore = new StateStore(dataAccess, {
				lastBlockHeaders: [],
				networkIdentifier: defaultNetworkIdentifier,
				lastBlockReward: BigInt(500000000),
				defaultAccount,
			});
			const originalAccount = await newStateStore.account.get<{ token: { balance: bigint } }>(
				accounts[0].address,
			);
			const originalBuffer = encodeDefaultAccount(originalAccount);
			originalAccount.token.balance = BigInt(777);
			await newStateStore.account.set(accounts[0].address, originalAccount);
			const nextBatch = db.batch();
			await newStateStore.account.del(accounts[0].address);
			newStateStore.finalize(nextHeight, nextBatch);
			await nextBatch.write();

			const diff = await db.get(concatKeys(DB_KEY_DIFF_STATE, formatInt(nextHeight)));
			const decodedDiff = codec.decode(stateDiffSchema, diff);

			// Assert
			expect(decodedDiff).toStrictEqual({
				updated: [],
				created: [],
				deleted: [
					{
						key: concatKeys(DB_KEY_ACCOUNTS_ADDRESS, accounts[0].address),
						value: originalBuffer,
					},
				],
			});
		});

		it('should save only chain state changes diff', async () => {
			// Arrange
			await stateStore.chain.set(Buffer.from('key1', 'utf8'), Buffer.from('value1'));
			await stateStore.chain.set(Buffer.from('key2', 'utf8'), Buffer.from('value2'));
			const fakeHeight = 2;
			const batch = db.batch();

			// Act
			stateStore.finalize(fakeHeight, batch);
			await batch.write();
			const diff = await db.get(concatKeys(DB_KEY_DIFF_STATE, formatInt(fakeHeight)));
			const decodedDiff = codec.decode(stateDiffSchema, diff);

			// Assert
			expect(decodedDiff).toStrictEqual({
				updated: [],
				created: [
					Buffer.from(`${DB_KEY_CHAIN_STATE}:key1`, 'utf8'),
					Buffer.from(`${DB_KEY_CHAIN_STATE}:key2`, 'utf8'),
				],
				deleted: [],
			});
		});

		it('should save only consensus state changes diff', async () => {
			// Arrange
			await stateStore.consensus.set(Buffer.from('key3', 'utf8'), Buffer.from('value3'));
			await stateStore.consensus.set(Buffer.from('key4', 'utf8'), Buffer.from('value4'));
			const fakeHeight = 3;
			const batch = db.batch();

			// Act
			stateStore.finalize(fakeHeight, batch);
			await batch.write();
			const diff = await db.get(concatKeys(DB_KEY_DIFF_STATE, formatInt(fakeHeight)));
			const decodedDiff = codec.decode(stateDiffSchema, diff);

			// Assert
			expect(decodedDiff).toStrictEqual({
				updated: [],
				created: [
					Buffer.from(`${DB_KEY_CONSENSUS_STATE}:key3`, 'utf8'),
					Buffer.from(`${DB_KEY_CONSENSUS_STATE}:key4`, 'utf8'),
				],
				deleted: [],
			});
		});

		it('should save all state changes as diff', async () => {
			// Arrange
			for (const account of accounts) {
				await stateStore.account.set(account.address, account);
			}
			await stateStore.chain.set(Buffer.from('key1', 'utf8'), Buffer.from('value1'));
			await stateStore.chain.set(Buffer.from('key2', 'utf8'), Buffer.from('value2'));
			await stateStore.consensus.set(Buffer.from('key3', 'utf8'), Buffer.from('value3'));
			await stateStore.consensus.set(Buffer.from('key4', 'utf8'), Buffer.from('value4'));
			const fakeHeight = 4;
			const batch = db.batch();

			// Act
			stateStore.finalize(fakeHeight, batch);
			await batch.write();
			const diff = await db.get(concatKeys(DB_KEY_DIFF_STATE, formatInt(fakeHeight)));
			const decodedDiff = codec.decode(stateDiffSchema, diff);

			// Assert
			expect(decodedDiff).toStrictEqual({
				updated: [],
				created: [
					concatKeys(DB_KEY_ACCOUNTS_ADDRESS, accounts[0].address),
					concatKeys(DB_KEY_ACCOUNTS_ADDRESS, accounts[1].address),
					Buffer.from(`${DB_KEY_CHAIN_STATE}:key1`, 'utf8'),
					Buffer.from(`${DB_KEY_CHAIN_STATE}:key2`, 'utf8'),
					Buffer.from(`${DB_KEY_CONSENSUS_STATE}:key3`, 'utf8'),
					Buffer.from(`${DB_KEY_CONSENSUS_STATE}:key4`, 'utf8'),
				],
				deleted: [],
			});
		});

		it('should save updated changes as diff', async () => {
			// Arrange
			// Create
			await stateStore.consensus.set(Buffer.from('key1', 'utf8'), Buffer.from('value1'));
			await stateStore.consensus.set(Buffer.from('key2', 'utf8'), Buffer.from('value2'));
			const fakeHeight = 5;
			const batch = db.batch();
			stateStore.finalize(fakeHeight, batch);
			await batch.write();

			// Update
			stateStore = new StateStore(dataAccess, {
				lastBlockHeaders: [],
				networkIdentifier: defaultNetworkIdentifier,
				lastBlockReward: BigInt(500000000),
				defaultAccount,
			});
			const val1 = await stateStore.consensus.get(Buffer.from('key1', 'utf8'));
			const val2 = await stateStore.consensus.get(Buffer.from('key2', 'utf8'));
			const updatedVal1 = Buffer.concat([val1 as Buffer, val2 as Buffer]);
			const updatedVal2 = Buffer.concat([val2 as Buffer, val1 as Buffer]);

			// Act
			await stateStore.consensus.set(Buffer.from('key1', 'utf8'), updatedVal1);
			await stateStore.consensus.set(Buffer.from('key2', 'utf8'), updatedVal2);
			const updatedFakeHeight = 6;
			const updateBatch = db.batch();
			stateStore.finalize(updatedFakeHeight, updateBatch);
			await updateBatch.write();
			const diff = await db.get(concatKeys(DB_KEY_DIFF_STATE, formatInt(updatedFakeHeight)));
			const decodedDiff = codec.decode(stateDiffSchema, diff);

			// Assert
			expect(decodedDiff).toMatchSnapshot();
		});

		it('should save empty diff if state was not changed', async () => {
			// Arrange
			const fakeHeight = 3;
			const batch = db.batch();

			// Act
			stateStore.finalize(fakeHeight, batch);
			await batch.write();
			const diff = await db.get(concatKeys(DB_KEY_DIFF_STATE, formatInt(fakeHeight)));
			const decodedDiff = codec.decode(stateDiffSchema, diff);

			// Assert
			expect(decodedDiff).toStrictEqual({
				updated: [],
				created: [],
				deleted: [],
			});
		});
	});
});
