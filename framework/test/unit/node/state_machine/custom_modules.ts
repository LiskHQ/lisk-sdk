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
/* eslint-disable max-classes-per-file */

export class CustomCommand0 {
	public id = 0;
	public name = 'customCommand0';
	public schema = {
		$id: 'lisk/custom-command-0',
		type: 'object',
		properties: {
			data: {
				dataType: 'string',
				fieldNumber: 1,
			},
		},
	};

	public verify = jest.fn().mockResolvedValue({ status: 1 });
	public execute = jest.fn();
}

export class CustomModule0 {
	public id = 3;
	public name = 'customModule0';
	public commands = [new CustomCommand0()];
	public api = {
		testing: jest.fn(),
	};

	public verifyBlock = jest.fn();
	public afterGenesisBlockExecute = jest.fn();
	public beforeBlockExecute = jest.fn();
	public afterBlockExecute = jest.fn();
	public verifyTransaction = jest.fn().mockResolvedValue({ status: 1 });
	public beforeTransactionExecute = jest.fn();
	public afterTransactionExecute = jest.fn();
}

export class CustomModule1 {
	public id = 4;
	public name = 'customModule1';
	public commands = [];

	public verifyBlock = jest.fn();
	public beforeBlockExecute = jest.fn();
	public afterTransactionExecute = jest.fn();
}

export class CustomModule2 {
	public id = 5;
	public name = 'customModule2';
	public commands = [];

	public verifyTransaction = jest.fn().mockResolvedValue({ status: 0 });
}
