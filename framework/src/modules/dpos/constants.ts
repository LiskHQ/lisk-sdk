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

// State store related constants
export const CHAIN_STATE_DELEGATE_USERNAMES = Buffer.from('dpos:delegateUsernames', 'utf8');
export const CHAIN_STATE_DELEGATE_VOTE_WEIGHTS = Buffer.from('dpos:delegateVoteWeights', 'utf8');

export const TEN_UNIT = BigInt(10) * BigInt(10) ** BigInt(8);
export const MAX_VOTE = 10;
export const MAX_UNLOCKING = 20;
export const MAX_INT64 = '9223372036854775807';
export const AMOUNT_MULTIPLIER_FOR_VOTES = BigInt(10) * BigInt(10) ** BigInt(8);
export const WAIT_TIME_VOTE = 2000;
export const WAIT_TIME_SELF_VOTE = 260000;
export const VOTER_PUNISH_TIME = 260000;
export const SELF_VOTE_PUNISH_TIME = 780000;
export const MAX_PUNISHABLE_BLOCK_HEIGHT_DIFFERENCE = 260000;
export const MAX_POM_HEIGHTS = 5;
export const MAX_CONSECUTIVE_MISSED_BLOCKS = 50;
export const MAX_LAST_FORGED_HEIGHT_DIFF = 260000;

export const DEFAULT_ACTIVE_DELEGATE = 101;
export const DEFAULT_STANDBY_DELEGATE = 2;
export const DEFAULT_ROUND_OFFSET = 2;

// Vote weight is capped at the self-vote * DEFAULT_VOTE_WEIGHT_CAP_RATE
export const DEFAULT_VOTE_WEIGHT_CAP_RATE = 10;
export const DEFAULT_STANDBY_THRESHOLD = BigInt(1000) * BigInt(10) ** BigInt(8);

// Punishment period is 780k block height by default
export const PUNISHMENT_PERIOD = 780000;
