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

import { utils } from '@liskhq/lisk-cryptography';
import { objects } from '@liskhq/lisk-utils';
import { validator } from '@liskhq/lisk-validator';
import { BaseModule, ModuleInitArgs, ModuleMetadata } from '../base_module';
import { defaultConfig, MODULE_ID_FEE, TOKEN_ID_FEE } from './constants';
import { ModuleConfig, TokenAPI } from './types';
import {
	TransactionExecuteContext,
	TransactionVerifyContext,
	VerificationResult,
	VerifyStatus,
} from '../../state_machine';
import { FeeAPI } from './api';
import { FeeEndpoint } from './endpoint';
import { configSchema } from './schemas';

export class FeeModule extends BaseModule {
	public id = utils.intToBuffer(MODULE_ID_FEE, 4);
	public name = 'fee';
	public api = new FeeAPI(this.id);
	public configSchema = configSchema;
	public endpoint = new FeeEndpoint(this.id);
	private _tokenAPI!: TokenAPI;
	private _minFeePerByte!: number;
	private _tokenID!: Buffer;

	public addDependencies(tokenAPI: TokenAPI) {
		this._tokenAPI = tokenAPI;
	}

	public metadata(): ModuleMetadata {
		return {
			endpoints: [],
			commands: [],
			events: [],
			assets: [],
		};
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	public async init(args: ModuleInitArgs): Promise<void> {
		const { genesisConfig, moduleConfig } = args;
		const config = objects.mergeDeep({}, defaultConfig, moduleConfig);
		validator.validate<ModuleConfig>(configSchema, config);

		this._tokenID = Buffer.from(config.feeTokenID, 'hex');
		this._minFeePerByte = genesisConfig.minFeePerByte;
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	public async verifyTransaction(context: TransactionVerifyContext): Promise<VerificationResult> {
		const { getAPIContext, transaction } = context;
		const minFee = BigInt(this._minFeePerByte * transaction.getBytes().length);

		if (transaction.fee < minFee) {
			return {
				status: VerifyStatus.FAIL,
				error: new Error(`Insufficient transaction fee. Minimum required fee is ${minFee}.`),
			};
		}

		const balance = await this._tokenAPI.getAvailableBalance(
			getAPIContext(),
			transaction.senderAddress,
			TOKEN_ID_FEE,
		);
		if (transaction.fee > balance) {
			return {
				status: VerifyStatus.FAIL,
				error: new Error('Insufficient balance.'),
			};
		}

		return { status: VerifyStatus.OK };
	}

	public async beforeCommandExecute(context: TransactionExecuteContext): Promise<void> {
		const {
			header: { generatorAddress },
			transaction: { senderAddress },
		} = context;
		const minFee = BigInt(this._minFeePerByte * context.transaction.getBytes().length);
		const apiContext = context.getAPIContext();

		const isNative = await this._tokenAPI.isNative(apiContext, this._tokenID);
		if (isNative) {
			await this._tokenAPI.burn(apiContext, senderAddress, this._tokenID, minFee);
			await this._tokenAPI.transfer(
				apiContext,
				senderAddress,
				generatorAddress,
				this._tokenID,
				context.transaction.fee - minFee,
			);

			return;
		}

		await this._tokenAPI.transfer(
			apiContext,
			senderAddress,
			generatorAddress,
			this._tokenID,
			context.transaction.fee,
		);
	}
}
