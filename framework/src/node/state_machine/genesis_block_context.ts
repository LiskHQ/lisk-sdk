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

import { GenesisBlockHeader } from '@liskhq/lisk-chain';
import { Logger } from '../../logger';
import { APIContext } from './api_context';
import { EventQueue } from './event_queue';
import { GenesisBlockExecuteContext, StateStore } from './types';

export interface ContextParams {
	logger: Logger;
	stateStore: StateStore;
	header: GenesisBlockHeader;
	eventQueue: EventQueue;
}

export class GenesisBlockContext {
	private readonly _stateStore: StateStore;
	private readonly _logger: Logger;
	private readonly _header: GenesisBlockHeader;
	private readonly _eventQueue: EventQueue;

	public constructor(params: ContextParams) {
		this._logger = params.logger;
		this._stateStore = params.stateStore;
		this._eventQueue = params.eventQueue;
		this._header = params.header;
	}

	public createGenesisBlockExecuteContext(): GenesisBlockExecuteContext {
		return {
			eventQueue: this._eventQueue,
			getAPIContext: () =>
				new APIContext({ stateStore: this._stateStore, eventQueue: this._eventQueue }),
			getStore: (moduleID: number, storePrefix: number) =>
				this._stateStore.getStore(moduleID, storePrefix),
			header: this._header,
			logger: this._logger,
		};
	}
}
