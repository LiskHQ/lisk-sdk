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
import { KVStore, BatchChain, NotFoundError } from '@liskhq/lisk-db';
import { when } from 'jest-when';
import { objects } from '@liskhq/lisk-utils';
import { StateStore } from '../../../src/state_store';
import { DataAccess } from '../../../src/data_access';
import { Account, StateDiff } from '../../../src/types';
import {
	createFakeDefaultAccount,
	encodeDefaultAccount,
	defaultAccountSchema,
	defaultAccount,
} from '../../utils/account';
import { defaultNetworkIdentifier, registeredBlockHeaders } from '../../utils/block';
import { DB_KEY_ACCOUNTS_ADDRESS } from '../../../src/data_access/constants';
import { concatKeys } from '../../../src/utils/buffer_keys';

jest.mock('@liskhq/lisk-db');

describe('state store / account', () => {
	const stateStoreAccounts = [
		createFakeDefaultAccount({
			token: { balance: BigInt(100) },
		}),
		createFakeDefaultAccount({
			token: { balance: BigInt(555) },
		}),
	];

	const accountOnlyInDB = createFakeDefaultAccount({ token: { balance: BigInt(333) } });

	const accountInDB = [
		...stateStoreAccounts.map(acc => ({
			key: acc.address,
			value: encodeDefaultAccount(acc),
		})),
		{
			key: accountOnlyInDB.address,
			value: encodeDefaultAccount(accountOnlyInDB),
		},
	];

	let stateStore: StateStore;
	let db: any;

	beforeEach(async () => {
		db = new KVStore('temp');
		const dataAccess = new DataAccess({
			db,
			accountSchema: defaultAccountSchema,
			registeredBlockHeaders,
			maxBlockHeaderCache: 505,
			minBlockHeaderCache: 309,
		});
		stateStore = new StateStore(dataAccess, {
			lastBlockHeaders: [],
			networkIdentifier: defaultNetworkIdentifier,
			defaultAccount,
			lastBlockReward: BigInt(500000000),
		});
		// Setting this as default behavior throws UnhandledPromiseRejection, so it is specifying the non-existing account
		const dbGetMock = when(db.get)
			.calledWith(concatKeys(DB_KEY_ACCOUNTS_ADDRESS, Buffer.from('123L', 'utf8')))
			.mockRejectedValue(new NotFoundError('Data not found') as never);
		for (const data of accountInDB) {
			dbGetMock
				.calledWith(concatKeys(DB_KEY_ACCOUNTS_ADDRESS, data.key))
				.mockResolvedValue(data.value as never);
		}
		for (const account of stateStoreAccounts) {
			await stateStore.account.set(account.address, account);
			stateStore.account['_initialAccountValue'].set(
				account.address,
				encodeDefaultAccount(account),
			);
		}
	});

	describe('get', () => {
		it('should get the account', async () => {
			// Act
			const account = await stateStore.account.get(accountInDB[0].key);
			// Assert
			expect(account).toStrictEqual(stateStoreAccounts[0]);
			expect(db.get).not.toHaveBeenCalled();
		});

		it('should try to get account from db if not found in memory', async () => {
			// Act
			await stateStore.account.get(accountInDB[2].key);
			// Assert
			expect(db.get).toHaveBeenCalledWith(concatKeys(DB_KEY_ACCOUNTS_ADDRESS, accountInDB[2].key));
		});

		it('should throw an error if not exist', async () => {
			// Act && Assert
			expect.assertions(1);
			try {
				await stateStore.account.get(Buffer.from('123L'));
			} catch (error) {
				// eslint-disable-next-line jest/no-try-expect
				expect(error).toBeInstanceOf(NotFoundError);
			}
		});
	});

	describe('getOrDefault', () => {
		it('should get the account', async () => {
			// Act
			const account = await stateStore.account.getOrDefault(accountInDB[0].key);
			// Assert
			expect(account).toStrictEqual(stateStoreAccounts[0]);
		});

		it('should try to get account from db if not found in memory', async () => {
			// Act
			await stateStore.account.get(accountInDB[2].key);
			// Assert
			expect(db.get).toHaveBeenCalledWith(concatKeys(DB_KEY_ACCOUNTS_ADDRESS, accountInDB[2].key));
		});

		it('should get the default account', async () => {
			// Arrange
			// Act
			const account = await stateStore.account.getOrDefault<{ token: { balance: bigint } }>(
				Buffer.from('123L'),
			);
			// Assert
			expect(account).toEqual(createFakeDefaultAccount({ address: Buffer.from('123L') }));
			expect(account.token?.balance).toBe(BigInt(0));
		});
	});

	describe('set', () => {
		it('should set the updated values for the account', async () => {
			// Act
			const updatedAccount = await stateStore.account.get(accountInDB[0].key);

			updatedAccount.token = { balance: BigInt(123) };
			updatedAccount.sequence = { nonce: BigInt(99) };

			await stateStore.account.set(accountInDB[0].key, updatedAccount);
			const updatedAccountAfterSet = await stateStore.account.get(accountInDB[0].key);
			// Assert
			expect(updatedAccountAfterSet).toStrictEqual(updatedAccount);
		});

		it('should update the updateKeys property', async () => {
			const existingAccount = await stateStore.account.get(accountInDB[0].key);
			const updatedAccount = objects.cloneDeep(existingAccount);
			updatedAccount.token = { balance: BigInt(999) };

			await stateStore.account.set(accountInDB[0].key, updatedAccount);

			expect(stateStore.account['_updatedKeys'].has(accountInDB[0].key)).toBeTrue();
		});
	});

	describe('del', () => {
		it('should throw an error if the address exists neither in memory nor database', async () => {
			await expect(stateStore.account.del(Buffer.from('123L'))).rejects.toBeInstanceOf(
				NotFoundError,
			);
		});

		it('should delete from memory and not register as deleted key if address only exist in memory', async () => {
			// Arrange
			const inmemoryAccount = createFakeDefaultAccount({ token: { balance: BigInt(200000000) } });
			when(db.get)
				.calledWith(concatKeys(DB_KEY_ACCOUNTS_ADDRESS, inmemoryAccount.address))
				.mockRejectedValue(new NotFoundError('Data not found') as never);
			await stateStore.account.set(inmemoryAccount.address, inmemoryAccount);
			// Act
			await stateStore.account.del(inmemoryAccount.address);
			await expect(stateStore.account.get(inmemoryAccount.address)).rejects.toBeInstanceOf(
				NotFoundError,
			);
			expect(stateStore.account['_deletedKeys'].size).toEqual(0);
		});

		it('should delete from memory and register as deleted key if address only exist in DB', async () => {
			await stateStore.account.del(accountOnlyInDB.address);
			await expect(stateStore.account.get(accountOnlyInDB.address)).rejects.toBeInstanceOf(
				NotFoundError,
			);
			expect(stateStore.account['_deletedKeys'].size).toEqual(1);
			expect(stateStore.account['_initialAccountValue'].has(accountOnlyInDB.address)).toBeTrue();
		});

		it('should delete from memory and register as deleted key if address only exist both in memory and in DB', async () => {
			await stateStore.account.del(stateStoreAccounts[0].address);
			await expect(stateStore.account.get(stateStoreAccounts[0].address)).rejects.toBeInstanceOf(
				NotFoundError,
			);
			expect(stateStore.account['_deletedKeys'].size).toEqual(1);
			expect(
				stateStore.account['_initialAccountValue'].has(stateStoreAccounts[0].address),
			).toBeTrue();
		});
	});

	describe('finalize', () => {
		let existingAccount;
		let updatedAccount: Account;
		let batchStub: BatchChain;

		beforeEach(async () => {
			batchStub = { put: jest.fn() } as any;

			existingAccount = await stateStore.account.get(accountInDB[0].key);
			updatedAccount = objects.cloneDeep(existingAccount);
			updatedAccount.token = { balance: BigInt(999) };

			await stateStore.account.set(updatedAccount.address, updatedAccount);
		});

		it('should save the account state in the database', () => {
			stateStore.account.finalize(batchStub);

			expect(batchStub.put).toHaveBeenCalledWith(
				concatKeys(DB_KEY_ACCOUNTS_ADDRESS, updatedAccount.address),
				expect.any(Buffer),
			);
		});
	});

	describe('diff', () => {
		let batchStub: BatchChain;
		let stateDiff: StateDiff;

		beforeEach(() => {
			batchStub = { put: jest.fn(), del: jest.fn() } as any;
		});

		it('should have updated with initial values', async () => {
			const existingAccount = await stateStore.account.get(accountInDB[0].key);
			const originalBytes = encodeDefaultAccount(existingAccount);
			const updatedAccount = objects.cloneDeep(existingAccount);
			updatedAccount.token = { balance: BigInt(999) };

			await stateStore.account.set(updatedAccount.address, updatedAccount);
			stateDiff = stateStore.account.finalize(batchStub);
			expect(stateDiff).toStrictEqual({
				updated: [
					{
						key: concatKeys(DB_KEY_ACCOUNTS_ADDRESS, existingAccount.address),
						value: originalBytes,
					},
				],
				created: [],
				deleted: [],
			});
		});

		it('should return empty array for updated and keys for newly created account', async () => {
			const account1 = createFakeDefaultAccount();
			const account2 = createFakeDefaultAccount();

			await stateStore.account.set(account1.address, account1);
			await stateStore.account.set(account2.address, account2);
			stateDiff = stateStore.account.finalize(batchStub);
			expect(stateDiff).toStrictEqual({
				updated: [],
				created: [
					concatKeys(DB_KEY_ACCOUNTS_ADDRESS, account1.address),
					concatKeys(DB_KEY_ACCOUNTS_ADDRESS, account2.address),
				],
				deleted: [],
			});
		});

		it('should have deleted key value set for deleted accounts', async () => {
			await stateStore.account.del(accountOnlyInDB.address);
			stateDiff = stateStore.account.finalize(batchStub);
			expect(stateDiff).toStrictEqual({
				updated: [],
				created: [],
				deleted: [
					{
						key: concatKeys(DB_KEY_ACCOUNTS_ADDRESS, accountOnlyInDB.address),
						value: encodeDefaultAccount(accountOnlyInDB),
					},
				],
			});
		});
	});
});
