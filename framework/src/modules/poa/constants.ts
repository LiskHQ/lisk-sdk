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

export enum UpdateAuthority {
	SUCCESS = 0,
	FAIL_INVALID_SIGNATURE,
}
export const MAX_LENGTH_NAME = 20;
export const LENGTH_BLS_KEY = 48;
export const LENGTH_PROOF_OF_POSSESSION = 96;
export const LENGTH_GENERATOR_KEY = 32;
export const NUM_BYTES_ADDRESS = 20;
export const MAX_NUM_VALIDATORS = 199;

export const MESSAGE_TAG_POA = 'LSK_POA_';

export const REGISTRATION_FEE = BigInt(1000000000); // TBA

export const EMPTY_BYTES = Buffer.alloc(0);

export const COMMAND_REGISTER_AUTHORITY = 'registerAuthority';
export const COMMAND_UPDATE_KEY = 'updateKey';
export const COMMAND_UPDATE_AUTHORITY = 'updateAuthority';