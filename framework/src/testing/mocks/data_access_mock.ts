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
 *
 */

import { dataStructures } from '@liskhq/lisk-utils';
import { BlockHeader, Account, BlockHeaderAsset, AccountDefaultProps } from '@liskhq/lisk-chain';

export class DataAccessMock<T1 = AccountDefaultProps, T2 = BlockHeaderAsset> {
	protected _blockHeaders: BlockHeader<T2>[];
	protected _accounts: dataStructures.BufferMap<Account<T1>>;
	protected _chainState: dataStructures.BufferMap<Buffer>;

	public constructor(opts?: {
		blockHeaders?: BlockHeader<T2>[];
		accounts?: Account<T1>[];
		chainState?: Record<string, Buffer>;
	}) {
		this._blockHeaders = opts?.blockHeaders ?? [];
		this._chainState = new dataStructures.BufferMap<Buffer>(opts?.chainState ?? {});
		this._accounts = new dataStructures.BufferMap<Account<T1>>();

		for (const account of opts?.accounts ?? []) {
			this._accounts.set(account.address, account);
		}
	}

	public async getChainState(key: Buffer): Promise<Buffer | undefined> {
		return Promise.resolve(this._chainState.get(key));
	}

	public async getAccountByAddress<T3 = T1>(address: Buffer): Promise<Account<T3>> {
		if (!this._accounts.has(address)) {
			throw new Error(`Account with address ${address.toString('hex')} does not exists`);
		}

		return Promise.resolve((this._accounts.get(address) as unknown) as Account<T3>);
	}

	public async getLastBlockHeader(): Promise<BlockHeader<T2>> {
		return Promise.resolve(this._blockHeaders[this._blockHeaders.length - 1]);
	}
}
