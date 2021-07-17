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
import { KVStore, NotFoundError } from '@liskhq/lisk-db';
import { getRandomBytes } from '@liskhq/lisk-cryptography';
import { Storage } from '../../../src/data_access/storage';
import {
	createFakeDefaultAccount,
	encodeDefaultAccount,
	defaultAccountSchema,
} from '../../utils/account';
import { DataAccess } from '../../../src/data_access';
import { registeredBlockHeaders } from '../../utils/block';
import { concatKeys } from '../../../src/utils';
import { DB_KEY_ACCOUNTS_ADDRESS } from '../../../src/data_access/constants';

describe('dataAccess.transactions', () => {
	let db: KVStore;
	let storage: Storage;
	let dataAccess: DataAccess;
	let accounts: any;

	beforeAll(() => {
		const parentPath = path.join(__dirname, '../../tmp/accounts');
		fs.ensureDirSync(parentPath);
		db = new KVStore(path.join(parentPath, '/test-accounts.db'));
		storage = new Storage(db);
		dataAccess = new DataAccess({
			db,
			accountSchema: defaultAccountSchema as any,
			registeredBlockHeaders,
			minBlockHeaderCache: 3,
			maxBlockHeaderCache: 5,
		});
	});

	beforeEach(async () => {
		accounts = [
			createFakeDefaultAccount({
				address: Buffer.from('cc96c0a5db38b968f563e7af6fb435585c889111', 'hex'),
			}),
			createFakeDefaultAccount({
				address: Buffer.from('584dd8a902822a9469fb2911fcc14ed5fd98220d', 'hex'),
				keys: {
					mandatoryKeys: [
						Buffer.from('456efe283f25ea5bb21476b6dfb77cec4dbd33a4d1b5e60e4dc28e8e8b10fc4e', 'hex'),
					],
					optionalKeys: [],
					numberOfSignatures: 3,
				},
			}),
		];
		const batch = db.batch();
		for (const account of accounts) {
			batch.put(
				concatKeys(DB_KEY_ACCOUNTS_ADDRESS, account.address),
				encodeDefaultAccount(account),
			);
		}
		await batch.write();
	});

	afterEach(async () => {
		await db.clear();
	});

	describe('getAccountByAddress', () => {
		it('should throw not found error if non existent address is specified', async () => {
			expect.assertions(1);
			try {
				await dataAccess.getAccountByAddress(getRandomBytes(20));
			} catch (error) {
				// eslint-disable-next-line jest/no-try-expect
				expect(error).toBeInstanceOf(NotFoundError);
			}
		});

		it('should return account by address', async () => {
			const account = await storage.getAccountByAddress(accounts[1].address);
			expect(account).toEqual(encodeDefaultAccount(accounts[1]));
		});
	});

	describe('getAccountsByAddress', () => {
		it('should not throw "not found" error if non existent address is specified', async () => {
			await expect(
				dataAccess.getAccountsByAddress([getRandomBytes(20), accounts[0].address]),
			).resolves.toEqual([accounts[0]]);
		});

		it('should return existing accounts by address if one invalid address specified', async () => {
			await expect(
				dataAccess.getAccountsByAddress([
					accounts[1].address,
					getRandomBytes(20),
					accounts[0].address,
				]),
			).resolves.toEqual([accounts[1], accounts[0]]);
		});

		it('should return account by address', async () => {
			const result = await dataAccess.getAccountsByAddress([
				accounts[1].address,
				accounts[0].address,
			]);
			expect(result[0]).toEqual(accounts[1]);
			expect(result[1]).toEqual(accounts[0]);
		});
	});
});
