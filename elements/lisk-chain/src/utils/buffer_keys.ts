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

const dbKeyGlue = Buffer.from(':', 'utf8');
export const concatKeys = (...keys: Buffer[]) =>
	keys.reduce((a, b, index) => (index ? Buffer.concat([a, dbKeyGlue, b]) : b), Buffer.alloc(0));
