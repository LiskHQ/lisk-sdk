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
import { StateStore, SubStore } from './types';

interface Params {
	stateStore: StateStore;
	eventQueue: EventQueue;
}

export class APIContext {
	private readonly _stateStore: StateStore;
	private readonly _eventQueue: EventQueue;

	public constructor(params: Params) {
		this._eventQueue = params.eventQueue;
		this._stateStore = params.stateStore;
	}

	public getStore(moduleID: number, storePrefix: number): SubStore {
		return this._stateStore.getStore(moduleID, storePrefix);
	}

	public get eventQueue(): EventQueue {
		return this._eventQueue;
	}
}
