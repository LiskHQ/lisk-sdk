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
import { HASH_LENGTH } from '../constants';

export interface InvalidOutboxRootVerificationData {
	inboxRoot: Buffer;
	partnerChainOutboxRoot: Buffer;
}

export const invalidOutboxRootVerificationSchema = {
	$id: '/interoperability/events/invalidOutboxRootVerification',
	type: 'object',
	required: ['inboxRoot', 'partnerChainOutboxRoot'],
	properties: {
		inboxRoot: {
			dataType: 'bytes',
			fieldNumber: 1,
			minLength: HASH_LENGTH,
			maxLength: HASH_LENGTH,
		},
		partnerChainOutboxRoot: {
			dataType: 'bytes',
			fieldNumber: 2,
			minLength: HASH_LENGTH,
			maxLength: HASH_LENGTH,
		},
	},
};

export class InvalidOutboxRootVerificationEvent extends BaseEvent<InvalidOutboxRootVerificationData> {
	public schema = invalidOutboxRootVerificationSchema;

	public error(ctx: EventQueuer, chainID: Buffer, data: InvalidOutboxRootVerificationData): void {
		this.add(ctx, data, [chainID], true);
	}
}
