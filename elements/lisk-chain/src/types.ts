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
import { Transaction } from './transaction';

export interface Context {
	readonly blockVersion: number;
	readonly blockHeight: number;
	readonly blockTimestamp: number;
}
export type Contexter = (() => Context) | Context;

export interface BlockRewardOptions {
	readonly distance: number;
	readonly rewardOffset: number;
	readonly milestones: ReadonlyArray<bigint>;
}

export interface BaseBlockHeader {
	readonly id: Buffer;
	readonly version: number;
	readonly timestamp: number;
	readonly height: number;
	readonly previousBlockID: Buffer;
	readonly transactionRoot: Buffer;
	readonly generatorPublicKey: Buffer;
	readonly reward: bigint;
	readonly signature: Buffer;
}

export type RawBlockHeader = BaseBlockHeader & { asset: Buffer };

export interface RawBlock {
	header: Buffer;
	payload: ReadonlyArray<Buffer>;
}

export interface GenesisBlockHeaderAsset<T = AccountDefaultProps> {
	readonly accounts: ReadonlyArray<Account<T>>;
	readonly initDelegates: ReadonlyArray<Buffer>;
	readonly initRounds: number;
}

export interface BlockHeaderAsset {
	readonly seedReveal: Buffer;
	readonly maxHeightPreviouslyForged: number;
	readonly maxHeightPrevoted: number;
}

export type BlockHeader<T = BlockHeaderAsset> = BaseBlockHeader & { asset: T };

export type GenesisBlockHeader<T = AccountDefaultProps> = BaseBlockHeader & {
	asset: GenesisBlockHeaderAsset<T>;
};

export interface Block<T = BlockHeaderAsset> {
	header: BlockHeader<T>;
	payload: ReadonlyArray<Transaction>;
}

export interface GenesisBlock<T = AccountDefaultProps> {
	header: GenesisBlockHeader<T>;
	payload: ReadonlyArray<Transaction>;
}

export interface DiffHistory {
	code: string;
	line: number;
}

export interface StateDiff {
	readonly updated: Array<Readonly<UpdatedDiff>>;
	readonly created: Array<Buffer>;
	readonly deleted: Array<Readonly<UpdatedDiff>>;
}

export interface UpdatedDiff {
	readonly key: Buffer;
	readonly value: Buffer;
}

export interface AccountSchema {
	type: string;
	fieldNumber: number;
	properties: Record<string, unknown>;
	default: Record<string, unknown>;
}

export type AccountDefaultProps = {
	[name: string]: { [key: string]: unknown } | undefined | Buffer;
};

export type Account<T = AccountDefaultProps> = T & { address: Buffer };

export interface Validator {
	address: Buffer;
	minActiveHeight: number;
	isConsensusParticipant: boolean;
}
