/*
 * Copyright © 2021 Lisk Foundation
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

import { Transaction } from '@liskhq/lisk-chain';
import { Logger } from '../../logger';
import { APIContext } from './api_context';
import { EventQueue } from './event_queue';
import { TransactionContext } from './transaction_context';
import {
	BlockAfterExecuteContext,
	BlockExecuteContext,
	BlockVerifyContext,
	BlockHeader,
	StateStore,
} from './types';

export interface ContextParams {
	networkIdentifier: Buffer;
	stateStore: StateStore;
	header: BlockHeader;
	logger: Logger;
	eventQueue: EventQueue;
	transactions?: ReadonlyArray<Transaction>;
}

export class BlockContext {
	private readonly _stateStore: StateStore;
	private readonly _networkIdentifier: Buffer;
	private readonly _logger: Logger;
	private readonly _eventQueue: EventQueue;
	private readonly _header: BlockHeader;
	private readonly _transactions?: ReadonlyArray<Transaction>;

	public constructor(params: ContextParams) {
		this._logger = params.logger;
		this._networkIdentifier = params.networkIdentifier;
		this._stateStore = params.stateStore;
		this._eventQueue = params.eventQueue;
		this._header = params.header;
		this._transactions = params.transactions;
	}

	public get transactions(): ReadonlyArray<Transaction> {
		if (!this._transactions) {
			throw new Error('Transactions are not set');
		}
		return this._transactions;
	}

	public getBlockVerifyExecuteContext(): BlockVerifyContext {
		return {
			logger: this._logger,
			networkIdentifier: this._networkIdentifier,
			eventQueue: this._eventQueue,
			getAPIContext: () =>
				new APIContext({ stateStore: this._stateStore, eventQueue: this._eventQueue }),
			getStore: (moduleID: number, storePrefix: number) =>
				this._stateStore.getStore(moduleID, storePrefix),
			header: this._header,
		};
	}

	public getBlockExecuteContext(): BlockExecuteContext {
		return {
			logger: this._logger,
			networkIdentifier: this._networkIdentifier,
			eventQueue: this._eventQueue,
			getAPIContext: () =>
				new APIContext({ stateStore: this._stateStore, eventQueue: this._eventQueue }),
			getStore: (moduleID: number, storePrefix: number) =>
				this._stateStore.getStore(moduleID, storePrefix),
			header: this._header,
		};
	}

	public getBlockAfterExecuteContext(): BlockAfterExecuteContext {
		if (!this._transactions) {
			throw new Error('Cannot create block after execute context without transactions');
		}
		return {
			logger: this._logger,
			networkIdentifier: this._networkIdentifier,
			eventQueue: this._eventQueue,
			getAPIContext: () =>
				new APIContext({ stateStore: this._stateStore, eventQueue: this._eventQueue }),
			getStore: (moduleID: number, storePrefix: number) =>
				this._stateStore.getStore(moduleID, storePrefix),
			header: this._header,
			transactions: this._transactions,
		};
	}

	public getTransactionContext(tx: Transaction): TransactionContext {
		return new TransactionContext({
			networkIdentifier: this._networkIdentifier,
			logger: this._logger,
			stateStore: this._stateStore,
			transaction: tx,
			eventQueue: this._eventQueue,
			header: this._header,
		});
	}
}
