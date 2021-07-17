/*
 * Copyright © 2020 Lisk Foundation
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

export const DB_KEY_FORGER_USED_HASH_ONION = Buffer.from('forger:usedHashOnion', 'utf8');
export const DB_KEY_FORGER_REGISTERED_HASH_ONION_SEEDS = Buffer.from(
	'forger:registeredHashOnion',
	'utf8',
);
export const DB_KEY_FORGER_PREVIOUSLY_FORGED = Buffer.from('forger:previouslyForged', 'utf8');
