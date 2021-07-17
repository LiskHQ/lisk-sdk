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
import { Readable } from 'stream';
import { when } from 'jest-when';
import { KVStore, formatInt, NotFoundError, getFirstPrefix, getLastPrefix } from '@liskhq/lisk-db';
import { DataAccess } from '../../../src/data_access';
import {
	createFakeBlockHeader,
	createValidDefaultBlock,
	encodeDefaultBlockHeader,
	encodedDefaultBlock,
} from '../../utils/block';
import { Block } from '../../../src/types';
import { Transaction } from '../../../src/transaction';
import {
	createFakeDefaultAccount,
	encodeDefaultAccount,
	defaultAccountSchema,
} from '../../utils/account';
import { getGenesisBlockHeaderAssetSchema, blockHeaderAssetSchema } from '../../../src/schema';
import { concatKeys } from '../../../src/utils';
import {
	DB_KEY_BLOCKS_HEIGHT,
	DB_KEY_BLOCKS_ID,
	DB_KEY_TRANSACTIONS_ID,
	DB_KEY_ACCOUNTS_ADDRESS,
	DB_KEY_TEMPBLOCKS_HEIGHT,
} from '../../../src/data_access/constants';

jest.mock('@liskhq/lisk-db');

describe('data_access', () => {
	let dataAccess: DataAccess;
	let db: any;
	let block: Block;

	beforeEach(async () => {
		db = new KVStore('temp');
		(db.createReadStream as jest.Mock).mockReturnValue(Readable.from([]));
		(formatInt as jest.Mock).mockImplementation(n => {
			const buf = Buffer.alloc(4);
			buf.writeUInt32BE(n, 0);
			return buf;
		});
		(getFirstPrefix as jest.Mock).mockImplementation(str => str);
		(getLastPrefix as jest.Mock).mockImplementation(str => str);
		dataAccess = new DataAccess({
			db,
			accountSchema: defaultAccountSchema,
			registeredBlockHeaders: {
				0: getGenesisBlockHeaderAssetSchema(defaultAccountSchema),
				2: blockHeaderAssetSchema,
			},
			minBlockHeaderCache: 3,
			maxBlockHeaderCache: 5,
		});
		block = await createValidDefaultBlock({ header: { height: 1 } });
		dataAccess.decodeBlockHeader = jest.fn().mockResolvedValue(block.header);
	});

	afterEach(() => {
		// Clear block cache
		// eslint-disable-next-line no-unused-expressions
		(dataAccess as any)._blocksCache?.items?.shift();
		jest.clearAllMocks();
	});

	describe('#addBlockHeader', () => {
		it('should call blocksCache.add', () => {
			// Arrange
			(dataAccess as any)._blocksCache = { add: jest.fn() };
			// Act
			dataAccess.addBlockHeader(block.header);

			// Assert
			expect((dataAccess as any)._blocksCache.add).toHaveBeenCalled();
		});
	});

	describe('#getBlockHeadersByIDs', () => {
		it('should not call db if cache exists', async () => {
			// Arrange
			dataAccess.addBlockHeader(block.header);

			// Act
			await dataAccess.getBlockHeadersByIDs([block.header.id]);

			// Assert
			expect(db.get).not.toHaveBeenCalled();
		});

		it('should return persisted blocks if cache does not exist', async () => {
			// Arrange
			(db.get as jest.Mock).mockResolvedValue(encodeDefaultBlockHeader(block.header));
			// Act
			await dataAccess.getBlockHeadersByIDs([block.header.id]);

			// Assert
			expect(db.get).toHaveBeenCalled();
		});
	});

	describe('#getBlockHeaderByHeight', () => {
		it('should not call db if cache exists', async () => {
			// Arrange
			dataAccess.addBlockHeader(block.header);

			// Act
			await dataAccess.getBlockHeaderByHeight(1);

			// Assert
			expect(db.get).not.toHaveBeenCalled();
		});

		it('should return persisted block header if cache does not exist', async () => {
			// Arrange
			(db.createReadStream as jest.Mock).mockReturnValue(
				Readable.from([
					{
						value: block.header.id,
					},
				]),
			);
			when(db.get)
				.calledWith(concatKeys(DB_KEY_BLOCKS_HEIGHT, formatInt(block.header.height)))
				.mockResolvedValue(block.header.id as never)
				.calledWith(concatKeys(DB_KEY_BLOCKS_ID, block.header.id))
				.mockResolvedValue(encodeDefaultBlockHeader(block.header) as never);
			// Act
			await dataAccess.getBlockHeaderByHeight(1);

			// Assert
			expect(db.get).toHaveBeenCalledTimes(2);
			expect(db.get).toHaveBeenCalledWith(
				concatKeys(DB_KEY_BLOCKS_HEIGHT, formatInt(block.header.height)),
			);
			expect(db.get).toHaveBeenCalledWith(concatKeys(DB_KEY_BLOCKS_ID, block.header.id));
		});
	});

	describe('#getBlockHeadersByHeightBetween', () => {
		it('should not call db if cache exists', async () => {
			// Arrange
			dataAccess.addBlockHeader({ ...block.header, height: 0 });
			dataAccess.addBlockHeader(block.header);

			// Act
			await dataAccess.getBlockHeadersByHeightBetween(0, 1);

			// Assert
			expect(db.get).not.toHaveBeenCalled();
		});

		it('should return persisted blocks if cache does not exist', async () => {
			// Arrange
			(dataAccess as any)._blocksCache.items.shift();
			(db.createReadStream as jest.Mock).mockReturnValue(
				Readable.from([
					{
						value: block.header.id,
					},
				]),
			);
			(db.get as jest.Mock).mockResolvedValue(encodeDefaultBlockHeader(block.header));

			// Act
			await dataAccess.getBlockHeadersByHeightBetween(0, 1);

			// Assert
			expect(db.createReadStream).toHaveBeenCalledTimes(1);
			expect(db.get).toHaveBeenCalledTimes(1);
		});
	});

	describe('#getBlockHeadersWithHeights', () => {
		it('should not call db if cache exists', async () => {
			// Arrange
			dataAccess.addBlockHeader(block.header);

			// Act
			await dataAccess.getBlockHeadersWithHeights([1]);

			// Assert
			expect(db.get).not.toHaveBeenCalled();
		});

		it('should return persisted blocks if cache does not exist', async () => {
			// Arrange
			when(db.get)
				.calledWith(concatKeys(DB_KEY_BLOCKS_HEIGHT, formatInt(block.header.height)))
				.mockResolvedValue(block.header.id as never)
				.calledWith(concatKeys(DB_KEY_BLOCKS_ID, block.header.id))
				.mockResolvedValue(encodeDefaultBlockHeader(block.header) as never);
			// Act
			await dataAccess.getBlockHeadersWithHeights([1]);

			// Assert
			expect(db.get).toHaveBeenCalledTimes(2);
			expect(db.get).toHaveBeenCalledWith(
				concatKeys(DB_KEY_BLOCKS_HEIGHT, formatInt(block.header.height)),
			);
			expect(db.get).toHaveBeenCalledWith(concatKeys(DB_KEY_BLOCKS_ID, block.header.id));
		});
	});

	describe('#getLastBlockHeader', () => {
		it('should not call db if cache exists', async () => {
			// Arrange
			dataAccess.addBlockHeader(block.header);

			// Act
			await dataAccess.getLastBlockHeader();

			// Assert
			expect(db.get).not.toHaveBeenCalled();
		});

		it('should return persisted blocks if cache does not exist', async () => {
			// Arrange
			(db.get as jest.Mock).mockResolvedValue(encodeDefaultBlockHeader(block.header));
			(db.createReadStream as jest.Mock).mockReturnValue(
				Readable.from([
					{
						value: block.header.id,
					},
				]),
			);
			// Act
			await dataAccess.getLastBlockHeader();

			// Assert
			expect(db.get).toHaveBeenCalledTimes(1);
			expect(db.createReadStream).toHaveBeenCalledTimes(1);
			expect(db.get).toHaveBeenCalledWith(concatKeys(DB_KEY_BLOCKS_ID, block.header.id));
		});
	});

	describe('#getHighestCommonBlockHeader', () => {
		it('should not call db if cache exists', async () => {
			// Arrange
			dataAccess.addBlockHeader(block.header);

			// Act
			await dataAccess.getHighestCommonBlockHeader([block.header.id]);

			// Assert
			expect(db.get).not.toHaveBeenCalled();
		});

		it('should return the highest height block from the cache if cache exist', async () => {
			// Arrange
			dataAccess.addBlockHeader(block.header);
			const additionalBlocks = [
				(await createValidDefaultBlock({ header: { height: 2 } })).header,
				(await createValidDefaultBlock({ header: { height: 3 } })).header,
				(await createValidDefaultBlock({ header: { height: 4 } })).header,
				(await createValidDefaultBlock({ header: { height: 5 } })).header,
				(await createValidDefaultBlock({ header: { height: 6 } })).header,
			];
			for (const header of additionalBlocks) {
				dataAccess.addBlockHeader(header);
			}

			// Act
			const commonBlockHeader = await dataAccess.getHighestCommonBlockHeader(
				additionalBlocks.slice(1, 4).map(h => h.id),
			);

			expect(commonBlockHeader?.height).toEqual(5);
		});

		it('should return persisted blocks if cache does not exist', async () => {
			// Arrange
			(db.get as jest.Mock).mockResolvedValue(encodeDefaultBlockHeader(block.header));
			// Act
			await dataAccess.getHighestCommonBlockHeader([block.header.id, Buffer.from('random-id')]);

			// Assert
			expect(db.get).toHaveBeenCalledTimes(2);
		});

		it('should get the block with highest height from provided ids parameter', async () => {
			// Arrange
			const ids = [Buffer.from('1'), Buffer.from('2')];
			jest.spyOn(dataAccess, 'getBlockHeaderByID').mockImplementation(async (id: Buffer) => {
				if (id.equals(ids[0])) {
					return Promise.resolve(block) as Promise<any>;
				}
				throw new NotFoundError('data not found');
			});

			// Act
			const result = await dataAccess.getHighestCommonBlockHeader(ids);

			// Assert
			expect(dataAccess.getBlockHeaderByID).toHaveBeenCalledWith(ids[0]);
			expect(dataAccess.getBlockHeaderByID).toHaveBeenCalledWith(ids[1]);
			expect(result).toEqual(block);
		});

		it('should not throw error if unable to get blocks from the storage', async () => {
			// Arrange
			const ids = [Buffer.from('1'), Buffer.from('2')];
			jest
				.spyOn(dataAccess, 'getBlockHeaderByID')
				.mockRejectedValue(new NotFoundError('data not found'));
			// Act && Assert
			const result = await dataAccess.getHighestCommonBlockHeader(ids);
			expect(dataAccess.getBlockHeaderByID).toHaveBeenCalledWith(ids[0]);
			expect(dataAccess.getBlockHeaderByID).toHaveBeenCalledWith(ids[1]);
			expect(result).toBeUndefined();
		});
	});

	describe('#getBlocksByIDs', () => {
		it('should return persisted blocks by ids', async () => {
			// Arrange
			when(db.get)
				.mockRejectedValue(new NotFoundError('Data not found') as never)
				.calledWith(concatKeys(DB_KEY_BLOCKS_ID, formatInt(1)))
				.mockResolvedValue(encodeDefaultBlockHeader(block.header) as never);
			// Act
			await dataAccess.getBlocksByIDs([formatInt(1)]);

			// Assert
			expect(db.get).toHaveBeenCalledWith(concatKeys(DB_KEY_BLOCKS_ID, formatInt(1)));
		});
	});

	describe('#getBlocksByHeightBetween', () => {
		it('should return persisted blocks within the height range', async () => {
			// Arrange
			(db.createReadStream as jest.Mock).mockReturnValue(
				Readable.from([
					{
						value: block.header.id,
					},
				]),
			);
			when(db.get)
				.mockRejectedValue(new NotFoundError('Data not found') as never)
				.calledWith(concatKeys(DB_KEY_BLOCKS_ID, block.header.id))
				.mockResolvedValue(encodeDefaultBlockHeader(block.header) as never);
			// Act
			await dataAccess.getBlocksByHeightBetween(1, 2);

			// Assert
			expect(db.createReadStream).toHaveBeenCalledTimes(1);
			expect(db.get).toHaveBeenCalledTimes(2);
		});
	});

	describe('#getLastBlock', () => {
		it('should get the highest height block', async () => {
			// Arrange
			(db.createReadStream as jest.Mock).mockReturnValue(
				Readable.from([
					{
						value: block.header.id,
					},
				]),
			);
			when(db.get)
				.mockRejectedValue(new NotFoundError('Data not found') as never)
				.calledWith(concatKeys(DB_KEY_BLOCKS_ID, block.header.id))
				.mockResolvedValue(encodeDefaultBlockHeader(block.header) as never);
			// Act
			await dataAccess.getLastBlock();

			// Assert
			expect(db.createReadStream).toHaveBeenCalledTimes(1);
			expect(db.get).toHaveBeenCalledTimes(2);
		});
	});

	describe('#isBlockPersisted', () => {
		it('should call check if the id exists in the database', async () => {
			// Act
			await dataAccess.isBlockPersisted(block.header.id);

			// Assert
			expect(db.exists).toHaveBeenCalledWith(concatKeys(DB_KEY_BLOCKS_ID, block.header.id));
		});
	});

	describe('#getTempBlocks', () => {
		it('should call get temp blocks using stream', async () => {
			// Arrange
			(db.createReadStream as jest.Mock).mockImplementation(() =>
				Readable.from([
					{
						value: encodedDefaultBlock(block),
					},
				]),
			);
			// Act
			await dataAccess.getTempBlocks();

			// Assert
			expect(db.createReadStream).toHaveBeenCalledTimes(1);
		});
	});

	describe('#isTempBlockEmpty', () => {
		it('should return false when temp block exist', async () => {
			// Arrange
			(db.createReadStream as jest.Mock).mockImplementation(() =>
				Readable.from([
					{
						value: encodedDefaultBlock(block),
					},
				]),
			);
			// Act
			const result = await dataAccess.isTempBlockEmpty();

			// Assert
			expect(db.createReadStream).toHaveBeenCalledTimes(1);
			expect(result).toBeFalse();
		});

		it('should return true when temp block exist', async () => {
			// Arrange
			(db.createReadStream as jest.Mock).mockImplementation(() => Readable.from([]));
			// Act
			const result = await dataAccess.isTempBlockEmpty();

			// Assert
			expect(db.createReadStream).toHaveBeenCalledTimes(1);
			expect(result).toBeTrue();
		});
	});

	describe('#clearTempBlocks', () => {
		it('should call db clear function', async () => {
			// Act
			await dataAccess.clearTempBlocks();

			// Assert
			expect(db.clear).toHaveBeenCalledTimes(1);
			expect(db.clear).toHaveBeenCalledWith({
				gte: DB_KEY_TEMPBLOCKS_HEIGHT,
				lte: DB_KEY_TEMPBLOCKS_HEIGHT,
			});
		});
	});

	describe('#getAccountByAddress', () => {
		it('should get account by address and decode them', async () => {
			// Arrange
			const account = createFakeDefaultAccount({
				address: Buffer.from('cc96c0a5db38b968f563e7af6fb435585c889111', 'hex'),
				token: {
					balance: BigInt('100'),
				},
				sequence: {
					nonce: BigInt('0'),
				},
			});
			when(db.get)
				.calledWith(concatKeys(DB_KEY_ACCOUNTS_ADDRESS, account.address))
				.mockResolvedValue(encodeDefaultAccount(account) as never);
			// Act
			const result = await dataAccess.getAccountByAddress<{ token: { balance: bigint } }>(
				account.address,
			);

			// Assert
			expect(db.get).toHaveBeenCalledWith(concatKeys(DB_KEY_ACCOUNTS_ADDRESS, account.address));
			expect(typeof result.token.balance).toEqual('bigint');
		});
	});

	describe('#getAccountsByAddress', () => {
		it('should get accounts by each address and decode them', async () => {
			// Arrange
			const accounts = [
				createFakeDefaultAccount({
					address: Buffer.from('cc96c0a5db38b968f563e7af6fb435585c889111', 'hex'),
					token: {
						balance: BigInt('100'),
					},
					sequence: {
						nonce: BigInt('0'),
					},
				}),
				createFakeDefaultAccount({
					address: Buffer.from('584dd8a902822a9469fb2911fcc14ed5fd98220d', 'hex'),
					token: {
						balance: BigInt('300'),
					},
					sequence: {
						nonce: BigInt('0'),
					},
				}),
			];
			when(db.get)
				.calledWith(concatKeys(DB_KEY_ACCOUNTS_ADDRESS, accounts[0].address))
				.mockResolvedValue(encodeDefaultAccount(accounts[0]) as never)
				.calledWith(concatKeys(DB_KEY_ACCOUNTS_ADDRESS, accounts[1].address))
				.mockResolvedValue(encodeDefaultAccount(accounts[1]) as never);
			// Act
			const result = await dataAccess.getAccountsByAddress<{ token: { balance: bigint } }>(
				accounts.map(acc => acc.address),
			);

			// Assert
			expect(db.get).toHaveBeenCalledTimes(2);
			expect(typeof result[0].token.balance).toEqual('bigint');
		});
	});

	describe('#getTransactionsByIDs', () => {
		it('should get transaction by id', async () => {
			const tx = new Transaction({
				moduleID: 2,
				assetID: 0,
				fee: BigInt('10000000'),
				nonce: BigInt('0'),
				senderPublicKey: Buffer.from(
					'0fe9a3f1a21b5530f27f87a414b549e79a940bf24fdf2b2f05e7f22aeeecc86a',
					'hex',
				),
				signatures: [
					Buffer.from(
						'c49a1b9e8f5da4ddd9c8ad49b6c35af84c233701d53a876ef6e385a46888800334e28430166e2de8cac207452913f0e8b439b03ef8a795748ea23e28b8b1c00c',
						'hex',
					),
				],
				asset: Buffer.alloc(0),
			});
			// Arrange
			when(db.get)
				.calledWith(concatKeys(DB_KEY_TRANSACTIONS_ID, tx.id))
				.mockResolvedValue(tx.getBytes() as never);
			// Act
			const [result] = await dataAccess.getTransactionsByIDs([tx.id]);

			// Assert
			expect(db.get).toHaveBeenCalledWith(concatKeys(DB_KEY_TRANSACTIONS_ID, tx.id));
			expect(typeof result.fee).toBe('bigint');
		});
	});

	describe('#isTransactionPersisted', () => {
		it('should call exists with the id', async () => {
			// Act
			await dataAccess.isTransactionPersisted(Buffer.from('1'));

			// Assert
			expect(db.exists).toHaveBeenCalledWith(concatKeys(DB_KEY_TRANSACTIONS_ID, Buffer.from('1')));
		});
	});

	describe('encode', () => {
		it('should convert all the field to be a buffer', () => {
			const buffer = dataAccess.encode(block);
			expect(buffer).toBeInstanceOf(Buffer);
		});
	});

	describe('decode', () => {
		const originalBlock = {
			header: createFakeBlockHeader({
				transactionRoot: Buffer.from(
					'564352bc451aca0e2aeca2aebf7a3d7af18dbac73eaa31623971bfc63d20339c',
					'hex',
				),
				version: 2,
				height: 2,
				reward: BigInt(0),
				timestamp: 1000,
				previousBlockID: Buffer.from(
					'c49a1b9e8f5da4ddd9c8ad49b6c35af84c233701d53a876ef6e385a468888003',
					'hex',
				),
				generatorPublicKey: Buffer.from(
					'1c51f8d57dd74b9cede1fa957f46559cd9596655c46ae9a306364dc5b39581d1',
					'hex',
				),
				signature: Buffer.from(
					'acbe0321dfc4323dd0e6f41269d7dd875ae2bbc6adeb9a4b179cca00328c31e641599b5b0d16d9620886133ed977909d228ab777903f9c0d3842b9ea8630b909',
					'hex',
				),
				asset: {
					seedReveal: Buffer.from('00000000000000000000000000000000', 'hex'),
					maxHeightPreviouslyForged: 1,
					maxHeightPrevoted: 0,
				},
			}),
			payload: [
				new Transaction({
					id: Buffer.from('1065693148641117014'),
					type: 'token/transfer',
					fee: BigInt('10000000'),
					nonce: BigInt('0'),
					senderPublicKey: Buffer.from(
						'0fe9a3f1a21b5530f27f87a414b549e79a940bf24fdf2b2f05e7f22aeeecc86a',
						'hex',
					),
					signatures: [
						Buffer.from(
							'c49a1b9e8f5da4ddd9c8ad49b6c35af84c233701d53a876ef6e385a46888800334e28430166e2de8cac207452913f0e8b439b03ef8a795748ea23e28b8b1c00c',
							'hex',
						),
					],
					asset: Buffer.alloc(0),
				} as any),
			],
		};

		it('should be encode and decode back to the same block', () => {
			const encodedBlock = encodedDefaultBlock(originalBlock);
			const decodedBlock = dataAccess.decode(encodedBlock);
			expect(decodedBlock.header.id).toBeInstanceOf(Buffer);
			expect(decodedBlock.header.height).toEqual(originalBlock.header.height);
			expect(decodedBlock.header.signature).toEqual(originalBlock.header.signature);
			expect(decodedBlock.payload).toHaveLength(originalBlock.payload.length);
		});

		it('should convert transaction to be a class', () => {
			const decodedBlock = dataAccess.decode(encodedDefaultBlock(originalBlock));
			expect(decodedBlock.payload[0]).toBeInstanceOf(Transaction);
		});
	});

	describe('removeBlockHeader', () => {
		it('should fetch older blocks from database when minCachedItems is below configured value', async () => {
			// Arrange
			jest.spyOn(dataAccess, 'getBlockHeadersByHeightBetween');

			const blocks = [];
			for (let i = 0; i < 5; i += 1) {
				block = {
					header: createFakeBlockHeader({ height: i + 10 }),
					payload: [],
				};
				blocks.push(block);
				dataAccess.addBlockHeader(block.header);
			}

			// Act
			// Remove enough blocks for blocksCache.needsRefill to be true
			await dataAccess.removeBlockHeader(blocks[4].header.id);
			await dataAccess.removeBlockHeader(blocks[3].header.id);
			await dataAccess.removeBlockHeader(blocks[2].header.id);
			// Assert
			expect(dataAccess.getBlockHeadersByHeightBetween).toHaveBeenCalledWith(7, 9);
		});
	});
});
