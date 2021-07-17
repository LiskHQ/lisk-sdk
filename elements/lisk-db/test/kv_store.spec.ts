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
import * as path from 'path';
import * as fs from 'fs';
import { KVStore } from '../src/kv_store';
import { NotFoundError } from '../src/errors';

interface KeyValuePair {
	key: Buffer;
	value: Buffer;
}

describe('KVStore', () => {
	let db: KVStore;
	let defaultKey: Buffer;

	beforeAll(async () => {
		const parentPath = path.join(__dirname, '../tmp');
		if (!fs.existsSync(parentPath)) {
			await fs.promises.mkdir(parentPath);
		}
		db = new KVStore(path.join(parentPath, '/test.db'));
	});

	beforeEach(() => {
		defaultKey = Buffer.from('random', 'utf8');
	});

	afterEach(async () => {
		await db.clear();
	});

	describe('constructor', () => {
		it('should throw error if the parent folder does not exist', () => {
			expect(() => new KVStore('./random-folder/sample.db')).toThrow(
				'random-folder does not exist',
			);
		});
	});

	describe('get', () => {
		it('should reject with NotFoundError if the key does not exist', async () => {
			await expect(db.get(Buffer.from('Random value', 'utf8'))).rejects.toThrow(NotFoundError);
		});

		it('should return JSON object if exists', async () => {
			const defaultValue = Buffer.from(
				JSON.stringify({
					key: 'something',
					balance: 1000000,
				}),
				'binary',
			);
			await db['_db'].put(defaultKey, defaultValue);

			const value = await db.get(defaultKey);
			expect(value).toEqual(defaultValue);
		});
	});

	describe('exists', () => {
		it('should return false if key does not exist', async () => {
			await expect(db.exists(Buffer.from('Random value', 'utf8'))).resolves.toBeFalse();
		});

		it('should return true if key exists', async () => {
			const defaultValue = Buffer.from(
				JSON.stringify({
					key: 'something',
					balance: 1000000,
				}),
				'binary',
			);
			await db['_db'].put(defaultKey, defaultValue);

			await expect(db.exists(defaultKey)).resolves.toBeTrue();
		});
	});

	describe('put', () => {
		it('should put the JSON object to the database', async () => {
			const defaultValue = Buffer.from(
				JSON.stringify({
					key: 'something',
					balance: 1000000,
				}),
				'binary',
			);
			await db.put(defaultKey, defaultValue);

			const value = await db['_db'].get(defaultKey);
			expect(value).toEqual(defaultValue);
		});
	});

	describe('del', () => {
		it('should delete the key if exists', async () => {
			const defaultValue = Buffer.from(
				JSON.stringify({
					key: 'something',
					balance: 1000000,
				}),
				'binary',
			);
			await db['_db'].put(defaultKey, defaultValue);

			await db.del(defaultKey);
			await expect(db.get(defaultKey)).rejects.toThrow(NotFoundError);
		});

		it('should not throw error if key does not exist', async () => {
			await expect(db.del(defaultKey)).not.toReject();
		});
	});

	describe('createReadStream', () => {
		let expectedValues: KeyValuePair[];

		beforeEach(async () => {
			expectedValues = [
				{
					key: Buffer.from('001', 'utf8'),
					value: Buffer.from(JSON.stringify([4, 5, 6]), 'binary'),
				},
				{
					key: Buffer.from('103', 'utf8'),
					value: Buffer.from(JSON.stringify(3), 'binary'),
				},
				{
					key: Buffer.from('010', 'utf8'),
					value: Buffer.from(JSON.stringify([19, 5, 6]), 'binary'),
				},
				{
					key: Buffer.from('321', 'utf8'),
					value: Buffer.from(JSON.stringify('string'), 'binary'),
				},
			];
			const batch = db.batch();
			for (const expected of expectedValues) {
				batch.put(expected.key, expected.value);
			}
			await batch.write();
		});

		it('should return all the entries in lexicographical order', async () => {
			const stream = db.createReadStream();
			const result = await new Promise<KeyValuePair[]>((resolve, reject) => {
				const data: KeyValuePair[] = [];
				stream
					.on('data', ({ key, value }) => {
						data.push({ key, value });
					})
					.on('error', error => {
						reject(error);
					})
					.on('end', () => {
						resolve(data);
					});
			});

			expect(result).toHaveLength(expectedValues.length);
			expect(result[0].key).toEqual(expectedValues[0].key);
			expect(result[1].key).toEqual(expectedValues[2].key);
			expect(result[2].key).toEqual(expectedValues[1].key);
		});

		it('should return all the entries in reverse lexicographical order when reverse is specified', async () => {
			const stream = db.createReadStream({ reverse: true });
			const result = await new Promise<KeyValuePair[]>((resolve, reject) => {
				const data: KeyValuePair[] = [];
				stream
					.on('data', ({ key, value }) => {
						data.push({ key, value });
					})
					.on('error', error => {
						reject(error);
					})
					.on('end', () => {
						resolve(data);
					});
			});

			expect(result).toHaveLength(expectedValues.length);
			expect(result[0].key).toEqual(expectedValues[3].key);
			expect(result[1].key).toEqual(expectedValues[1].key);
			expect(result[2].key).toEqual(expectedValues[2].key);
		});

		it('should return limited number of entries when limit is specified', async () => {
			const stream = db.createReadStream({ limit: 2 });
			const result = await new Promise<KeyValuePair[]>((resolve, reject) => {
				const data: KeyValuePair[] = [];
				stream
					.on('data', ({ key, value }) => {
						data.push({ key, value });
					})
					.on('error', error => {
						reject(error);
					})
					.on('end', () => {
						resolve(data);
					});
			});

			expect(result).toHaveLength(2);
			expect(result[0].key).toEqual(expectedValues[0].key);
			expect(result[1].key).toEqual(expectedValues[2].key);
		});

		it('should return limited number of entries in reverse order when limit and reverse are specified', async () => {
			const stream = db.createReadStream({ limit: 2, reverse: true });
			const result = await new Promise<KeyValuePair[]>((resolve, reject) => {
				const data: KeyValuePair[] = [];
				stream
					.on('data', ({ key, value }) => {
						data.push({ key, value });
					})
					.on('error', error => {
						reject(error);
					})
					.on('end', () => {
						resolve(data);
					});
			});

			expect(result).toHaveLength(2);
			expect(result[0].key).toEqual(expectedValues[3].key);
			expect(result[1].key).toEqual(expectedValues[1].key);
		});

		it('should return ranged value if gte and lte is specified', async () => {
			const stream = db.createReadStream({
				gte: Buffer.from('001', 'utf8'),
				lte: Buffer.from('010', 'utf8'),
			});
			const result = await new Promise<KeyValuePair[]>((resolve, reject) => {
				const data: KeyValuePair[] = [];
				stream
					.on('data', ({ key, value }) => {
						data.push({ key, value });
					})
					.on('error', error => {
						reject(error);
					})
					.on('end', () => {
						resolve(data);
					});
			});

			expect(result).toHaveLength(2);
			expect(result[0].key).toEqual(expectedValues[0].key);
			expect(result[1].key).toEqual(expectedValues[2].key);
		});

		it('should return ranged value if gte and lte is specified in reverse order', async () => {
			const stream = db.createReadStream({
				gte: Buffer.from('001', 'utf8'),
				lte: Buffer.from('010', 'utf8'),
				reverse: true,
			});
			const result = await new Promise<KeyValuePair[]>((resolve, reject) => {
				const data: KeyValuePair[] = [];
				stream
					.on('data', ({ key, value }) => {
						data.push({ key, value });
					})
					.on('error', error => {
						reject(error);
					})
					.on('end', () => {
						resolve(data);
					});
			});

			expect(result).toHaveLength(2);
			expect(result[0].key).toEqual(expectedValues[2].key);
			expect(result[1].key).toEqual(expectedValues[0].key);
		});

		it('should return ranged value if gt and lt is specified', async () => {
			const stream = db.createReadStream({
				gte: Buffer.from('000', 'utf8'),
				lt: Buffer.from('010', 'utf8'),
			});
			const result = await new Promise<KeyValuePair[]>((resolve, reject) => {
				const data: KeyValuePair[] = [];
				stream
					.on('data', ({ key, value }) => {
						data.push({ key, value });
					})
					.on('error', error => {
						reject(error);
					})
					.on('end', () => {
						resolve(data);
					});
			});

			expect(result).toHaveLength(1);
			expect(result[0].key).toEqual(expectedValues[0].key);
		});
	});

	describe('batch', () => {
		it('should put the batched operation', async () => {
			const expectedValues = [
				{
					key: Buffer.from('1', 'utf8'),
					value: Buffer.from(JSON.stringify([4, 5, 6]), 'binary'),
				},
				{
					key: Buffer.from('3', 'utf8'),
					value: Buffer.from(JSON.stringify([4, 5, 6]), 'binary'),
				},
				{
					key: Buffer.from('2', 'utf8'),
					value: Buffer.from(JSON.stringify([4, 5, 6]), 'binary'),
				},
			];
			const batch = db.batch();
			for (const expected of expectedValues) {
				batch.put(expected.key, expected.value);
			}
			await batch.write();

			expect.assertions(expectedValues.length);
			for (const expected of expectedValues) {
				const result = await db['_db'].get(expected.key);
				expect(result).toEqual(expected.value);
			}
		});

		it('should update and delete in the same batch', async () => {
			const deletingKey = Buffer.from('random', 'utf8');
			const deletingValue = Buffer.from(
				JSON.stringify({
					key: 'something',
					balance: 1000000,
				}),
				'binary',
			);
			await db['_db'].put(deletingKey, deletingValue);
			const updatingKey = Buffer.from('1', 'utf8');
			const updatingValue = Buffer.from(
				JSON.stringify({
					key: 'something',
					balance: 1000000,
				}),
				'binary',
			);
			await db['_db'].put(updatingKey, updatingValue);

			const expectedValues = [
				{
					key: Buffer.from('1', 'utf8'),
					value: Buffer.from(JSON.stringify([4, 5, 6]), 'binary'),
				},
				{
					key: Buffer.from('3', 'utf8'),
					value: Buffer.from(JSON.stringify([4, 5, 6]), 'binary'),
				},
				{
					key: Buffer.from('2', 'utf8'),
					value: Buffer.from(JSON.stringify([4, 5, 6]), 'binary'),
				},
			];
			const batch = db.batch();
			for (const expected of expectedValues) {
				batch.put(expected.key, expected.value);
			}
			batch.del(deletingKey);
			await batch.write();

			expect.assertions(expectedValues.length + 1);
			for (const expected of expectedValues) {
				const result = await db['_db'].get(expected.key);
				expect(result).toEqual(expected.value);
			}
			await expect(db.get(deletingKey)).rejects.toThrow(NotFoundError);
		});
	});

	describe('clear', () => {
		it('should remove all data existed', async () => {
			const defaultValue = Buffer.from(
				JSON.stringify({
					key: 'something',
					balance: 1000000,
				}),
				'binary',
			);
			await db['_db'].put(defaultKey, defaultValue);

			await db.clear();

			await expect(db.get(defaultKey)).rejects.toThrow(NotFoundError);
		});

		it('should only remove specified data', async () => {
			const expectedValues = [
				{
					key: Buffer.from('001', 'utf8'),
					value: Buffer.from(JSON.stringify([4, 5, 6]), 'binary'),
				},
				{
					key: Buffer.from('103', 'utf8'),
					value: Buffer.from(JSON.stringify(3), 'binary'),
				},
				{
					key: Buffer.from('010', 'utf8'),
					value: Buffer.from(JSON.stringify([19, 5, 6]), 'binary'),
				},
			];
			const batch = db.batch();
			for (const expected of expectedValues) {
				batch.put(expected.key, expected.value);
			}
			await batch.write();
			await db.clear({ gt: Buffer.from('001', 'utf8'), lt: Buffer.from('103', 'utf8'), limit: 2 });

			await expect(db.get(expectedValues[0].key)).toResolve();
			await expect(db.get(expectedValues[1].key)).toResolve();
			await expect(db.get(expectedValues[2].key)).rejects.toThrow(NotFoundError);
		});
	});
});
