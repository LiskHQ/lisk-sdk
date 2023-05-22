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
import { BaseStore } from '../../base_store';

export interface ChainPropsObject {
	roundEndHeight: number;
	validatorsUpdateNonce: number;
}

export const chainPropsSchema = {
	$id: 'lisk/poa/validatorAddress',
	type: 'object',
	required: ['roundEndHeight', 'validatorsUpdateNonce'],
	properties: {
		roundEndHeight: {
			dataType: 'uint32',
			fieldNumber: 1,
		},
		validatorsUpdateNonce: {
			dataType: 'uint32',
			fieldNumber: 2,
		},
	},
};

export class SnapshotStore extends BaseStore<ChainPropsObject> {
	public schema = chainPropsSchema;
}
