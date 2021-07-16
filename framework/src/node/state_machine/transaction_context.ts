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
import { codec, Schema } from '@liskhq/lisk-codec';
import { Logger } from '../../logger';
import { APIContext } from './api_context';
import { EventQueue } from './event_queue';
import {
	CommandExecuteContext,
	CommandVerifyContext,
	TransactionExecuteContext,
	TransactionVerifyContext,
	BlockHeader,
	StateStore,
} from './types';

interface ContextParams {
	networkIdentifier: Buffer;
	stateStore: StateStore;
	logger: Logger;
	eventQueue: EventQueue;
	header: BlockHeader;
	transaction: Transaction;
}

export class TransactionContext {
	private readonly _stateStore: StateStore;
	private readonly _networkIdentifier: Buffer;
	private readonly _logger: Logger;
	private readonly _eventQueue: EventQueue;
	private readonly _transaction: Transaction;
	private readonly _header: BlockHeader;

	public constructor(params: ContextParams) {
		this._stateStore = params.stateStore;
		this._logger = params.logger;
		this._header = params.header;
		this._eventQueue = params.eventQueue;
		this._networkIdentifier = params.networkIdentifier;
		this._transaction = params.transaction;
	}

	public createTransactionVerifyContext(): TransactionVerifyContext {
		return {
			logger: this._logger,
			networkIdentifier: this._networkIdentifier,
			getAPIContext: () =>
				new APIContext({ stateStore: this._stateStore, eventQueue: this._eventQueue }),
			getStore: (moduleID: number, storePrefix: number) =>
				this._stateStore.getStore(moduleID, storePrefix),
			transaction: this._transaction,
		};
	}

	public createTransactionExecuteContext(): TransactionExecuteContext {
		return {
			logger: this._logger,
			networkIdentifier: this._networkIdentifier,
			eventQueue: this._eventQueue,
			getAPIContext: () =>
				new APIContext({ stateStore: this._stateStore, eventQueue: this._eventQueue }),
			getStore: (moduleID: number, storePrefix: number) =>
				this._stateStore.getStore(moduleID, storePrefix),
			header: this._header,
			transaction: this._transaction,
		};
	}

	public createCommandVerifyContext(paramsSchema: Schema): CommandVerifyContext<unknown> {
		return {
			logger: this._logger,
			networkIdentifier: this._networkIdentifier,
			getAPIContext: () =>
				new APIContext({ stateStore: this._stateStore, eventQueue: this._eventQueue }),
			getStore: (moduleID: number, storePrefix: number) =>
				this._stateStore.getStore(moduleID, storePrefix),
			transaction: this._transaction,
			params: codec.decode(paramsSchema, this._transaction.asset),
		};
	}

	public createCommandExecuteContext(paramsSchema: Schema): CommandExecuteContext<unknown> {
		return {
			logger: this._logger,
			networkIdentifier: this._networkIdentifier,
			getAPIContext: () =>
				new APIContext({ stateStore: this._stateStore, eventQueue: this._eventQueue }),
			getStore: (moduleID: number, storePrefix: number) =>
				this._stateStore.getStore(moduleID, storePrefix),
			transaction: this._transaction,
			params: codec.decode(paramsSchema, this._transaction.asset),
		};
	}

	public get transaction(): Transaction {
		return this._transaction;
	}
}
