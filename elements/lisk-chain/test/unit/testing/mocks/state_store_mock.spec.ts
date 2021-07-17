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
import { StateStoreMock } from '../../../../src/testing/mocks/state_store_mock';

describe('StateStoreMock', () => {
	let mock: StateStoreMock;

	describe('account store', () => {
		beforeEach(() => {
			mock = new StateStoreMock({
				accounts: [{ address: Buffer.from('accountA'), token: { balance: BigInt(200) } }],
				defaultAccount: { token: { balance: BigInt(0) } },
			});
		});

		describe('get', () => {
			it('should throw error if not prepared', async () => {
				await expect(mock.account.get(Buffer.from('accountB'))).rejects.toThrow();
			});

			it('should return the prepared account if exists', async () => {
				const result = await mock.account.get(Buffer.from('accountA'));
				expect(result.token.balance).toEqual(BigInt(200));
			});
		});

		describe('getOrDefault', () => {
			it('should return default account if not set', async () => {
				const result = await mock.account.getOrDefault(Buffer.from('accountB'));
				expect(result.address).toEqual(Buffer.from('accountB'));
				expect(result.token.balance).toEqual(BigInt(0));
			});

			it('should return the prepared account if exists', async () => {
				const result = await mock.account.get(Buffer.from('accountA'));
				expect(result.token.balance).toEqual(BigInt(200));
			});
		});

		describe('set', () => {
			it('should add update the existing account', async () => {
				const result = await mock.account.get(Buffer.from('accountA'));
				result.token.balance = BigInt(300);
				await mock.account.set(Buffer.from('accountA'), result);
				const updated = await mock.account.get(Buffer.from('accountA'));
				expect(updated.token.balance).toEqual(BigInt(300));
			});

			it('should not update if the set is not called', async () => {
				const result = await mock.account.get(Buffer.from('accountA'));
				result.token.balance = BigInt(300);
				const updated = await mock.account.get(Buffer.from('accountA'));
				expect(updated.token.balance).toEqual(BigInt(200));
			});
		});

		describe('del', () => {
			it('should delete from cache', async () => {
				await mock.account.del(Buffer.from('accountA'));
				expect(mock.account.getUpdated()).toHaveLength(0);
			});

			it('should throw if data does not exist', async () => {
				await expect(mock.account.get(Buffer.from('account2'))).rejects.toThrow();
			});
		});
	});

	describe('chain store', () => {
		beforeEach(() => {
			mock = new StateStoreMock({
				chain: {
					'chain:dpos': Buffer.from('value'),
				},
				lastBlockHeaders: [{ height: 2 }, { height: 1 }],
				lastBlockReward: BigInt(3),
			});
		});

		describe('properties', () => {
			it('should have set block reward', () => {
				expect(mock.chain.lastBlockReward).toEqual(BigInt(3));
			});

			it('should have set first element of last block header', () => {
				expect(mock.chain.lastBlockHeaders[0].height).toEqual(2);
			});
		});

		describe('get', () => {
			it('should return undefined if not exists', async () => {
				await expect(mock.chain.get(Buffer.from('unknown', 'utf8'))).resolves.toBeUndefined();
			});

			it('should return the prepared account if exists', async () => {
				const result = await mock.chain.get(Buffer.from('chain:dpos', 'utf8'));
				expect(result).toEqual(Buffer.from('value'));
			});
		});

		describe('set', () => {
			it('should update the existing data', async () => {
				let result = await mock.chain.get(Buffer.from('chain:dpos', 'utf8'));
				result = Buffer.from('updated');
				await mock.chain.set(Buffer.from('chain:dpos', 'utf8'), result);
				const updated = await mock.chain.get(Buffer.from('chain:dpos', 'utf8'));
				expect(updated).toEqual(Buffer.from('updated'));
			});

			it('should not update if the set is not called', async () => {
				let result = await mock.chain.get(Buffer.from('chain:dpos', 'utf8'));
				result = Buffer.from('updated');
				const updated = await mock.chain.get(Buffer.from('chain:dpos', 'utf8'));
				expect(updated).toEqual(Buffer.from('value'));
				expect(result).toEqual(Buffer.from('updated'));
			});
		});
	});

	describe('consensus store', () => {
		beforeEach(() => {
			mock = new StateStoreMock({
				consensus: {
					finality: Buffer.from('3'),
				},
				lastBlockHeaders: [{ height: 2 }, { height: 1 }],
			});
		});

		describe('get', () => {
			it('should return undefined if not exists', async () => {
				await expect(mock.consensus.get(Buffer.from('unknown', 'utf8'))).resolves.toBeUndefined();
			});

			it('should return the prepared account if exists', async () => {
				const result = await mock.consensus.get(Buffer.from('finality', 'utf8'));
				expect(result).toEqual(Buffer.from('3'));
			});
		});

		describe('set', () => {
			it('should update the existing data', async () => {
				let result = await mock.consensus.get(Buffer.from('finality', 'utf8'));
				result = Buffer.from('100');
				await mock.consensus.set(Buffer.from('finality', 'utf8'), result);
				const updated = await mock.consensus.get(Buffer.from('finality', 'utf8'));
				expect(updated).toEqual(Buffer.from('100'));
			});

			it('should not update if the set is not called', async () => {
				let result = await mock.consensus.get(Buffer.from('finality', 'utf8'));
				result = Buffer.from('100');
				const updated = await mock.consensus.get(Buffer.from('finality', 'utf8'));
				expect(updated).toEqual(Buffer.from('3'));
				expect(result).toEqual(Buffer.from('100'));
			});
		});
	});
});
