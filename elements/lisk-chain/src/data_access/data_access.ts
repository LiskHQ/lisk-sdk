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
import { KVStore, NotFoundError } from '@liskhq/lisk-db';
import { codec, Schema } from '@liskhq/lisk-codec';
import { Transaction } from '../transaction';
import { BlockHeader, Block, RawBlock, Account, BlockHeaderAsset } from '../types';

import { BlockCache } from './cache';
import { Storage as StorageAccess } from './storage';
import { StateStore } from '../state_store';
import { BlockHeaderInterfaceAdapter } from './block_header_interface_adapter';
import { blockSchema } from '../schema';
import { DB_KEY_ACCOUNTS_ADDRESS } from './constants';

interface DAConstructor {
	readonly db: KVStore;
	readonly registeredBlockHeaders: {
		readonly [key: number]: Schema;
	};
	readonly accountSchema: Schema;
	readonly minBlockHeaderCache: number;
	readonly maxBlockHeaderCache: number;
}

export class DataAccess {
	private readonly _storage: StorageAccess;
	private readonly _blocksCache: BlockCache;
	private readonly _accountSchema: Schema;
	private readonly _blockHeaderAdapter: BlockHeaderInterfaceAdapter;

	public constructor({
		db,
		registeredBlockHeaders,
		accountSchema,
		minBlockHeaderCache,
		maxBlockHeaderCache,
	}: DAConstructor) {
		this._storage = new StorageAccess(db);
		this._blocksCache = new BlockCache(minBlockHeaderCache, maxBlockHeaderCache);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		this._accountSchema = accountSchema;
		this._blockHeaderAdapter = new BlockHeaderInterfaceAdapter(registeredBlockHeaders);
	}

	// BlockHeaders are all the block properties included for block signature + signature of block
	/** Begin: BlockHeaders */
	public addBlockHeader(blockHeader: BlockHeader): BlockHeader[] {
		return this._blocksCache.add(blockHeader);
	}

	public async removeBlockHeader(id: Buffer): Promise<BlockHeader[]> {
		const cachedItems = this._blocksCache.remove(id);

		if (!this._blocksCache.needsRefill) {
			return cachedItems;
		}

		// Get the height limits to fetch
		// The method getBlocksByHeightBetween uses gte & lte so we need to adjust values
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		const upperHeightToFetch = this._blocksCache.items[0]?.height - 1 || 0;

		const lowerHeightToFetch = Math.max(
			upperHeightToFetch - (this._blocksCache.maxCachedItems - this._blocksCache.minCachedItems),
			1,
		);

		if (upperHeightToFetch - lowerHeightToFetch > 0) {
			const blockHeaders = await this.getBlockHeadersByHeightBetween(
				lowerHeightToFetch,
				upperHeightToFetch,
			);
			// The method returns in descending order but we need in ascending order so reverse the array
			this._blocksCache.refill(blockHeaders.reverse());
		}

		return cachedItems;
	}

	public resetBlockHeaderCache(): void {
		this._blocksCache.empty();
	}

	public getBlockHeaderAssetSchema(version: number): Schema {
		return this._blockHeaderAdapter.getSchema(version);
	}

	public async getBlockHeaderByID(id: Buffer): Promise<BlockHeader> {
		const cachedBlock = this._blocksCache.getByID(id);

		if (cachedBlock) {
			return cachedBlock;
		}
		const blockHeaderBuffer = await this._storage.getBlockHeaderByID(id);

		return this._blockHeaderAdapter.decode(blockHeaderBuffer);
	}

	public async getBlockHeadersByIDs(
		arrayOfBlockIds: ReadonlyArray<Buffer>,
	): Promise<BlockHeader[]> {
		const cachedBlocks = this._blocksCache.getByIDs(arrayOfBlockIds);

		if (cachedBlocks.length) {
			return cachedBlocks;
		}
		const blocks = await this._storage.getBlockHeadersByIDs(arrayOfBlockIds);

		return blocks.map(block => this._blockHeaderAdapter.decode(block));
	}

	public async getBlockHeaderByHeight(height: number): Promise<BlockHeader> {
		const cachedBlock = this._blocksCache.getByHeight(height);

		if (cachedBlock) {
			return cachedBlock;
		}
		const header = await this._storage.getBlockHeaderByHeight(height);

		return this._blockHeaderAdapter.decode(header);
	}

	public async getBlockHeadersByHeightBetween(
		fromHeight: number,
		toHeight: number,
	): Promise<BlockHeader[]> {
		const cachedBlocks = this._blocksCache.getByHeightBetween(fromHeight, toHeight);

		if (cachedBlocks.length) {
			return cachedBlocks;
		}

		const blocks = await this._storage.getBlockHeadersByHeightBetween(fromHeight, toHeight);

		return blocks.map(block => this._blockHeaderAdapter.decode(block));
	}

