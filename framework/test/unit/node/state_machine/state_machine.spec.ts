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
import { GenesisBlockHeader, Transaction } from '@liskhq/lisk-chain';
import { Logger } from '../../../../src/logger';
import { BlockContext } from '../../../../src/node/state_machine/block_context';
import { EventQueue } from '../../../../src/node/state_machine/event_queue';
import { GenesisBlockContext } from '../../../../src/node/state_machine/genesis_block_context';
import { StateMachine } from '../../../../src/node/state_machine/state_machine';
import { TransactionContext } from '../../../../src/node/state_machine/transaction_context';
import { StateStore, BlockHeader, VerifyStatus } from '../../../../src/node/state_machine/types';
import { CustomModule0, CustomModule1, CustomModule2 } from './custom_modules';

describe('state_machine', () => {
	const genesisHeader = {} as GenesisBlockHeader;
	const header = {} as BlockHeader;
	const logger = {} as Logger;
	const stateStore = {} as StateStore;
	const eventQueue = new EventQueue();
	const networkIdentifier = Buffer.from('network identifier', 'utf8');
	const transaction = {
		moduleID: 3,
		assetID: 0,
		asset: {},
	} as Transaction;

	let stateMachine: StateMachine;
	let mod: CustomModule0;
	let systemMod: CustomModule1;

	beforeEach(() => {
		stateMachine = new StateMachine();
		mod = new CustomModule0();
		systemMod = new CustomModule1();
		stateMachine.registerModule(mod);
		stateMachine.registerSystemModule(systemMod);
	});

	describe('executeGenesisBlock', () => {
		it('should call all registered executeGenesisBlock', async () => {
			const ctx = new GenesisBlockContext({
				eventQueue,
				header: genesisHeader,
				logger,
				stateStore,
			});
			await stateMachine.executeGenesisBlock(ctx);
			expect(mod.afterGenesisBlockExecute).toHaveBeenCalledTimes(1);
			expect(mod.afterGenesisBlockExecute).toHaveBeenCalledWith({
				logger,
				eventQueue,
				getAPIContext: expect.any(Function),
				getStore: expect.any(Function),
				header: genesisHeader,
			});
		});
	});

	describe('verifyTransaction', () => {
		it('should call all registered verifyTransaction and verify of the command', async () => {
			const ctx = new TransactionContext({
				eventQueue,
				logger,
				stateStore,
				header,
				networkIdentifier,
				transaction,
			});
			const result = await stateMachine.verifyTransaction(ctx);
			expect(mod.verifyTransaction).toHaveBeenCalledWith({
				networkIdentifier,
				logger,
				transaction,
				getAPIContext: expect.any(Function),
				getStore: expect.any(Function),
			});
			expect(mod.commands[0].verify).toHaveBeenCalledTimes(1);
			expect(result.status).toBe(VerifyStatus.OK);
		});

		it('should fail if one of the verify fails', async () => {
			const ctx = new TransactionContext({
				eventQueue,
				logger,
				stateStore,
				header,
				networkIdentifier,
				transaction,
			});
			stateMachine.registerModule(new CustomModule2());
			const result = await stateMachine.verifyTransaction(ctx);
			expect(result.status).toBe(VerifyStatus.FAIL);
		});
	});

	describe('executeTransaction', () => {
		it('should call all registered execute hooks', async () => {
			const ctx = new TransactionContext({
				eventQueue,
				logger,
				stateStore,
				header,
				networkIdentifier,
				transaction,
			});
			await stateMachine.executeTransaction(ctx);
			expect(mod.beforeTransactionExecute).toHaveBeenCalledWith({
				networkIdentifier,
				logger,
				transaction,
				header,
				eventQueue,
				getAPIContext: expect.any(Function),
				getStore: expect.any(Function),
			});
			expect(systemMod.afterTransactionExecute).toHaveBeenCalledTimes(1);
			expect(mod.afterTransactionExecute).toHaveBeenCalledTimes(1);
		});
	});

	describe('verifyBlock', () => {
		it('should call all registered verifyBlock', async () => {
			const ctx = new BlockContext({
				eventQueue,
				logger,
				stateStore,
				header,
				networkIdentifier,
				transactions: [transaction],
			});
			await stateMachine.verifyBlock(ctx);
			expect(mod.verifyBlock).toHaveBeenCalledWith({
				networkIdentifier,
				logger,
				header,
				eventQueue,
				getAPIContext: expect.any(Function),
				getStore: expect.any(Function),
			});
			expect(systemMod.verifyBlock).toHaveBeenCalledTimes(1);
			expect(mod.verifyBlock).toHaveBeenCalledTimes(1);
		});
	});

	describe('beforeExecuteBlock', () => {
		it('should call all registered executeGenesisBlock', async () => {
			const ctx = new BlockContext({
				eventQueue,
				logger,
				stateStore,
				header,
				networkIdentifier,
				transactions: [transaction],
			});
			await stateMachine.beforeExecuteBlock(ctx);
			expect(mod.beforeBlockExecute).toHaveBeenCalledWith({
				networkIdentifier,
				logger,
				header,
				eventQueue,
				getAPIContext: expect.any(Function),
				getStore: expect.any(Function),
			});
			expect(systemMod.beforeBlockExecute).toHaveBeenCalledTimes(1);
			expect(mod.beforeBlockExecute).toHaveBeenCalledTimes(1);
		});
	});

	describe('afterExecuteBlock', () => {
		it('should call all registered executeGenesisBlock', async () => {
			const ctx = new BlockContext({
				eventQueue,
				logger,
				stateStore,
				header,
				networkIdentifier,
				transactions: [transaction],
			});
			await stateMachine.afterExecuteBlock(ctx);
			expect(mod.afterBlockExecute).toHaveBeenCalledWith({
				networkIdentifier,
				logger,
				header,
				eventQueue,
				getAPIContext: expect.any(Function),
				getStore: expect.any(Function),
				transactions: [transaction],
			});
			expect(mod.afterBlockExecute).toHaveBeenCalledTimes(1);
		});
	});

	describe('executeBlock', () => {
		it('should call all registered executeGenesisBlock', async () => {
			const ctx = new BlockContext({
				eventQueue,
				logger,
				stateStore,
				header,
				networkIdentifier,
				transactions: [transaction],
			});
			await stateMachine.executeBlock(ctx);
			expect(mod.beforeBlockExecute).toHaveBeenCalledWith({
				networkIdentifier,
				logger,
				header,
				eventQueue,
				getAPIContext: expect.any(Function),
				getStore: expect.any(Function),
			});
			expect(systemMod.beforeBlockExecute).toHaveBeenCalledTimes(1);
			expect(mod.beforeBlockExecute).toHaveBeenCalledTimes(1);
			expect(mod.afterBlockExecute).toHaveBeenCalledWith({
				networkIdentifier,
				logger,
				header,
				eventQueue,
				getAPIContext: expect.any(Function),
				getStore: expect.any(Function),
				transactions: [transaction],
			});
			expect(mod.afterBlockExecute).toHaveBeenCalledTimes(1);
		});
	});
});
