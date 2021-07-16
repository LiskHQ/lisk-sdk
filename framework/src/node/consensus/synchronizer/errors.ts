/*
 * Copyright © 2019 Lisk Foundation
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
/* eslint-disable max-classes-per-file */

import { FrameworkError } from '../../../errors';

export class SynchronizerError extends FrameworkError {}

export class BlockProcessingError extends SynchronizerError {}

export class RestartError extends SynchronizerError {
	public reason: string;
	public constructor(reason: string) {
		super(`Restart synchronization mechanism with reason: ${reason}`);
		this.reason = reason;
	}
}

export class AbortError extends SynchronizerError {
	public reason: string;
	public constructor(reason: string) {
		super(`Abort synchronization mechanism with reason: ${reason}`);
		this.reason = reason;
	}
}

export class ApplyPenaltyAndRestartError extends SynchronizerError {
	public reason: string;
	public peerId: string;

	public constructor(peerId: string, reason: string) {
		super(`Apply penalty and restart synchronization mechanism with reason: ${reason}`);
		this.reason = reason;
		this.peerId = peerId;
	}
}

export class ApplyPenaltyAndAbortError extends SynchronizerError {
	public reason: string;
	public peerId: string;

	public constructor(peerId: string, reason: string) {
		super(`Apply penalty and abort synchronization mechanism with reason: ${reason}`);
		this.reason = reason;
		this.peerId = peerId;
	}
}
