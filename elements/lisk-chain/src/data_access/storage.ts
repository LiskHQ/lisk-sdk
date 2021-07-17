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
import { KVStore, formatInt, getFirstPrefix, getLastPrefix, NotFoundError } from '@liskhq/lisk-db';
import { codec } from '@liskhq/lisk-codec';
import { getAddressFromPublicKey, hash } from '@liskhq/lisk-cryptography';
import { RawBlock, StateDiff } from '../types';
import { StateStore } from '../state_store';

import {
	DB_KEY_BLOCKS_ID,
	DB_KEY_BLOCKS_HEIGHT,
	DB_KEY_TRANSACTIONS_BLOCK_ID,
	DB_KEY_TRANSACTIONS_ID,
	DB_KEY_TEMPBLOCKS_HEIGHT,
	DB_KEY_ACCOUNTS_ADDRESS,
	DB_KEY_CHAIN_STATE,
	DB_KEY_CONSENSUS_STATE,
	DB_KEY_DIFF_STATE,
} from './constants';
import { concatKeys } from '../utils';
import { stateDiffSchema } from '../schema';

export class Storage {
	private readonly _db: KVStore;

	public constructor(db: KVStore) {
		this._db = db;
	}

	/*
		Block headers
	*/
	public async getBlockHeaderByID(id: Buffer): Promise<Buffer> {
		const block = await this._db.get(concatKeys(DB_KEY_BLOCKS_ID, id));
		return block;
	}

	public async getBlockHeadersByIDs(arrayOfBlockIds: ReadonlyArray<Buffer>): Promise<Buffer[]> {
		const blocks = [];
		for (const id of arrayOfBlockIds) {
			try {
				const block = await this._db.get(concatKeys(DB_KEY_BLOCKS_ID, id));
				blocks.push(block);
			} catch (dbError) {
				if (dbError instanceof NotFoundError) {
					continue;
				}
				throw dbError;
			}
		}
		return blocks;
	}

	public async getBlockHeaderByHeight(height: number): Promise<Buffer> {
		const id = await this._db.get(concatKeys(DB_KEY_BLOCKS_HEIGHT, formatInt(height)));
		return this.getBlockHeaderByID(id);
	}

	public async getBlockHeadersByHeightBetween(
		fromHeight: number,
		toHeight: number,
	): Promise<Buffer[]> {
		const stream = this._db.createReadStream({
			gte: concatKeys(DB_KEY_BLOCKS_HEIGHT, formatInt(fromHeight)),
			lte: concatKeys(DB_KEY_BLOCKS_HEIGHT, formatInt(toHeight)),
			reverse: true,
		});
		const blockIDs = await new Promise<Buffer[]>((resolve, reject) => {
			const ids: Buffer[] = [];
			stream
				.on('data', ({ value }: { value: Buffer }) => {
					ids.push(value);
				})
				.on('error', error => {
					reject(error);
				})
				.on('end', () => {
					resolve(ids);
				});
		});

		return this.getBlockHeadersByIDs(blockIDs);
	}

	public async getBlockHeadersWithHeights(heightList: ReadonlyArray<number>): Promise<Buffer[]> {
		const blocks = [];
		for (const height of heightList) {
			try {
				const block = await this.getBlockHeaderByHeight(height);
				blocks.push(block);
			} catch (dbError) {
				if (dbError instanceof NotFoundError) {
					continue;
				}
				throw dbError;
			}
		}
		return blocks;
	}

	public async getLastBlockHeader(): Promise<Buffer> {
		const stream = this._db.createReadStream({
			gte: getFirstPrefix(DB_KEY_BLOCKS_HEIGHT),
			lte: getLastPrefix(DB_KEY_BLOCKS_HEIGHT),
			reverse: true,
			limit: 1,
		});
		const [blockID] = await new Promise<Buffer[]>((resolve, reject) => {
			const ids: Buffer[] = [];
			stream
				.on('data', ({ value }: { value: Buffer }) => {
					ids.push(value);
				})
				.on('error', error => {
					reject(error);
				})
				.on('end', () => {
					resolve(ids);
				});
		});
		if (!blockID) {
			throw new NotFoundError('Last block header not found');
		}

		return this.getBlockHeaderByID(blockID);
	}

	/*
		Extended blocks with transaction payload
	*/

	public async getBlockByID(id: Buffer): Promise<RawBlock> {
		const blockHeader = await this.getBlockHeaderByID(id);
		const transactions = await this._getTransactions(id);

		return {
			header: blockHeader,
			payload: transactions,
		};
	}

	public async getBlocksByIDs(arrayOfBlockIds: ReadonlyArray<Buffer>): Promise<RawBlock[]> {
		const blocks = [];

		for (const id of arrayOfBlockIds) {
			try {
				const block = await this.getBlockByID(id);
				blocks.push(block);
			} catch (dbError) {
				if (dbError instanceof NotFoundError) {
					continue;
				}
				throw dbError;
			}
		}

		return blocks;
	}

