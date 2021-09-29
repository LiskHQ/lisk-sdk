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

export interface AuthData {
	nonce: bigint;
	numberOfSignatures: number;
	mandatoryKeys: ReadonlyArray<Buffer>;
	optionalKeys: ReadonlyArray<Buffer>;
}

export const authAccountSchema = {
	$id: '/auth/account',
	type: 'object',
	properties: {
		nonce: {
			dataType: 'uint64',
			fieldNumber: 1,
		},
		numberOfSignatures: {
			dataType: 'uint32',
			fieldNumber: 2,
		},
		mandatoryKeys: {
			type: 'array',
			items: {
				dataType: 'bytes',
			},
			fieldNumber: 3,
		},
		optionalKeys: {
			type: 'array',
			items: {
				dataType: 'bytes',
			},
			fieldNumber: 4,
		},
	},
	required: ['nonce', 'numberOfSignatures', 'mandatoryKeys', 'optionalKeys'],
};

export const registerMultisignatureParamsSchema = {
	$id: '/auth/command/regMultisig',
	type: 'object',
	properties: {
		numberOfSignatures: {
			dataType: 'uint32',
			fieldNumber: 1,
			minimum: 1,
			maximum: 64,
		},
		mandatoryKeys: {
			type: 'array',
			items: {
				dataType: 'bytes',
				minLength: 32,
				maxLength: 32,
			},
			fieldNumber: 2,
			minItems: 0,
			maxItems: 64,
		},
		optionalKeys: {
			type: 'array',
			items: {
				dataType: 'bytes',
				minLength: 32,
				maxLength: 32,
			},
			fieldNumber: 3,
			minItems: 0,
			maxItems: 64,
		},
	},
	required: ['numberOfSignatures', 'mandatoryKeys', 'optionalKeys'],
};

export const configSchema = {
	$id: '/auth/config',
	type: 'object',
	properties: {},
};