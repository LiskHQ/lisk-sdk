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
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { KVStore, formatInt } from '@liskhq/lisk-db';
import { codec } from '@liskhq/lisk-codec';
import { hash } from '@liskhq/lisk-cryptography';
import {
	blockHeaderAssetSchema,
	blockHeaderSchema,
	RawBlockHeader,
	BlockHeader,
} from '@liskhq/lisk-chain';
import { RegisteredSchema, testing, PartialApplicationConfig } from 'lisk-framework';

import { getContradictingBlockHeader, blockHeadersSchema } from '../../src/db';
import { ReportMisbehaviorPlugin } from '../../src';

describe('db', () => {
	const generatorPublicKey = Buffer.from(
		'addb0e15a44b0fdc6ff291be28d8c98f5551d0cd9218d749e30ddb87c6e31ca9',
		'hex',
	);
	const blockHeader1Height = 900000;
	const blockHeader1 = Buffer.from(
		'08021080897a18a0f73622209696342ed355848b4cd6d7c77093121ae3fc10f449447f41044972174e75bc2b2a20e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b8553220addb0e15a44b0fdc6ff291be28d8c98f5551d0cd9218d749e30ddb87c6e31ca93880c8afa025421a08d08e2a10e0dc2a1a10c8c557b5dba8527c0e760124128fd15c4a4056b412aa25c49e5c3cc97257972249fd0ad65f8e431264d9c04b639b46b0839b01ae8d239a354798bae1873c8318a25ef61a8dc9c7a0982da17afb24fbe15c05',
		'hex',
	);
	const blockHeader1Contradicting = Buffer.from(
		'080210c08db7011880ea3022209696342ed355848b4cd6d7c77093121ae3fc10f449447f41044972174e75bc2b2a20e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b8553220addb0e15a44b0fdc6ff291be28d8c98f5551d0cd9218d749e30ddb87c6e31ca93880c8afa025421a08e0dc2a10e0dc2a1a10c8c557b5dba8527c0e760124128fd15c4a40d90764813046127a50acf4b449fccad057944e7665ab065d7057e56983e42abe55a3cbc1eb35a8c126f54597d0a0b426f2ad9a2d62769185ad8e3b4a5b3af909',
		'hex',
	);

	let db: KVStore;
	let registeredSchemas: RegisteredSchema;
	beforeAll(async () => {
		const dbPath = path.join(os.homedir(), '~/.lisk/report-misbehavior-plugin/data/integration/db');
		await fs.ensureDir(dbPath);
		db = new KVStore(dbPath);
		await db.put(
			Buffer.concat([generatorPublicKey, Buffer.from(':', 'utf8'), formatInt(blockHeader1Height)]),
			codec.encode(blockHeadersSchema, { blockHeaders: [blockHeader1] }),
		);
		const rootPath = '~/.lisk/report-misbehavior-plugin';
		const config = {
			rootPath,
			label: 'report-misbehavior-db-tests',
			plugins: {
				reportMisbehavior: {
					encryptedPassphrase: testing.fixtures.defaultFaucetAccount.encryptedPassphrase,
				},
			},
		} as PartialApplicationConfig;

		const appEnv = testing.createDefaultApplicationEnv({
			config,
			plugins: [ReportMisbehaviorPlugin],
		});
		registeredSchemas = appEnv.application.getSchema();
	});

	afterAll(async () => {
		await db.clear();
		await db.close();
	});

	describe('getContradictingBlockHeader', () => {
		it('should resolve undefine when there are no blocks by the same generator', async () => {
			const header = {
				version: 2,
				timestamp: 1603379137,
				height: 169000,
				previousBlockID: Buffer.from(
					'8dd7be542ff0b4b30a1940b10b38b8ae64502be720824d43187f63917f7aadeb',
					'hex',
				),
				transactionRoot: Buffer.from(
					'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
					'hex',
				),
				generatorPublicKey: Buffer.from(
					'a703102d8587a3a48d347e911ae7cfb1f10a549758e57bd89f3eb3b744a8419d',
					'hex',
				),
				reward: BigInt('500000000'),
				asset: {
					maxHeightPreviouslyForged: 168854,
					maxHeightPrevoted: 168932,
					seedReveal: Buffer.from('34c06297108257b6aac21f1a0a1e5646', 'hex'),
				},
				signature: Buffer.from(
					'84b17114713c09cce4b524b858c479b9c722d0efe3e6920ef0bceea7fc42f1904348f31f1a79ff4b6b4dc135cda4a8792053b61e24b407b5ee38a367b5dc1c02',
					'hex',
				),
				id: Buffer.from('e734e77355e887660b5a8382eba26fa0b536b7deb1ddfdda394bdb6614b4cd55', 'hex'),
			};
			const result = await getContradictingBlockHeader(db, header, registeredSchemas);
			expect(result).toBeUndefined();
		});

		it('should resolve undefine when there are no conflicting block header by the same generator', async () => {
			const decodedBlockHeader1 = codec.decode<RawBlockHeader>(blockHeaderSchema, blockHeader1);
			const asset = codec.decode<any>(blockHeaderAssetSchema, decodedBlockHeader1.asset);
			const result = await getContradictingBlockHeader(
				db,
				{ ...decodedBlockHeader1, asset, id: hash(blockHeader1) },
				registeredSchemas,
			);
			expect(result).toBeUndefined();
		});

		it('should resolve a contradicting blockheader when there is a conflicting block in the database', async () => {
			const decodedBlockHeader1 = codec.decode<RawBlockHeader>(
				blockHeaderSchema,
				blockHeader1Contradicting,
			);
			const asset = codec.decode<any>(blockHeaderAssetSchema, decodedBlockHeader1.asset);
			const result = await getContradictingBlockHeader(
				db,
				{ ...decodedBlockHeader1, asset, id: hash(blockHeader1Contradicting) },
				registeredSchemas,
			);
			expect(result).not.toBeUndefined();
			const encodedAsset = codec.encode(blockHeaderAssetSchema, (result as BlockHeader).asset);
			const encodedHeader = codec.encode(blockHeaderSchema, { ...result, asset: encodedAsset });
			expect(encodedHeader.toString('hex')).toEqual(blockHeader1.toString('hex'));
		});
	});
});