	public async getBlockHeadersWithHeights(
		heightList: ReadonlyArray<number>,
	): Promise<BlockHeader[]> {
		const cachedBlocks = this._blocksCache.getByHeights(heightList);

		if (cachedBlocks.length) {
			return cachedBlocks;
		}

		const blocks = await this._storage.getBlockHeadersWithHeights(heightList);

		return blocks.map(block => this._blockHeaderAdapter.decode(block));
	}

	public async getLastBlockHeader(): Promise<BlockHeader> {
		const cachedBlock = this._blocksCache.last;

		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		if (cachedBlock) {
			return cachedBlock;
		}

		const block = await this._storage.getLastBlockHeader();

		return this._blockHeaderAdapter.decode(block);
	}

	public async getHighestCommonBlockHeader(
		arrayOfBlockIds: ReadonlyArray<Buffer>,
	): Promise<BlockHeader | undefined> {
		const headers = this._blocksCache.getByIDs(arrayOfBlockIds);
		headers.sort((a, b) => b.height - a.height);
		const cachedBlockHeader = headers[0];

		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		if (cachedBlockHeader) {
			return cachedBlockHeader;
		}

		const storageBlockHeaders = [];
		for (const id of arrayOfBlockIds) {
			try {
				const blockHeader = await this.getBlockHeaderByID(id);
				storageBlockHeaders.push(blockHeader);
			} catch (error) {
				if (!(error instanceof NotFoundError)) {
					throw error;
				}
			}
		}
		storageBlockHeaders.sort((a, b) => b.height - a.height);

		return storageBlockHeaders[0];
	}

	/** End: BlockHeaders */

	/** Begin: Blocks */

	public async getBlockByID<T>(id: Buffer): Promise<Block<T>> {
		const block = await this._storage.getBlockByID(id);

		return this._decodeRawBlock(block);
	}

	public async getBlocksByIDs(arrayOfBlockIds: ReadonlyArray<Buffer>): Promise<Block[]> {
		const blocks = await this._storage.getBlocksByIDs(arrayOfBlockIds);

		return blocks.map(block => this._decodeRawBlock(block));
	}

	public async getBlockByHeight(height: number): Promise<Block> {
		const block = await this._storage.getBlockByHeight(height);

		return this._decodeRawBlock(block);
	}

	public async getBlocksByHeightBetween(fromHeight: number, toHeight: number): Promise<Block[]> {
		const blocks = await this._storage.getBlocksByHeightBetween(fromHeight, toHeight);

		return blocks.map(block => this._decodeRawBlock(block));
	}

	public async getLastBlock(): Promise<Block> {
		const block = await this._storage.getLastBlock();

		return this._decodeRawBlock(block);
	}

	public async isBlockPersisted(blockId: Buffer): Promise<boolean> {
		const isPersisted = await this._storage.isBlockPersisted(blockId);

		return isPersisted;
	}

	public async getTempBlocks(): Promise<Block[]> {
		const blocks = await this._storage.getTempBlocks();

		return blocks.map(block => this.decode(block));
	}

	public async isTempBlockEmpty(): Promise<boolean> {
		const isEmpty = await this._storage.isTempBlockEmpty();

		return isEmpty;
	}

	public async clearTempBlocks(): Promise<void> {
		await this._storage.clearTempBlocks();
	}
	/** End: Blocks */

	/** Begin: ChainState */
	public async getChainState(key: Buffer): Promise<Buffer | undefined> {
		return this._storage.getChainState(key);
	}
	/** End: ChainState */

	/** Begin ConsensusState */
	public async getConsensusState(key: Buffer): Promise<Buffer | undefined> {
		return this._storage.getConsensusState(key);
	}
	/** End: ConsensusState */

	/** Begin: Accounts */
	public async getAccountsByPublicKey(
		arrayOfPublicKeys: ReadonlyArray<Buffer>,
	): Promise<Account[]> {
		const accounts = await this._storage.getAccountsByPublicKey(arrayOfPublicKeys);

		return accounts.map(account => this.decodeAccount(account));
	}

	public async getAccountByAddress<T>(address: Buffer): Promise<Account<T>> {
		const account = await this._storage.getAccountByAddress(address);

		return this.decodeAccount<T>(account);
	}

	public async getEncodedAccountByAddress(address: Buffer): Promise<Buffer> {
		const account = await this._storage.getAccountByAddress(address);

		return account;
	}

