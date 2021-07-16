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
import { Transaction, GenesisBlockHeader } from '@liskhq/lisk-chain';
import { Schema } from '@liskhq/lisk-codec';
import { Logger } from '../../logger';
import { EventQueue } from './event_queue';

export interface StateStore {
	getStore: (moduleID: number, storePrefix: number) => SubStore;
	createSnapshot(): void;
	restoreSnapshot(): void;
}

export interface ImmutableSubStore {
	get(key: Buffer): Promise<Buffer>;
	getWithSchema<T>(key: Buffer, schema: Schema): Promise<T>;
	has(key: Buffer): Promise<boolean>;
	iterate(input: {
		start: Buffer;
		end: Buffer;
		limit?: number;
		reverse?: boolean;
	}): Promise<Buffer[]>;
	iterateWithSchema<T>(input: {
		start: Buffer;
		end: Buffer;
		limit?: number;
		reverse?: boolean;
	}): Promise<T[]>;
}

export interface SubStore extends ImmutableSubStore {
	del(key: Buffer): boolean;
	set(key: Buffer, value: Buffer): void;
	setWithSchema<T>(key: Buffer, value: T, schema: Schema): void;
}

export interface ImmutableAPIContext {
	getStore: (moduleID: number, storePrefix: number) => ImmutableSubStore;
	eventQueue: EventQueue;
}

export interface APIContext {
	getStore: (moduleID: number, storePrefix: number) => SubStore;
	eventQueue: EventQueue;
}

export enum VerifyStatus {
	FAIL = 0,
	OK = 1,
	PENDING = 2,
}

export interface BlockHeader {
	version: number;
	height: number;
	timestamp: number;
	previousBlockID: Buffer;
	generatorAddress: Buffer;
	getAsset: (moduleID: number) => Buffer;
}

export interface VerificationResult {
	status: VerifyStatus;
	error?: Error;
}
// eventQueue is not present here because event cannot be emitted
export interface TransactionVerifyContext {
	networkIdentifier: Buffer;
	logger: Logger;
	transaction: Transaction;
	getAPIContext: () => ImmutableAPIContext;
	getStore: (moduleID: number, storePrefix: number) => ImmutableSubStore;
}

export interface CommandVerifyContext<T> {
	logger: Logger;
	networkIdentifier: Buffer;
	transaction: Transaction; // without decoding params
	params: T;
	getAPIContext: () => ImmutableAPIContext;
	getStore: (moduleID: number, storePrefix: number) => ImmutableSubStore;
}

export interface CommandExecuteContext<T> {
	logger: Logger;
	networkIdentifier: Buffer;
	transaction: Transaction; // without decoding params
	params: T;
	getAPIContext: () => APIContext;
	getStore: (moduleID: number, storePrefix: number) => SubStore;
}

export interface GenesisBlockExecuteContext {
	logger: Logger;
	eventQueue: EventQueue;
	getAPIContext: () => APIContext;
	getStore: (moduleID: number, storePrefix: number) => SubStore;
	header: GenesisBlockHeader;
}

export interface TransactionExecuteContext {
	logger: Logger;
	networkIdentifier: Buffer;
	eventQueue: EventQueue;
	getAPIContext: () => APIContext;
	getStore: (moduleID: number, storePrefix: number) => SubStore;
	header: BlockHeader;
	transaction: Transaction;
}

export interface BlockVerifyContext {
	logger: Logger;
	networkIdentifier: Buffer;
	eventQueue: EventQueue;
	getAPIContext: () => ImmutableAPIContext;
	getStore: (moduleID: number, storePrefix: number) => ImmutableSubStore;
	header: BlockHeader;
}

export interface BlockExecuteContext {
	logger: Logger;
	networkIdentifier: Buffer;
	eventQueue: EventQueue;
	getAPIContext: () => APIContext;
	getStore: (moduleID: number, storePrefix: number) => SubStore;
	header: BlockHeader;
}

export interface BlockAfterExecuteContext extends BlockExecuteContext {
	transactions: ReadonlyArray<Transaction>;
}
