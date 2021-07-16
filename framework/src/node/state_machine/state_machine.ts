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

import { Schema } from '@liskhq/lisk-codec';
import { BlockContext } from './block_context';
import { GenesisBlockContext } from './genesis_block_context';
import { TransactionContext } from './transaction_context';
import {
	BlockExecuteContext,
	GenesisBlockExecuteContext,
	TransactionVerifyContext,
	TransactionExecuteContext,
	VerifyStatus,
	BlockVerifyContext,
	VerificationResult,
	CommandVerifyContext,
	CommandExecuteContext,
} from './types';

export interface StateMachineCommand {
	id: number;
	schema: Schema;
	verify?: <T = unknown>(ctx: CommandVerifyContext<T>) => Promise<VerificationResult>;
	execute: <T = unknown>(ctx: CommandExecuteContext<T>) => Promise<void>;
}

export interface StateMachineModule {
	id: number;
	commands: StateMachineCommand[];
	verifyTransaction?: (ctx: TransactionVerifyContext) => Promise<VerificationResult>;
	afterGenesisBlockExecute?: (ctx: GenesisBlockExecuteContext) => Promise<void>;
	verifyBlock?: (ctx: BlockVerifyContext) => Promise<void>;
	beforeBlockExecute?: (ctx: BlockExecuteContext) => Promise<void>;
	afterBlockExecute?: (ctx: BlockExecuteContext) => Promise<void>;
	beforeTransactionExecute?: (ctx: TransactionExecuteContext) => Promise<void>;
	afterTransactionExecute?: (ctx: TransactionExecuteContext) => Promise<void>;
}

export class StateMachine {
	private readonly _modules: StateMachineModule[] = [];
	private readonly _systemModules: StateMachineModule[] = [];

	public registerModule(mod: StateMachineModule): void {
		this._validateExistingModuleID(mod.id);
		this._modules.push(mod);
	}

	public registerSystemModule(mod: StateMachineModule): void {
		this._validateExistingModuleID(mod.id);
		this._systemModules.push(mod);
	}

	public async executeGenesisBlock(ctx: GenesisBlockContext): Promise<void> {
		const blockContext = ctx.createGenesisBlockExecuteContext();
		for (const mod of this._systemModules) {
			if (mod.afterGenesisBlockExecute) {
				await mod.afterGenesisBlockExecute(blockContext);
			}
		}
		for (const mod of this._modules) {
			if (mod.afterGenesisBlockExecute) {
				await mod.afterGenesisBlockExecute(blockContext);
			}
		}
	}

	public async verifyTransaction(ctx: TransactionContext): Promise<VerificationResult> {
		const transactionContext = ctx.createTransactionVerifyContext();
		try {
			for (const mod of this._systemModules) {
				if (mod.verifyTransaction) {
					const result = await mod.verifyTransaction(transactionContext);
					if (result.status !== VerifyStatus.OK) {
						return result;
					}
				}
			}
			for (const mod of this._modules) {
				if (mod.verifyTransaction) {
					const result = await mod.verifyTransaction(transactionContext);
					if (result.status !== VerifyStatus.OK) {
						return result;
					}
				}
			}
			const targetModule = this._findModule(ctx.transaction.moduleID);
			if (!targetModule) {
				throw new Error(`Module with ID ${ctx.transaction.moduleID} is not registered.`);
			}
			// FIXME: Update assetID to commandID
			const command = targetModule.commands.find(c => c.id === ctx.transaction.assetID);
			if (!command) {
				throw new Error(
					`Module with ID ${ctx.transaction.moduleID} does not have command with ID ${ctx.transaction.assetID} registered.`,
				);
			}
			const commandContext = ctx.createCommandVerifyContext(command.schema);
			if (command.verify) {
				const result = await command.verify(commandContext);
				if (result.status !== VerifyStatus.OK) {
					return result;
				}
			}
			return { status: VerifyStatus.OK };
		} catch (error) {
			return { status: VerifyStatus.FAIL };
		}
	}

