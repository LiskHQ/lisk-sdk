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
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { objects, dataStructures } from '@liskhq/lisk-utils';
import { BlockHeader, Account, AccountDefaultProps } from '../../types';

interface AccountState {
	get<T = any>(address: Buffer): Promise<Account<T>>;
	getOrDefault<T = any>(address: Buffer): Promise<Account<T>>;
	set<T = any>(address: Buffer, account: T): Promise<void>;
	del(address: Buffer): Promise<void>;
	getUpdated<T = any>(): Account<T>[];
}

interface ChainState {
	lastBlockHeaders: BlockHeader[];
	lastBlockReward: bigint;
	networkIdentifier: Buffer;
	get(key: Buffer): Promise<Buffer | undefined>;
	set(key: Buffer, value: Buffer): Promise<void>;
}

interface ConsensusState {
	get(key: Buffer): Promise<Buffer | undefined>;
	set(key: Buffer, value: Buffer): Promise<void>;
}

export interface MockInput {
	accounts?: Account<any>[];
	defaultAccount?: AccountDefaultProps;
	chain?: { [key: string]: Buffer };
	consensus?: { [key: string]: Buffer };
	lastBlockHeaders?: Partial<BlockHeader>[];
	networkIdentifier?: Buffer;
	lastBlockReward?: bigint;
}

const defaultNetworkIdentifier = Buffer.from('', 'hex');

export class StateStoreMock {
	public accountData: { address: Buffer }[];
	public chainData: dataStructures.BufferMap<Buffer>;
	public consensusData: dataStructures.BufferMap<Buffer>;

	public account: AccountState;
	public chain: ChainState;
	public consensus: ConsensusState;

	private readonly _defaultAccount: AccountDefaultProps;

	public constructor({
		accounts,
		chain,
		consensus,
		defaultAccount,
		lastBlockHeaders,
		lastBlockReward,
		networkIdentifier,
	}: MockInput = {}) {
		// Make sure to be deep copy
		this.accountData = accounts?.map(a => ({ ...a } as { address: Buffer })) ?? [];
		this.chainData = new dataStructures.BufferMap<Buffer>(chain ?? {});
		this.consensusData = new dataStructures.BufferMap<Buffer>(consensus ?? {});
		this._defaultAccount = defaultAccount ?? {};

		this.account = {
			// eslint-disable-next-line @typescript-eslint/require-await
			get: async <T = any>(address: Buffer): Promise<Account<T>> => {
				const account = this.accountData.find(acc => acc.address.equals(address));
				if (!account) {
					throw new Error('Account not defined');
				}
				return objects.cloneDeep(account) as Account<T>;
			},
			// eslint-disable-next-line @typescript-eslint/require-await
			getOrDefault: async <T = any>(address: Buffer): Promise<Account<T>> => {
				const account = this.accountData.find(acc => acc.address.equals(address));
				if (!account) {
					return objects.cloneDeep({ ...this._defaultAccount, address }) as Account<T>;
				}
				return objects.cloneDeep(account) as Account<T>;
			},
			getUpdated: <T = any>() => this.accountData as Account<T>[],
			// eslint-disable-next-line @typescript-eslint/require-await
			set: async <T = any>(address: Buffer, account: Account<T>): Promise<void> => {
				const index = this.accountData.findIndex(acc => acc.address.equals(address));
				if (index > -1) {
					this.accountData[index] = account;
					return;
				}
				this.accountData.push(account);
			},
			// eslint-disable-next-line @typescript-eslint/require-await
			del: async (address: Buffer): Promise<void> => {
				const index = this.accountData.findIndex(acc => acc.address.equals(address));
				if (index < 0) {
					throw new Error('Cannot delete not existing account');
				}
				this.accountData.splice(index, 1);
			},
		};

		this.chain = {
			networkIdentifier: networkIdentifier ?? defaultNetworkIdentifier,
			lastBlockHeaders: (lastBlockHeaders as BlockHeader[]) ?? [],
			lastBlockReward: lastBlockReward ?? BigInt(0),
			get: async (key: Buffer): Promise<Buffer | undefined> =>
				Promise.resolve(objects.cloneDeep(this.chainData.get(key))),
			// eslint-disable-next-line @typescript-eslint/require-await
			set: async (key: Buffer, value: Buffer): Promise<void> => {
				this.chainData.set(key, value);
			},
		};

		this.consensus = {
			get: async (key: Buffer): Promise<Buffer | undefined> =>
				Promise.resolve(objects.cloneDeep(this.consensusData.get(key))),
			// eslint-disable-next-line @typescript-eslint/require-await
			set: async (key: Buffer, value: Buffer): Promise<void> => {
				this.consensusData.set(key, value);
			},
		};
	}
}
