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

export const formatInt = (num: number | bigint): Buffer => {
	let buf: Buffer;
	if (typeof num === 'bigint') {
		if (num < BigInt(0)) {
			throw new Error('Negative number cannot be formatted');
		}
		buf = Buffer.alloc(8);
		buf.writeBigUInt64BE(num);
	} else {
		if (num < 0) {
			throw new Error('Negative number cannot be formatted');
		}
		buf = Buffer.alloc(4);
		buf.writeUInt32BE(num, 0);
	}
	return buf;
};

export const getFirstPrefix = (prefix: Buffer): Buffer =>
	Buffer.concat([prefix, Buffer.from('00', 'hex')]);
export const getLastPrefix = (prefix: Buffer): Buffer =>
	Buffer.concat([prefix, Buffer.from('ff', 'hex')]);

export const isASCIIChar = (val: string): boolean => /^[\x21-\x7F]*$/.test(val);

export const smartConvert = (message: string, delimiter: string, format: string): string =>
	message
		.split(delimiter)
		.map(s => {
			if (isASCIIChar(s)) {
				return s;
			}
			return Buffer.from(s, 'binary').toString(format);
		})
		.join(delimiter);