	public async getAccountsByAddress<T>(
		arrayOfAddresses: ReadonlyArray<Buffer>,
	): Promise<Account<T>[]> {
		const accounts = await this._storage.getAccountsByAddress(arrayOfAddresses);

		return accounts.map(account => this.decodeAccount<T>(account));
	}
	/** End: Accounts */

	/** Begin: Transactions */
	public async getTransactionByID(id: Buffer): Promise<Transaction> {
		const transaction = await this._storage.getTransactionByID(id);
		return Transaction.decode(transaction);
	}

	public async getTransactionsByIDs(
		arrayOfTransactionIds: ReadonlyArray<Buffer>,
	): Promise<Transaction[]> {
		const transactions = await this._storage.getTransactionsByIDs(arrayOfTransactionIds);

		return transactions.map(transaction => Transaction.decode(transaction));
	}

	public async isTransactionPersisted(transactionId: Buffer): Promise<boolean> {
		const isPersisted = await this._storage.isTransactionPersisted(transactionId);

		return isPersisted;
	}
	/** End: Transactions */

	public decode<T = BlockHeaderAsset>(buffer: Buffer): Block<T> {
		const block = codec.decode<RawBlock>(blockSchema, buffer);
		const header = this._blockHeaderAdapter.decode<T>(block.header);
		const payload: Transaction[] = [];
		for (const rawTx of block.payload) {
			const tx = Transaction.decode(rawTx);
			payload.push(tx);
		}
		return {
			header,
			payload,
		};
	}

	public encode(block: Block<unknown>): Buffer {
		const header = this.encodeBlockHeader(block.header);

		const payload: Buffer[] = [];
		for (const rawTx of block.payload) {
			const tx = rawTx.getBytes();
			payload.push(tx);
		}
		return codec.encode(blockSchema, { header, payload });
	}

	public decodeBlockHeader<T = BlockHeaderAsset>(buffer: Buffer): BlockHeader<T> {
		return this._blockHeaderAdapter.decode(buffer);
	}

	public encodeBlockHeader<T = BlockHeaderAsset>(
		blockHeader: BlockHeader<T>,
		skipSignature = false,
	): Buffer {
		return this._blockHeaderAdapter.encode(blockHeader, skipSignature);
	}

	public decodeAccount<T>(buffer: Buffer): Account<T> {
		return codec.decode<Account<T>>(this._accountSchema, buffer);
	}

	public encodeAccount<T>(account: Account<T>): Buffer {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return codec.encode(this._accountSchema, account as any);
	}

	public decodeTransaction(buffer: Buffer): Transaction {
		return Transaction.decode(buffer);
	}

	public encodeTransaction(tx: Transaction): Buffer {
		return tx.getBytes();
	}

	/*
		Save Block
	*/
	public async saveBlock(
		block: Block,
		stateStore: StateStore,
		finalizedHeight: number,
		removeFromTemp = false,
	): Promise<void> {
		const { id: blockID, height } = block.header;
		const encodedHeader = this._blockHeaderAdapter.encode(block.header);
		const encodedPayload = [];
		for (const tx of block.payload) {
			const txID = tx.id;
			const encodedTx = tx.getBytes();
			encodedPayload.push({ id: txID, value: encodedTx });
		}
		await this._storage.saveBlock(
			blockID,
			height,
			finalizedHeight,
			encodedHeader,
			encodedPayload,
			stateStore,
			removeFromTemp,
		);
	}

	public async deleteBlock(
		block: Block,
		stateStore: StateStore,
		saveToTemp = false,
	): Promise<Account[]> {
		const { id: blockID, height } = block.header;
		const txIDs = block.payload.map(tx => tx.id);
		const encodedBlock = this.encode(block);
		const diff = await this._storage.deleteBlock(
			blockID,
			height,
			txIDs,
			encodedBlock,
			stateStore,
			saveToTemp,
		);
		const updatedAccounts: Account[] = [];
		// Diff is deleted since when saving a block, it was deleted, but when it's deleting the block, now it's creating
		for (const created of diff.deleted) {
			if (created.key.includes(DB_KEY_ACCOUNTS_ADDRESS)) {
				updatedAccounts.push(this.decodeAccount(created.value));
			}
		}
		for (const updated of diff.updated) {
			if (updated.key.includes(DB_KEY_ACCOUNTS_ADDRESS)) {
				updatedAccounts.push(this.decodeAccount(updated.value));
			}
		}
		return updatedAccounts;
	}

	private _decodeRawBlock<T>(block: RawBlock): Block<T> {
		const header = this._blockHeaderAdapter.decode<T>(block.header);
		const payload = [];
		for (const rawTx of block.payload) {
			const tx = Transaction.decode(rawTx);
			payload.push(tx);
		}
		return {
			header,
			payload,
		};
	}
}
