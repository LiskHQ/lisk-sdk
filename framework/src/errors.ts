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

export class FrameworkError extends Error {
	public name: string;
	public code = 'ERR_FRAMEWORK';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public constructor(...args: any[]) {
		super(...args);
		this.name = this.constructor.name;
		Error.captureStackTrace(this, FrameworkError);
	}
}

export class NonceOutOfBoundsError extends FrameworkError {
	public code = 'ERR_NONCE_OUT_OF_BOUNDS';
	public actual: string;
	public expected: string;
	public constructor(message: string, actual: bigint, expected: bigint) {
		super(message);
		this.actual = actual.toString();
		this.expected = expected.toString();
	}
}

export class SchemaValidationError extends FrameworkError {
	public errors: Error[];
	public code = 'ERR_SCHEMA_VALIDATION';
	public constructor(errors: Error[]) {
		super(JSON.stringify(errors, null, 2));
		this.errors = errors;
	}
}

export class DuplicateAppInstanceError extends FrameworkError {
	public appLabel: string;
	public pidPath: string;
	public code = 'ERR_DUPLICATE_APP_INSTANCE';
	public constructor(appLabel: string, pidPath: string) {
		super(`Duplicate app instance for "${appLabel}"`);
		this.appLabel = appLabel;
		this.pidPath = pidPath;
	}
}

export class ImplementationMissingError extends FrameworkError {
	public code = 'ERR_IMPLEMENTATION_MISSING';
	public constructor(message = '') {
		super(message === '' ? 'Implementation missing error' : message);
	}
}

export class ValidationError extends FrameworkError {
	public code = 'ERR_VALIDATION';
	public value: string;
	public constructor(message: string, value: string) {
		super(message);
		this.value = value;
	}
}

export class TransactionApplyError extends Error {
	public id: Buffer;
	public transactionError: Error;
	public code = 'ERR_TRANSACTION_VERIFICATION_FAIL';

	public constructor(message: string, id: Buffer, transactionError: Error) {
		super(message);
		this.name = this.constructor.name;
		this.id = id;
		this.transactionError = transactionError;
	}
}

export class ApplyPenaltyError extends FrameworkError {
	public code = 'ERR_APPLY_PENALTY';
}
