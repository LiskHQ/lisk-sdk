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

import { Schema } from '@liskhq/lisk-codec';
import { objects } from '@liskhq/lisk-utils';

export const blockSchema = {
	$id: '/block',
	type: 'object',
	properties: {
		header: {
			dataType: 'bytes',
			fieldNumber: 1,
		},
		payload: {
			type: 'array',
			items: {
				dataType: 'bytes',
			},
			fieldNumber: 2,
		},
	},
	required: ['header', 'payload'],
};

export const signingBlockHeaderSchema = {
	$id: '/block/header/signing',
	type: 'object',
	properties: {
		version: { dataType: 'uint32', fieldNumber: 1 },
		timestamp: { dataType: 'uint32', fieldNumber: 2 },
		height: { dataType: 'uint32', fieldNumber: 3 },
		previousBlockID: { dataType: 'bytes', fieldNumber: 4 },
		transactionRoot: { dataType: 'bytes', fieldNumber: 5 },
		generatorPublicKey: { dataType: 'bytes', fieldNumber: 6 },
		reward: { dataType: 'uint64', fieldNumber: 7 },
		asset: { dataType: 'bytes', fieldNumber: 8 },
	},
	required: [
		'version',
		'timestamp',
		'height',
		'previousBlockID',
		'transactionRoot',
		'generatorPublicKey',
		'reward',
		'asset',
	],
};

export const blockHeaderSchema = {
	...signingBlockHeaderSchema,
	$id: '/block/header',
	properties: {
		...signingBlockHeaderSchema.properties,
		signature: { dataType: 'bytes', fieldNumber: 9 },
	},
};

export const baseGenesisBlockHeaderAssetSchema = {
	$id: '/genesisBlock/header/asset',
	type: 'object',
	required: ['accounts', 'initDelegates', 'initRounds'],
	properties: {
		accounts: {
			type: 'array',
			fieldNumber: 1,
		},
		initDelegates: {
			type: 'array',
			items: {
				dataType: 'bytes',
			},
			fieldNumber: 2,
			minItems: 1,
		},
		initRounds: {
			dataType: 'uint32',
			fieldNumber: 3,
			minimum: 3,
		},
	},
};

export const baseAccountSchema = {
	$id: '/account/base',
	type: 'object',
	properties: {
		address: { dataType: 'bytes', fieldNumber: 1 },
	},
	required: ['address'],
};

export const blockHeaderAssetSchema = {
	$id: '/blockHeader/asset/v2',
	type: 'object',
	properties: {
		maxHeightPreviouslyForged: {
			dataType: 'uint32',
			fieldNumber: 1,
		},
		maxHeightPrevoted: {
			dataType: 'uint32',
			fieldNumber: 2,
		},
		seedReveal: {
			dataType: 'bytes',
			minLength: 16,
			maxLength: 16,
			fieldNumber: 3,
		},
	},
	required: ['maxHeightPreviouslyForged', 'maxHeightPrevoted', 'seedReveal'],
};

export const stateDiffSchema = {
	$id: '/state/diff',
	type: 'object',
	required: ['updated', 'created'],
	properties: {
		updated: {
			type: 'array',
			fieldNumber: 1,
			items: {
				type: 'object',
				properties: {
					key: {
						dataType: 'bytes',
						fieldNumber: 1,
					},
					value: {
						dataType: 'bytes',
						fieldNumber: 2,
					},
				},
			},
		},
		created: {
			type: 'array',
			fieldNumber: 2,
			items: {
				dataType: 'bytes',
			},
		},
		deleted: {
			type: 'array',
			fieldNumber: 3,
			items: {
				type: 'object',
				properties: {
					key: {
						dataType: 'bytes',
						fieldNumber: 1,
					},
					value: {
						dataType: 'bytes',
						fieldNumber: 2,
					},
				},
			},
		},
	},
};

export const validatorsSchema = {
	$id: '/state/validators',
	type: 'object',
	required: ['validators'],
	properties: {
		validators: {
			type: 'array',
			fieldNumber: 1,
			items: {
				type: 'object',
				properties: {
					address: {
						dataType: 'bytes',
						fieldNumber: 1,
					},
					minActiveHeight: {
						dataType: 'uint32',
						fieldNumber: 2,
					},
					isConsensusParticipant: {
						dataType: 'boolean',
						fieldNumber: 3,
					},
				},
				required: ['address', 'minActiveHeight', 'isConsensusParticipant'],
			},
		},
	},
};

export const getGenesisBlockHeaderAssetSchema = (accountSchema: Schema): Schema =>
	objects.mergeDeep({}, baseGenesisBlockHeaderAssetSchema, {
		properties: {
			accounts: {
				items: {
					...accountSchema,
				},
			},
		},
	}) as Schema;

export const getRegisteredBlockAssetSchema = (
	accountSchema: Schema,
): {
	readonly [key: number]: Schema;
} => ({
	0: getGenesisBlockHeaderAssetSchema(accountSchema),
	2: blockHeaderAssetSchema,
});
