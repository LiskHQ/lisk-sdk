/*
 * Copyright © 2021 Lisk Foundation
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
 *
 */

import { ErrorBLST, SecretKey } from '@chainsafe/blst';
import { isSecretKeyNonZeroModEC } from '../../src/bls_lib/lib';
import {
	blsAggregate,
	blsAggregateVerify,
	blsFastAggregateVerify,
	blsSign,
	blsSkToPk,
	blsVerify,
	blsPopProve,
	blsPopVerify,
} from '../../src/bls_lib';
import { getAllFiles, hexToBuffer, loadSpecFile } from '../helpers';

interface EthSignSpec {
	input: {
		privkey: string;
		message: string;
	};
	output: string | null;
}

interface EthVerifySpec {
	input: {
		pubkey: string;
		message: string;
		signature: string;
	};
	output: boolean;
}

interface EthAggrSpec {
	input: string[];
	output: string;
}

interface EthAggrVerifySpec {
	input: { pubkeys: string[]; messages: string[]; signature: string };
	output: boolean;
}

interface EthFastAggrVerifySpec {
	input: { pubkeys: string[]; message: string; signature: string };
	output: boolean;
}

describe('bls_lib', () => {
	const curveOrder = '0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001';

	describe('isSecretKeyNonZeroModEC', () => {
		it('should return true when given a valid secret key', () => {
			const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 1));
			expect(isSecretKeyNonZeroModEC(secretKey)).toBe(true);
		});

		it('should return true when given a non-zero modulo secret key', () => {
			const secretKey = SecretKey.fromBytes(
				Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex'),
			);
			expect(isSecretKeyNonZeroModEC(secretKey)).toBe(true);
		});

		it('should return false for a secret key that is a multiple of the order of the elliptic curve', () => {
			const secretKey = SecretKey.fromBytes(
				Buffer.from('73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001', 'hex'),
			);
			expect(isSecretKeyNonZeroModEC(secretKey)).toBe(false);
		});
	});

	describe('blsSkToPk', () => {
		describe.each(getAllFiles(['bls_specs/sk_to_pk']))('%s', ({ path }) => {
			it('should convert to valid pk', () => {
				const { input, output } = loadSpecFile<{ input: string; output: string }>(path);

				expect(blsSkToPk(hexToBuffer(input)).toString('hex')).toEqual(
					hexToBuffer(output).toString('hex'),
				);
			});
		});

		it('should return a non-empty buffer when given a valid input buffer', () => {
			const sk = Buffer.alloc(32, 1);
			const pk = blsSkToPk(sk);

			expect(pk).toBeDefined();
			expect(pk.length).toBeGreaterThan(0);
		});

		it('should throw an error when given an input buffer with value equal to the curve order', () => {
			const sk = Buffer.from(curveOrder.slice(2), 'hex');

			expect(() => blsSkToPk(sk)).toThrow('Secret key is not valid.');
		});

		it('should throw an error if the input buffer is zero', () => {
			const sk = Buffer.alloc(32, 0);
			expect(() => blsSkToPk(sk)).toThrow('ZERO_SECRET_KEY');
		});

		it('should throw an error if the input buffer is not 32 bytes long', () => {
			const sk = Buffer.alloc(31, 1);
			expect(() => blsSkToPk(sk)).toThrow(ErrorBLST);
		});
	});

	describe('blsSign', () => {
		describe.each(getAllFiles(['eth2_bls_specs/sign', 'bls_specs/sign'], /sign_case_zero_privkey/))(
			'%s',
			({ path }) => {
				const {
					input: { privkey, message },
					output,
				} = loadSpecFile<EthSignSpec>(path);

				if (privkey !== `0x${'00'.repeat(32)}`) {
					it('should generate valid signature if private key is non zero', () => {
						const signature = blsSign(hexToBuffer(privkey), hexToBuffer(message));
						expect(signature.toString('hex')).toEqual(hexToBuffer(output).toString('hex'));
					});
				} else {
					it('should throw an error if the private key is all zeros', () => {
						expect(() => blsSign(hexToBuffer(privkey), hexToBuffer(message))).toThrow(
							'ZERO_SECRET_KEY',
						);
					});
				}
			},
		);

		it('should throw an error when given an input buffer with value equal to the curve order', () => {
			const sk = Buffer.from(curveOrder.slice(2), 'hex');
			const message = Buffer.from('hello world');

			expect(() => blsSign(sk, message)).toThrow('Secret key is not valid.');
		});

		it('should throw an error when a secret key that is non-zero but zero modulo the group order', () => {
			// sk equals 2*r where r is order of the groups G1 and G2
			const sk = Buffer.from(
				'e7db4ea6533afa906673b0101343b00aa77b4805fffcb7fdfffffffe00000002',
				'hex',
			);
			const message = Buffer.from(
				'abababababababababababababababababababababababababababababababab',
				'hex',
			);

			expect(() => blsSign(sk, message)).toThrow('Secret key is not valid.');
		});
	});

	describe('blsVerify', () => {
		describe.each(getAllFiles(['eth2_bls_specs/verify', 'bls_specs/verify']))('%s', ({ path }) => {
			it('should verify signatures', () => {
				const {
					input: { pubkey, message, signature },
					output,
				} = loadSpecFile<EthVerifySpec>(path);

				const verify = blsVerify(hexToBuffer(pubkey), hexToBuffer(message), hexToBuffer(signature));

				expect(verify).toEqual(output);
			});
		});
	});

	describe('blsAggregate', () => {
		describe.each(getAllFiles(['eth2_bls_specs/aggregate', 'bls_specs/aggregate']))(
			'%s',
			({ path }) => {
				it('should aggregate signatures', () => {
					const { input, output } = loadSpecFile<EthAggrSpec>(path);

					const signature = blsAggregate(input.map(hexToBuffer));

					if (signature) {
						expect(signature.toString('hex')).toEqual(hexToBuffer(output).toString('hex'));
					} else {
						// In one of eth2 specs, they refer null as INVALID case
						const expectedOutput = output ?? false;
						expect(signature).toEqual(expectedOutput);
					}
				});
			},
		);
	});

	describe('blsAggregateVerify', () => {
		describe.each(getAllFiles(['eth2_bls_specs/aggregate_verify']))('%s', ({ path }) => {
			it('should verify messages', () => {
				const {
					input: { pubkeys, messages, signature },
					output,
				} = loadSpecFile<EthAggrVerifySpec>(path);

				const verify = blsAggregateVerify(
					pubkeys.map(hexToBuffer),
					messages.map(hexToBuffer),
					hexToBuffer(signature),
				);

				expect(verify).toEqual(output);
			});
		});
	});

	describe('blsFastAggregateVerify', () => {
		// The ignored test case "fast_aggregate_verify_infinity_pubkey" contains pk at infinity (identify point)
		// Since implementation standard https://tools.ietf.org/html/draft-irtf-cfrg-bls-signature-04#section-3.3.4
		// specifies to not validate public keys in "FastAggregateVerify"
		// so we why our implementation returns "true" and eth2 specs mentioned it as "false"
		describe.each(
			getAllFiles(
				['eth2_bls_specs/fast_aggregate_verify', 'bls_specs/fast_aggregate_verify'],
				/fast_aggregate_verify_infinity_pubkey/,
			),
		)('%s', ({ path }) => {
			it('should verify message', () => {
				const {
					input: { pubkeys, message, signature },
					output,
				} = loadSpecFile<EthFastAggrVerifySpec>(path);

				const verify = blsFastAggregateVerify(
					pubkeys.map(hexToBuffer),
					hexToBuffer(message),
					hexToBuffer(signature),
				);

				expect(verify).toEqual(output);
			});
		});
	});

	describe('blsPopProve', () => {
		describe.each(getAllFiles(['bls_specs/pop_prove']))('%s', ({ path }) => {
			it('should create valid proof of possession', () => {
				const { input, output } = loadSpecFile<{ input: string; output: string }>(path);

				expect(blsPopProve(hexToBuffer(input)).toString('hex')).toEqual(
					hexToBuffer(output).toString('hex'),
				);
			});
		});

		it('should throw an error when given an input buffer with value equal to the curve order', () => {
			const sk = Buffer.from(curveOrder.slice(2), 'hex');

			expect(() => {
				blsPopProve(sk);
			}).toThrow('Secret key is not valid.');
		});
	});

	describe('blsPopVerify', () => {
		describe.each(getAllFiles(['bls_specs/pop_verify']))('%s', ({ path }) => {
			it('should verify proof of possession', () => {
				const {
					input: { pk, proof },
					output,
				} = loadSpecFile<{ input: { pk: string; proof: string }; output: boolean }>(path);

				expect(blsPopVerify(hexToBuffer(pk), hexToBuffer(proof))).toEqual(output);
			});
		});
	});
});
