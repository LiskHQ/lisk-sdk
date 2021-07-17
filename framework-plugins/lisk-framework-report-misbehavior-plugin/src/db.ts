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

import { formatInt, KVStore, getFirstPrefix, getLastPrefix } from '@liskhq/lisk-db';
import { codec } from '@liskhq/lisk-codec';
import { RawBlockHeader, BlockHeader } from '@liskhq/lisk-chain';
import { areHeadersContradicting } from '@liskhq/lisk-bft';
import * as os from 'os';
import { join } from 'path';
import { ensureDir } from 'fs-extra';
import { RegisteredSchema } from 'lisk-framework';
import { hash } from '@liskhq/lisk-cryptography';

export const blockHeadersSchema = {
	$id: 'lisk/reportMisbehavior/blockHeaders',
	type: 'object',
	required: ['blockHeaders'],
	properties: {
		blockHeaders: {
			type: 'array',
			fieldNumber: 1,
			items: {
				dataType: 'bytes',
			},
		},
	},
};

export interface BlockHeaderAsset {
	readonly seedReveal: Buffer;
	readonly maxHeightPreviouslyForged: number;
	readonly maxHeightPrevoted: number;
}

interface BlockHeaders {
	readonly blockHeaders: Buffer[];
}

export const getDBInstance = async (
	dataPath: string,
	dbName = 'lisk-framework-report-misbehavior-plugin.db',
): Promise<KVStore> => {
	const dirPath = join(dataPath.replace('~', os.homedir()), 'plugins/data', dbName);
	await ensureDir(dirPath);

	return new KVStore(dirPath);
};

export const getBlockHeaders = async (
	db: KVStore,
	dbKeyBlockHeader: Buffer,
): Promise<BlockHeaders> => {
	try {
		const encodedBlockHeaders = await db.get(dbKeyBlockHeader);
		return codec.decode<BlockHeaders>(blockHeadersSchema, encodedBlockHeaders);
	} catch (error) {
		return { blockHeaders: [] as Buffer[] };
	}
};

export const decodeBlockHeader = (encodedHeader: Buffer, schema: RegisteredSchema): BlockHeader => {
	const id = hash(encodedHeader);
	const blockHeader = codec.decode<RawBlockHeader>(schema.blockHeader, encodedHeader);
	const assetSchema = schema.blockHeadersAssets[blockHeader.version];
	const asset = codec.decode<BlockHeaderAsset>(assetSchema, blockHeader.asset);
	return {
		...blockHeader,
		asset,
		id,
	};
};

export const saveBlockHeaders = async (
	db: KVStore,
	schemas: RegisteredSchema,
	header: Buffer,
): Promise<boolean> => {
	const blockId = hash(header);
	const { generatorPublicKey, height } = codec.decode<RawBlockHeader>(schemas.blockHeader, header);
	const dbKey = Buffer.concat([generatorPublicKey, Buffer.from(':', 'utf8'), formatInt(height)]);
	const { blockHeaders } = await getBlockHeaders(db, dbKey);

	if (!blockHeaders.find(blockHeader => hash(blockHeader).equals(blockId))) {
		await db.put(
			dbKey,
			codec.encode(blockHeadersSchema, {
				blockHeaders: [...blockHeaders, header],
			}),
		);
		return true;
	}
	return false;
};

type IteratableStream = NodeJS.ReadableStream & { destroy: (err?: Error) => void };

export const getContradictingBlockHeader = async (
	db: KVStore,
	blockHeader: BlockHeader,
	schemas: RegisteredSchema,
): Promise<BlockHeader | undefined> =>
	new Promise((resolve, reject) => {
		const stream = db.createReadStream({
			gte: getFirstPrefix(blockHeader.generatorPublicKey),
			lte: getLastPrefix(blockHeader.generatorPublicKey),
		}) as IteratableStream;
		stream
			.on('data', ({ value }: { value: Buffer }) => {
				const { blockHeaders } = codec.decode<BlockHeaders>(blockHeadersSchema, value);
				for (const encodedHeader of blockHeaders) {
					const decodedBlockHeader = decodeBlockHeader(encodedHeader, schemas);
					if (areHeadersContradicting(blockHeader, decodedBlockHeader)) {
						stream.destroy();
						resolve(decodedBlockHeader);
					}
				}
			})
			.on('error', error => {
				reject(error);
			})
			.on('end', () => {
				resolve(undefined);
			});
	});

export const clearBlockHeaders = async (
	db: KVStore,
	schemas: RegisteredSchema,
	currentHeight: number,
): Promise<void> => {
	const keys = await new Promise<Buffer[]>((resolve, reject) => {
		const stream = db.createReadStream() as IteratableStream;
		const res: Buffer[] = [];
		stream
			.on('data', ({ key, value }: { key: Buffer; value: Buffer }) => {
				const { blockHeaders } = codec.decode<BlockHeaders>(blockHeadersSchema, value);
				for (const encodedHeader of blockHeaders) {
					const decodedBlockHeader = decodeBlockHeader(encodedHeader, schemas);
					if (decodedBlockHeader.height < currentHeight - 260000) {
						res.push(key);
					}
				}
			})
			.on('error', error => {
				reject(error);
			})
			.on('end', () => {
				resolve(res);
			});
	});
	const batch = db.batch();
	for (const k of keys) {
		batch.del(k);
	}
	await batch.write();
};
