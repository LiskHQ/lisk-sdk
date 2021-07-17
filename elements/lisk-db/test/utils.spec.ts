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

import { formatInt, getFirstPrefix, getLastPrefix } from '../src/utils';

describe('utils', () => {
	describe('formatInt', () => {
		describe('when bigint is provided', () => {
			it('should return buffer which can be sorted lexicographically', () => {
				const buf1 = formatInt(BigInt(100));
				const buf2 = formatInt(BigInt(10));
				const buf3 = formatInt(BigInt(11));
				const bufArray = [buf1, buf2, buf3];
				// eslint-disable-next-line @typescript-eslint/require-array-sort-compare
				bufArray.sort();
				expect(bufArray[0]).toEqual(Buffer.from('000000000000000a', 'hex'));
				expect(bufArray[1]).toEqual(Buffer.from('000000000000000b', 'hex'));
				expect(bufArray[2]).toEqual(Buffer.from('0000000000000064', 'hex'));
			});
		});

		describe('when number is provided', () => {
			it('should return buffer which can be sorted lexicographically', () => {
				const buf1 = formatInt(100);
				const buf2 = formatInt(10);
				const buf3 = formatInt(11);
				const bufArray = [buf1, buf2, buf3];
				// eslint-disable-next-line @typescript-eslint/require-array-sort-compare
				bufArray.sort();
				expect(bufArray[0]).toEqual(Buffer.from('0000000a', 'hex'));
				expect(bufArray[1]).toEqual(Buffer.from('0000000b', 'hex'));
				expect(bufArray[2]).toEqual(Buffer.from('00000064', 'hex'));
			});
		});
	});

	describe('getFirstPrefix', () => {
		it('should return buffer which is the next key for given prefix', () => {
			const prefix = Buffer.from('block:id:', 'utf8');
			const defaultKey = Buffer.from(
				'0000000000000000000000000000000000000000000000000000000000000000',
				'hex',
			);
			const startPrefix = getFirstPrefix(prefix);
			// start prefix should come before the expected value
			expect(Buffer.concat([prefix, defaultKey]).compare(startPrefix)).toEqual(1);
			// start prefix should come after the expected value
			expect(
				Buffer.concat([Buffer.from('block:ic', 'utf8'), defaultKey]).compare(startPrefix),
			).toEqual(-1);
		});
	});

	describe('getLastPrefix', () => {
		it('should return next buffer value for given prefix', () => {
			const prefix = Buffer.from('block:id:', 'utf8');
			const defaultKey = Buffer.from(
				'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
				'utf8',
			);
			const endPrefix = getLastPrefix(prefix);
			// end prefix should come after the expected value
			expect(Buffer.concat([prefix, defaultKey]).compare(endPrefix)).toEqual(-1);
			// end prefix should come before the expected value
			expect(
				Buffer.concat([Buffer.from('block:iz:', 'utf8'), defaultKey]).compare(endPrefix),
			).toEqual(1);
		});
	});
});
