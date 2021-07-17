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

export const DB_KEY_BLOCKS_ID = Buffer.from('blocks:id', 'utf8');
export const DB_KEY_BLOCKS_HEIGHT = Buffer.from('blocks:height', 'utf8');
export const DB_KEY_TRANSACTIONS_BLOCK_ID = Buffer.from('transactions:blockID', 'utf8');
export const DB_KEY_TRANSACTIONS_ID = Buffer.from('transactions:id', 'utf8');
export const DB_KEY_TEMPBLOCKS_HEIGHT = Buffer.from('tempBlocks:height', 'utf8');
export const DB_KEY_ACCOUNTS_ADDRESS = Buffer.from('accounts:address', 'utf8');
export const DB_KEY_CHAIN_STATE = Buffer.from('chain', 'utf8');
export const DB_KEY_CONSENSUS_STATE = Buffer.from('consensus', 'utf8');
export const DB_KEY_DIFF_STATE = Buffer.from('diff', 'utf8');
