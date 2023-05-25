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

import { BaseEvent, EventQueuer } from '../../base_event';
import { LENGTH_NFT_ID, NftEventResult } from '../constants';

export interface DestroyEventData {
	address: Buffer;
	nftID: Buffer;
}

export const createEventSchema = {
	$id: '/nft/events/destroy',
	type: 'object',
	required: ['address', 'nftID', 'result'],
	properties: {
		address: {
			dataType: 'bytes',
			format: 'lisk32',
			fieldNumber: 1,
		},
		nftID: {
			dataType: 'bytes',
			minLength: LENGTH_NFT_ID,
			maxLenght: LENGTH_NFT_ID,
			fieldNumber: 2,
		},
		result: {
			dataType: 'uint32',
			fieldNumber: 3,
		},
	},
};

export class DestroyEvent extends BaseEvent<DestroyEventData & { result: NftEventResult }> {
	public schema = createEventSchema;

	public log(ctx: EventQueuer, data: DestroyEventData): void {
		this.add(ctx, { ...data, result: NftEventResult.SUCCESSFUL }, [data.address, data.nftID]);
	}
}