	public async executeTransaction(ctx: TransactionContext): Promise<void> {
		const transactionContext = ctx.createTransactionExecuteContext();
		for (const mod of this._systemModules) {
			if (mod.beforeTransactionExecute) {
				await mod.beforeTransactionExecute(transactionContext);
			}
		}
		for (const mod of this._modules) {
			if (mod.beforeTransactionExecute) {
				await mod.beforeTransactionExecute(transactionContext);
			}
		}
		const targetModule = this._findModule(ctx.transaction.moduleID);
		if (!targetModule) {
			throw new Error(`Module with ID ${ctx.transaction.moduleID} is not registered.`);
		}
		// FIXME: Update assetID to commandID
		const command = targetModule.commands.find(c => c.id === ctx.transaction.assetID);
		if (!command) {
			throw new Error(
				`Module with ID ${ctx.transaction.moduleID} does not have command with ID ${ctx.transaction.assetID} registered.`,
			);
		}
		// Execute command
		const commandContext = ctx.createCommandExecuteContext(command.schema);
		await command.execute(commandContext);

		// Execute after transaction hooks
		for (const mod of this._modules) {
			if (mod.afterTransactionExecute) {
				await mod.afterTransactionExecute(transactionContext);
			}
		}
		for (const mod of this._systemModules) {
			if (mod.afterTransactionExecute) {
				await mod.afterTransactionExecute(transactionContext);
			}
		}
	}

	public async verifyBlock(ctx: BlockContext): Promise<void> {
		const blockVerifyContext = ctx.getBlockVerifyExecuteContext();
		for (const mod of this._systemModules) {
			if (mod.verifyBlock) {
				await mod.verifyBlock(blockVerifyContext);
			}
		}
		for (const mod of this._modules) {
			if (mod.verifyBlock) {
				await mod.verifyBlock(blockVerifyContext);
			}
		}
	}

	public async beforeExecuteBlock(ctx: BlockContext): Promise<void> {
		const blockExecuteContext = ctx.getBlockExecuteContext();
		for (const mod of this._systemModules) {
			if (mod.beforeBlockExecute) {
				await mod.beforeBlockExecute(blockExecuteContext);
			}
		}
		for (const mod of this._modules) {
			if (mod.beforeBlockExecute) {
				await mod.beforeBlockExecute(blockExecuteContext);
			}
		}
	}

	public async afterExecuteBlock(ctx: BlockContext): Promise<void> {
		const blockExecuteContext = ctx.getBlockAfterExecuteContext();
		for (const mod of this._modules) {
			if (mod.afterBlockExecute) {
				await mod.afterBlockExecute(blockExecuteContext);
			}
		}
		for (const mod of this._systemModules) {
			if (mod.afterBlockExecute) {
				await mod.afterBlockExecute(blockExecuteContext);
			}
		}
	}

	public async executeBlock(ctx: BlockContext): Promise<void> {
		await this.beforeExecuteBlock(ctx);
		for (const tx of ctx.transactions) {
			const txContext = ctx.getTransactionContext(tx);
			const verifyResult = await this.verifyTransaction(txContext);
			if (verifyResult.status !== VerifyStatus.OK) {
				if (verifyResult.error) {
					throw verifyResult.error;
				}
				throw new Error(`Invalid transaction. ID ${tx.id.toString('hex')}`);
			}
			await this.executeTransaction(txContext);
		}
		await this.afterExecuteBlock(ctx);
	}

	private _findModule(id: number): StateMachineModule | undefined {
		const existingModule = this._modules.find(m => m.id === id);
		if (existingModule) {
			return existingModule;
		}
		const existingSystemModule = this._systemModules.find(m => m.id === id);
		if (existingSystemModule) {
			return existingSystemModule;
		}
		return undefined;
	}

	private _validateExistingModuleID(id: number): void {
		const existingModule = this._modules.find(m => m.id === id);
		if (existingModule) {
			throw new Error(`Module ID ${id} is already registered.`);
		}
		const existingSystemModule = this._systemModules.find(m => m.id === id);
		if (existingSystemModule) {
			throw new Error(`Module ID ${id} is already registered as a sytem module.`);
		}
	}
}