	public async getBlockByHeight(height: number): Promise<RawBlock> {
		const header = await this.getBlockHeaderByHeight(height);
		const blockID = hash(header);
		const transactions = await this._getTransactions(blockID);

		return {
			header,
			payload: transactions,
		};
	}

	public async getBlocksByHeightBetween(fromHeight: number, toHeight: number): Promise<RawBlock[]> {
		const headers = await this.getBlockHeadersByHeightBetween(fromHeight, toHeight);
		const blocks = [];
		for (const header of headers) {
			const blockID = hash(header);
			const transactions = await this._getTransactions(blockID);
			blocks.push({ header, payload: transactions });
		}

		return blocks;
	}

	public async getLastBlock(): Promise<RawBlock> {
		const header = await this.getLastBlockHeader();
		const blockID = hash(header);
		const transactions = await this._getTransactions(blockID);

		return {
			header,
			payload: transactions,
		};
	}

	public async getTempBlocks(): Promise<Buffer[]> {
		const stream = this._db.createReadStream({
			gte: getFirstPrefix(DB_KEY_TEMPBLOCKS_HEIGHT),
			lte: getLastPrefix(DB_KEY_TEMPBLOCKS_HEIGHT),
			reverse: true,
		});
		const tempBlocks = await new Promise<Buffer[]>((resolve, reject) => {
			const blocks: Buffer[] = [];
			stream
				.on('data', ({ value }: { value: Buffer }) => {
					blocks.push(value);
				})
				.on('error', error => {
					reject(error);
				})
				.on('end', () => {
					resolve(blocks);
				});
		});

		return tempBlocks;
	}

	public async isTempBlockEmpty(): Promise<boolean> {
		const stream = this._db.createReadStream({
			gte: getFirstPrefix(DB_KEY_TEMPBLOCKS_HEIGHT),
			lte: getLastPrefix(DB_KEY_TEMPBLOCKS_HEIGHT),
			limit: 1,
		});
		const tempBlocks = await new Promise<Buffer[]>((resolve, reject) => {
			const blocks: Buffer[] = [];
			stream
				.on('data', ({ value }: { value: Buffer }) => {
					blocks.push(value);
				})
				.on('error', error => {
					reject(error);
				})
				.on('end', () => {
					resolve(blocks);
				});
		});

		return tempBlocks.length === 0;
	}

	public async clearTempBlocks(): Promise<void> {
		await this._db.clear({
			gte: getFirstPrefix(DB_KEY_TEMPBLOCKS_HEIGHT),
			lte: getLastPrefix(DB_KEY_TEMPBLOCKS_HEIGHT),
		});
	}

	public async isBlockPersisted(blockID: Buffer): Promise<boolean> {
		return this._db.exists(concatKeys(DB_KEY_BLOCKS_ID, blockID));
	}

	/*
		ChainState
	*/
	public async getChainState(key: Buffer): Promise<Buffer | undefined> {
		try {
			const value = await this._db.get(concatKeys(DB_KEY_CHAIN_STATE, key));

			return value;
		} catch (error) {
			if (error instanceof NotFoundError) {
				return undefined;
			}
			throw error;
		}
	}

	/*
		ConsensusState
	*/
	public async getConsensusState(key: Buffer): Promise<Buffer | undefined> {
		try {
			const value = await this._db.get(concatKeys(DB_KEY_CONSENSUS_STATE, key));

			return value;
		} catch (error) {
			if (error instanceof NotFoundError) {
				return undefined;
			}
			throw error;
		}
	}

	/*
		Accounts
	*/
	public async getAccountByAddress(address: Buffer): Promise<Buffer> {
		const account = await this._db.get(concatKeys(DB_KEY_ACCOUNTS_ADDRESS, address));
		return account;
	}

	public async getAccountsByPublicKey(arrayOfPublicKeys: ReadonlyArray<Buffer>): Promise<Buffer[]> {
		const addresses = arrayOfPublicKeys.map(getAddressFromPublicKey);

		return this.getAccountsByAddress(addresses);
	}

	public async getAccountsByAddress(arrayOfAddresses: ReadonlyArray<Buffer>): Promise<Buffer[]> {
		const accounts = [];
		for (const address of arrayOfAddresses) {
			try {
				const account = await this.getAccountByAddress(address);
				accounts.push(account);
			} catch (dbError) {
				if (dbError instanceof NotFoundError) {
					continue;
				}
				throw dbError;
			}
		}

		return accounts;
	}

	/*
		Transactions
	*/
	public async getTransactionByID(id: Buffer): Promise<Buffer> {
		const transaction = await this._db.get(concatKeys(DB_KEY_TRANSACTIONS_ID, id));

		return transaction;
	}

