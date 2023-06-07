/*
 * Copyright © 2023 Lisk Foundation
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

import { MAX_DATA_LENGTH } from '../token/constants';
import {
	LENGTH_CHAIN_ID,
	LENGTH_NFT_ID,
	LENGTH_TOKEN_ID,
	MAX_LENGTH_MODULE_NAME,
	MIN_LENGTH_MODULE_NAME,
} from './constants';

export const transferParamsSchema = {
	$id: '/lisk/nftTransferParams',
	type: 'object',
	required: ['nftID', 'recipientAddress', 'data'],
	properties: {
		nftID: {
			dataType: 'bytes',
			minLength: LENGTH_NFT_ID,
			maxLength: LENGTH_NFT_ID,
			fieldNumber: 1,
		},
		recipientAddress: {
			dataType: 'bytes',
			format: 'lisk32',
			fieldNumber: 2,
		},
		data: {
			dataType: 'string',
			minLength: 0,
			maxLength: MAX_DATA_LENGTH,
			fieldNumber: 3,
		},
	},
};

export const crossChainNFTTransferMessageParamsSchema = {
	$id: '/lisk/crossChainNFTTransferMessageParamsSchmema',
	type: 'object',
	required: ['nftID', 'senderAddress', 'recipientAddress', 'attributesArray', 'data'],
	properties: {
		nftID: {
			dataType: 'bytes',
			minLength: LENGTH_NFT_ID,
			maxLength: LENGTH_NFT_ID,
			fieldNumber: 1,
		},
		senderAddress: {
			dataType: 'bytes',
			format: 'lisk32',
			fieldNumber: 2,
		},
		recipientAddress: {
			dataType: 'bytes',
			format: 'lisk32',
			fieldNumber: 3,
		},
		attributesArray: {
			type: 'array',
			fieldNumber: 4,
			items: {
				type: 'object',
				required: ['module', 'attributes'],
				properties: {
					module: {
						dataType: 'string',
						minLength: MIN_LENGTH_MODULE_NAME,
						maxLength: MAX_LENGTH_MODULE_NAME,
						pattern: '^[a-zA-Z0-9]*$',
						fieldNumber: 1,
					},
					attributes: {
						dataType: 'bytes',
						fieldNumber: 2,
					},
				},
			},
		},
		data: {
			dataType: 'string',
			maxLength: MAX_DATA_LENGTH,
			fieldNumber: 5,
		},
	},
};

export interface CCTransferMessageParams {
	nftID: Buffer;
	attributesArray: { module: string; attributes: Buffer }[];
	senderAddress: Buffer;
	recipientAddress: Buffer;
	data: string;
}

export const crossChainTransferParamsSchema = {
	$id: '/lisk/crossChainNFTTransferParamsSchema',
	type: 'object',
	required: [
		'nftID',
		'receivingChainID',
		'recipientAddress',
		'data',
		'messageFee',
		'messageFeeTokenID',
		'includeAttributes',
	],
	properties: {
		nftID: {
			dataType: 'bytes',
			minLength: LENGTH_NFT_ID,
			maxLength: LENGTH_NFT_ID,
			fieldNumber: 1,
		},
		receivingChainID: {
			dataType: 'bytes',
			minLength: LENGTH_CHAIN_ID,
			maxLength: LENGTH_CHAIN_ID,
			fieldNumber: 2,
		},
		recipientAddress: {
			dataType: 'bytes',
			format: 'lisk32',
			fieldNumber: 3,
		},
		data: {
			dataType: 'string',
			minLength: 0,
			maxLength: MAX_DATA_LENGTH,
			fieldNumber: 4,
		},
		messageFee: {
			dataType: 'uint64',
			fieldNumber: 5,
		},
		messageFeeTokenID: {
			dataType: 'bytes',
			minLength: LENGTH_TOKEN_ID,
			maxLength: LENGTH_TOKEN_ID,
			fieldNumber: 6,
		},
		includeAttributes: {
			dataType: 'boolean',
			fieldNumber: 7,
		},
	},
};
