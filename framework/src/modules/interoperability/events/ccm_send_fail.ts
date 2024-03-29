/*
 * Copyright © 2022 Lisk Foundation
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
import { ccmSchema } from '../schemas';
import { CCMsg } from '../types';

export const enum CCMSentFailedCode {
	// if sending failed due to the receiving chain not being active.
	CHANNEL_UNAVAILABLE = 1,
	// if sending failed due to the fee payment failing.
	MESSAGE_FEE_EXCEPTION = 11,
	// if sending failed due to invalid params property.
	INVALID_PARAMS = 12,
	// if sending failed due to invalid message format.
	INVALID_FORMAT = 13,
	// if sending failed due to invalid receiving chain.
	INVALID_RECEIVING_CHAIN = 14,
}

export interface CcmSentFailedEventData {
	ccm: CCMsg;
	code: CCMSentFailedCode;
}

export const ccmSendFailDataSchema = {
	$id: '/interoperability/events/ccmSendFail',
	type: 'object',
	required: ['ccm', 'code'],
	properties: {
		ccm: {
			...ccmSchema,
			fieldNumber: 1,
		},
		code: {
			dataType: 'uint32',
			fieldNumber: 2,
		},
	},
};

export class CcmSentFailedEvent extends BaseEvent<CcmSentFailedEventData> {
	public schema = ccmSendFailDataSchema;

	public log(ctx: EventQueuer, data: CcmSentFailedEventData, noRevert: boolean): void {
		this.add(ctx, data, [], noRevert);
	}
}