	public async getTransactionsByIDs(
		arrayOfTransactionIds: ReadonlyArray<Buffer>,
	): Promise<Buffer[]> {
		const transactions = [];
		for (const id of arrayOfTransactionIds) {
			try {
				const transaction = await this.getTransactionByID(id);
				transactions.push(transaction);
			} catch (dbError) {
				if (dbError instanceof NotFoundError) {
					continue;
				}
				throw dbError;
			}
		}

		return transactions;
	}

	public async isTransactionPersisted(transactionId: Buffer): Promise<boolean> {
		return this._db.exists(concatKeys(DB_KEY_TRANSACTIONS_ID, transactionId));
	}

	/*
		Save Block
	*/
	public async saveBlock(
		id: Buffer,
		height: number,
		finalizedHeight: number,
		header: Buffer,
		payload: { id: Buffer; value: Buffer }[],
		stateStore: StateStore,
		removeFromTemp = false,
	): Promise<void> {
		const heightBuf = formatInt(height);
		const batch = this._db.batch();
		batch.put(concatKeys(DB_KEY_BLOCKS_ID, id), header);
		batch.put(concatKeys(DB_KEY_BLOCKS_HEIGHT, heightBuf), id);
		if (payload.length > 0) {
			const ids = [];
			for (const { id: txID, value } of payload) {
				ids.push(txID);
				batch.put(concatKeys(DB_KEY_TRANSACTIONS_ID, txID), value);
			}
			batch.put(concatKeys(DB_KEY_TRANSACTIONS_BLOCK_ID, id), Buffer.concat(ids));
		}
		if (removeFromTemp) {
			batch.del(concatKeys(DB_KEY_TEMPBLOCKS_HEIGHT, heightBuf));
		}
		stateStore.finalize(height, batch);
		await batch.write();
		await this._cleanUntil(finalizedHeight);
	}

	public async deleteBlock(
		id: Buffer,
		height: number,
		txIDs: Buffer[],
		fullBlock: Buffer,
		stateStore: StateStore,
		saveToTemp = false,
	): Promise<StateDiff> {
		const batch = this._db.batch();
		const heightBuf = formatInt(height);
		batch.del(concatKeys(DB_KEY_BLOCKS_ID, id));
		batch.del(concatKeys(DB_KEY_BLOCKS_HEIGHT, heightBuf));
		if (txIDs.length > 0) {
			for (const txID of txIDs) {
				batch.del(concatKeys(DB_KEY_TRANSACTIONS_ID, txID));
			}
			batch.del(concatKeys(DB_KEY_TRANSACTIONS_BLOCK_ID, id));
		}
		if (saveToTemp) {
			batch.put(concatKeys(DB_KEY_TEMPBLOCKS_HEIGHT, heightBuf), fullBlock);
		}
		// Take the diff to revert back states
		const diffKey = concatKeys(DB_KEY_DIFF_STATE, heightBuf);

		// If there is no diff, the key might not exist
		const stateDiff = await this._db.get(diffKey);

		const {
			created: createdStates,
			updated: updatedStates,
			deleted: deletedStates,
		} = codec.decode<StateDiff>(stateDiffSchema, stateDiff);
		// Delete all the newly created states
		for (const key of createdStates) {
			batch.del(key);
		}
		// Revert all deleted values
		for (const { key, value: previousValue } of deletedStates) {
			batch.put(key, previousValue);
		}
		for (const { key, value: previousValue } of updatedStates) {
			batch.put(key, previousValue);
		}
		stateStore.finalize(height, batch);

		// Delete stored diff at particular height
		batch.del(diffKey);

		// Persist the whole batch
		await batch.write();
		return {
			deleted: deletedStates,
			created: createdStates,
			updated: updatedStates,
		};
	}

	// This function is out of batch, but even if it fails, it will run again next time
	private async _cleanUntil(height: number): Promise<void> {
		await this._db.clear({
			gte: concatKeys(DB_KEY_DIFF_STATE, formatInt(0)),
			lt: concatKeys(DB_KEY_DIFF_STATE, formatInt(height)),
		});
	}

	private async _getTransactions(blockID: Buffer): Promise<Buffer[]> {
		const txIDs: Buffer[] = [];
		try {
			const ids = await this._db.get(concatKeys(DB_KEY_TRANSACTIONS_BLOCK_ID, blockID));
			const idLength = 32;
			for (let i = 0; i < ids.length; i += idLength) {
				txIDs.push(ids.slice(i, i + idLength));
			}
		} catch (error) {
			if (!(error instanceof NotFoundError)) {
				throw error;
			}
		}
		if (txIDs.length === 0) {
			return [];
		}
		const transactions = [];
		for (const txID of txIDs) {
			const tx = await this._db.get(concatKeys(DB_KEY_TRANSACTIONS_ID, txID));
			transactions.push(tx);
		}

		return transactions;
	}
}
