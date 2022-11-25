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

import { EventQueue } from './event_queue';
import { PrefixedStateReadWriter, StateDBReadWriter } from './prefixed_state_read_writer';
import {
	SubStore,
	ImmutableSubStore,
	ImmutableMethodContext,
	StateStore as IStateStore,
} from './types';

interface Params {
	stateStore: IStateStore;
	contextStore: Map<string, unknown>;
	eventQueue: EventQueue;
}

export const createMethodContext = (params: Params) => new MethodContext(params);

export const createNewMethodContext = (db: StateDBReadWriter) =>
	new MethodContext({
		stateStore: new PrefixedStateReadWriter(db),
		eventQueue: new EventQueue(0),
		contextStore: new Map<string, unknown>(),
	});

interface ImmutableSubStoreGetter {
	getStore: (moduleID: Buffer, storePrefix: Buffer) => ImmutableSubStore;
}

export const createImmutableMethodContext = (
	immutableSubstoreGetter: ImmutableSubStoreGetter,
): ImmutableMethodContext => ({
	getStore: (moduleID: Buffer, storePrefix: Buffer) =>
		immutableSubstoreGetter.getStore(moduleID, storePrefix),
});

export class MethodContext {
	private readonly _stateStore: IStateStore;
	private readonly _contextStore: Map<string, unknown>;
	private readonly _eventQueue: EventQueue;

	public constructor(params: Params) {
		this._eventQueue = params.eventQueue;
		this._stateStore = params.stateStore;
		this._contextStore = params.contextStore;
	}

	public getStore(moduleID: Buffer, storePrefix: Buffer): SubStore {
		return this._stateStore.getStore(moduleID, storePrefix);
	}

	public get contextStore(): Map<string, unknown> {
		return this._contextStore;
	}

	public get eventQueue(): EventQueue {
		return this._eventQueue;
	}
}
