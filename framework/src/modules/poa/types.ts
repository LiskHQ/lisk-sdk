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

export interface RegisterAuthorityParams {
	name: string;
	blsKey: Buffer;
	generatorKey: Buffer;
	proofOfPossession: Buffer;
}

export interface UpdateGeneratorKeyParams {
	generatorKey: Buffer;
}

export interface UpdateAuthorityValidatorParams {
	newValidators: {
		address: Buffer;
		weight: bigint;
	}[];
	threshold: bigint;
	validatorsUpdateNonce: number;
	signature: Buffer;
	aggregationBits: Buffer;
}