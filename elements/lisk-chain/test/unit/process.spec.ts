/* eslint-disable jest/no-try-expect */
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

import { KVStore } from '@liskhq/lisk-db';
import { getRandomBytes, getAddressFromPublicKey, hash } from '@liskhq/lisk-cryptography';
import { when } from 'jest-when';
import { codec } from '@liskhq/lisk-codec';
import { objects } from '@liskhq/lisk-utils';
import { LiskValidationError } from '@liskhq/lisk-validator';
import {
	createValidDefaultBlock,
	defaultNetworkIdentifier,
	genesisBlock,
	registeredBlockHeaders,
} from '../utils/block';
import { Chain } from '../../src/chain';
import { StateStore } from '../../src/state_store';
import { DataAccess } from '../../src/data_access';
import { defaultAccountModules, defaultAccountSchema, defaultAccount } from '../utils/account';
import { Block, BlockHeader, GenesisBlock, Validator } from '../../src/types';
import { getTransaction } from '../utils/transaction';
import { validatorsSchema } from '../../src/schema';
import { createStateStore } from '../utils/state_store';
import { CONSENSUS_STATE_VALIDATORS_KEY } from '../../src/constants';
import { Transaction } from '../../src';

jest.mock('events');
jest.mock('@liskhq/lisk-db');

describe('chain/process block', () => {
	const constants = {
		maxPayloadLength: 15 * 1024,
		activeDelegates: 101,
		rewardDistance: 3000000,
		rewardOffset: 2160,
		rewardMilestones: [
			BigInt(500000000), // Initial Reward
			BigInt(400000000), // Milestone 1
			BigInt(300000000), // Milestone 2
			BigInt(200000000), // Milestone 3
			BigInt(100000000), // Milestone 4
		],
		totalAmount: BigInt('10000000000000000'),
		blockTime: 10,
		minFeePerByte: 1000,
		baseFees: [
			{
				moduleID: 2,
				assetID: 1,
				baseFee: '100000000',
			},
		],
	};

	let chainInstance: Chain;
	let db: any;
	let block: Block;

	beforeEach(async () => {
		db = new KVStore('temp');
		chainInstance = new Chain({
			db,
			genesisBlock,
			networkIdentifier: defaultNetworkIdentifier,
			accountSchemas: defaultAccountModules,
			...constants,
		});
		(chainInstance as any)._lastBlock = genesisBlock;

		block = await createValidDefaultBlock();
	});

	describe('#validateTransaction', () => {
		let transaction: Transaction;
		it('should not throw error if fee is equal or higher or equal to min fee where base fee does not exist', () => {
			// size of this transaction is 613
			transaction = new Transaction({
				moduleID: 2,
				assetID: 0,
				fee: BigInt(613000),
				asset: getRandomBytes(500),
				nonce: BigInt(2),
				senderPublicKey: getRandomBytes(32),
				signatures: [getRandomBytes(64)],
			});
			expect(() => chainInstance.validateTransaction(transaction)).not.toThrow();
		});

		it('should not throw error if transaction asset does have a baseFee entry and transaction fee is higher or equal to min fee', () => {
			// size of this transaction is 614
			transaction = new Transaction({
				moduleID: 2,
				assetID: 1,
				fee: BigInt(100614000),
				asset: getRandomBytes(500),
				nonce: BigInt(2),
				senderPublicKey: getRandomBytes(32),
				signatures: [getRandomBytes(64)],
			});

			expect(() => chainInstance.validateTransaction(transaction)).not.toThrow();
		});

		it('should throw error if fee is lower than minimum required fee and base fee does not exist', () => {
			// size of this transaction is 613
			transaction = new Transaction({
				moduleID: 2,
				assetID: 0,
				fee: BigInt(612999),
				asset: getRandomBytes(500),
				nonce: BigInt(2),
				senderPublicKey: getRandomBytes(32),
				signatures: [getRandomBytes(64)],
			});
			expect(() => chainInstance.validateTransaction(transaction)).toThrow(
				'Insufficient transaction fee. Minimum required fee is: 613000',
			);
		});

		it('should throw error if fee is lower than minimum required fee when base fee exists', () => {
			// size of this transaction is 614
			transaction = new Transaction({
				moduleID: 2,
				assetID: 1,
				fee: BigInt(614000),
				asset: getRandomBytes(500),
				nonce: BigInt(2),
				senderPublicKey: getRandomBytes(32),
				signatures: [getRandomBytes(64)],
			});
			expect(() => chainInstance.validateTransaction(transaction)).toThrow(
				'Insufficient transaction fee. Minimum required fee is: 100613000',
			);
		});

		it('should throw when moduleID is below 2', () => {
			transaction = new Transaction({
				moduleID: 1,
				assetID: 0,
				fee: BigInt(613000),
				asset: getRandomBytes(500),
				nonce: BigInt(2),
				senderPublicKey: getRandomBytes(32),
				signatures: [getRandomBytes(64)],
			});
			expect(() => chainInstance.validateTransaction(transaction)).toThrow(
				'Lisk validator found 1 error[s]',
			);
		});

		it('should throw when sender public key is not 32 bytes', () => {
			transaction = new Transaction({
				moduleID: 2,
				assetID: 0,
				fee: BigInt(613000),
				asset: getRandomBytes(500),
				nonce: BigInt(2),
				senderPublicKey: getRandomBytes(31),
				signatures: [getRandomBytes(64)],
			});
			expect(() => chainInstance.validateTransaction(transaction)).toThrow(
				'Lisk validator found 1 error[s]',
			);
		});

		it('should throw when signatures is empty', () => {
			transaction = new Transaction({
				moduleID: 2,
				assetID: 0,
				fee: BigInt(613000),
				asset: getRandomBytes(500),
				nonce: BigInt(2),
				senderPublicKey: getRandomBytes(32),
				signatures: [],
			});
			expect(() => chainInstance.validateTransaction(transaction)).toThrow(
				'Signatures must not be empty',
			);
		});

		it('should throw when any of signatures are not 64 bytes', () => {
			transaction = new Transaction({
				moduleID: 2,
				assetID: 0,
				fee: BigInt(613000),
				asset: getRandomBytes(500),
				nonce: BigInt(2),
				senderPublicKey: getRandomBytes(32),
				signatures: [
					getRandomBytes(64),
					getRandomBytes(32),
					getRandomBytes(32),
					getRandomBytes(64),
				],
			});
			expect(() => chainInstance.validateTransaction(transaction)).toThrow(
				'Signature must be empty or 64 bytes',
			);
		});
	});

	describe('#validateBlockHeader', () => {
		describe('when signature is invalid', () => {
			it('should throw error', async () => {
				// Arrange
				block = await createValidDefaultBlock();
				(block.header as any).signature = getRandomBytes(64);
				// Act & assert
				await expect(chainInstance.validateBlockHeader(block)).rejects.toThrow(
					'Invalid block signature',
				);
			});
		});

		describe('when generatorPublicKey is empty', () => {
			it('should throw error', async () => {
				// Arrange
				block = await createValidDefaultBlock({ header: { generatorPublicKey: Buffer.alloc(0) } });
				// Act & assert
				await expect(chainInstance.validateBlockHeader(block)).rejects.toThrow(
					'"pk" must be crypto_sign_PUBLICKEYBYTES bytes long',
				);
			});
		});

		describe('when signature is empty', () => {
			it('should throw error', async () => {
				// Arrange
				block = await createValidDefaultBlock();
				(block.header as any).signature = Buffer.alloc(0);
				// Act & assert
				await expect(chainInstance.validateBlockHeader(block)).rejects.toThrow(
					'"sig" must be at least crypto_sign_BYTES bytes long',
				);
			});
		});

		describe('when previousBlockID is empty', () => {
			it('should throw error', async () => {
				// Arrange
				block = await createValidDefaultBlock({ header: { previousBlockID: Buffer.alloc(0) } });
				// Act & assert
				await expect(chainInstance.validateBlockHeader(block)).rejects.toThrow(
					'Previous block id must not be empty',
				);
			});
		});

		describe('when reward is invalid', () => {
			it('should throw error', async () => {
				// Arrange
				block = await createValidDefaultBlock({
					header: { reward: BigInt(1000000000) },
				});
				// Act & assert
				await expect(chainInstance.validateBlockHeader(block)).rejects.toThrow(
					'Invalid block reward',
				);
			});
		});

		describe('when a transaction included is invalid', () => {
			it('should throw error', async () => {
				// Arrange
				const invalidTx = getTransaction();
				(invalidTx.senderPublicKey as any) = '100';
				invalidTx['_id'] = Buffer.from('123');
				block = await createValidDefaultBlock({ payload: [invalidTx] });
				// Act & assert
				await expect(chainInstance.validateBlockHeader(block)).rejects.toThrow();
			});
		});

		describe('when payload length exceeds maximum allowed', () => {
			it('should throw error', async () => {
				// Arrange
				(chainInstance as any).constants.maxPayloadLength = 100;
				const txs = new Array(200).fill(0).map(() => getTransaction());
				block = await createValidDefaultBlock({ payload: txs });
				// Act & assert
				await expect(chainInstance.validateBlockHeader(block)).rejects.toThrow(
					'Payload length is too long',
				);
			});
		});

		describe('when transaction root is incorrect', () => {
			it('should throw error', async () => {
				// Arrange
				const txs = new Array(20).fill(0).map(() => getTransaction());
				block = await createValidDefaultBlock({
					payload: txs,
					header: { transactionRoot: Buffer.from('1234567890') },
				});
				// Act & assert
				await expect(chainInstance.validateBlockHeader(block)).rejects.toThrow(
					'Invalid transaction root',
				);
			});
		});

		describe('when all the value is valid', () => {
			it('should not throw error', async () => {
				// Arrange
				const txs = new Array(20).fill(0).map(() => getTransaction());
				block = await createValidDefaultBlock({ payload: txs });
				// Act & assert
				await expect(chainInstance.validateBlockHeader(block)).resolves.toBeUndefined();
			});
		});
	});

	describe('#verifyBlockHeader', () => {
		let stateStore: StateStore;

		beforeEach(() => {
			// Arrange
			const dataAccess = new DataAccess({
				db,
				accountSchema: defaultAccountSchema as any,
				registeredBlockHeaders,
				minBlockHeaderCache: 505,
				maxBlockHeaderCache: 309,
			});
			stateStore = new StateStore(dataAccess, {
				lastBlockHeaders: [],
				networkIdentifier: defaultNetworkIdentifier,
				lastBlockReward: BigInt(500000000),
				defaultAccount,
			});
		});

		describe('when previous block id is invalid', () => {
			it('should not throw error', async () => {
				// Arrange
				block = await createValidDefaultBlock({
					header: { previousBlockID: getRandomBytes(32) },
				});
				// Act & assert
				await expect(chainInstance.verifyBlockHeader(block, stateStore)).rejects.toThrow(
					'Invalid previous block',
				);
			});
		});

		describe('when block slot is invalid', () => {
			it('should throw when block timestamp is in the future', async () => {
				// Arrange
				const futureTimestamp = chainInstance.slots.getSlotTime(chainInstance.slots.getNextSlot());
				block = await createValidDefaultBlock({
					header: {
						timestamp: futureTimestamp,
						previousBlockID: genesisBlock.header.id,
					},
				});
				expect.assertions(1);
				// Act & Assert
				await expect(chainInstance.verifyBlockHeader(block, stateStore)).rejects.toThrow(
					'Invalid block timestamp',
				);
			});

			it('should throw when block timestamp is earlier than lastBlock timestamp', async () => {
				// Arrange
				block = await createValidDefaultBlock({
					header: { timestamp: 0, previousBlockID: genesisBlock.header.id },
				});
				expect.assertions(1);
				// Act & Assert
				await expect(chainInstance.verifyBlockHeader(block, stateStore)).rejects.toThrow(
					'Invalid block timestamp',
				);
			});

			it('should throw when block timestamp is equal to the lastBlock timestamp', async () => {
				(chainInstance as any)._lastBlock = {
					...genesisBlock,
					timestamp: 200,
					receivedAt: new Date(),
				};
				// Arrange
				block = await createValidDefaultBlock({
					header: {
						previousBlockID: chainInstance.lastBlock.header.id,
						height: chainInstance.lastBlock.header.height + 1,
						timestamp: chainInstance.lastBlock.header.timestamp - 10,
					},
				});
				// Act & Assert
				await expect(chainInstance.verifyBlockHeader(block, stateStore)).rejects.toThrow(
					'Invalid block timestamp',
				);
			});
		});

		describe('when block is generated by an address which does not belong to validators', () => {
			it('should throw an error', async () => {
				// Arrange
				block = await createValidDefaultBlock();
				const validatorBuffer = codec.encode(validatorsSchema, {
					validators: [{ address: getRandomBytes(20) }],
				});
				when(db.get)
					.calledWith(Buffer.from('consensus:validators', 'utf8'))
					.mockResolvedValue(validatorBuffer as never);

				// Act & assert
				await expect(chainInstance.verifyBlockHeader(block, stateStore)).rejects.toThrow(
					'Failed to verify generator',
				);
			});
		});

		describe('when block is generated by an address which is in validators but not correct slot', () => {
			it('should throw an error', async () => {
				// Arrange
				block = await createValidDefaultBlock();
				const validatorBuffer = codec.encode(validatorsSchema, {
					validators: [
						{ address: getAddressFromPublicKey(block.header.generatorPublicKey) },
						{ address: getRandomBytes(20) },
					],
				});
				when(db.get)
					.calledWith(Buffer.from('consensus:validators', 'utf8'))
					.mockResolvedValue(validatorBuffer as never);

				// Act & assert
				await expect(chainInstance.verifyBlockHeader(block, stateStore)).rejects.toThrow(
					'Failed to verify generator',
				);
			});
		});

		describe('when seedReveal is invalid but reward is current reward', () => {
			it('should throw an error', async () => {
				// Arrange
				const lastBlock = await createValidDefaultBlock({
					header: {
						height: 1,
						asset: {
							seedReveal: getRandomBytes(16),
							maxHeightPreviouslyForged: 0,
							maxHeightPrevoted: 0,
						},
					},
				});
				chainInstance['_lastBlock'] = lastBlock;
				block = await createValidDefaultBlock({
					header: {
						reward: BigInt(500000000),
						previousBlockID: lastBlock.header.id,
						generatorPublicKey: lastBlock.header.generatorPublicKey,
						timestamp: lastBlock.header.timestamp + 10,
						height: 2,
						asset: {
							seedReveal: getRandomBytes(16),
							maxHeightPreviouslyForged: 0,
							maxHeightPrevoted: 0,
						},
					},
				});
				const validatorBuffer = codec.encode(validatorsSchema, {
					validators: [{ address: getAddressFromPublicKey(block.header.generatorPublicKey) }],
				});
				when(db.get)
					.calledWith(Buffer.from('consensus:validators', 'utf8'))
					.mockResolvedValue(validatorBuffer as never);

				const dataAccess = new DataAccess({
					db,
					accountSchema: defaultAccountSchema as any,
					registeredBlockHeaders,
					minBlockHeaderCache: 505,
					maxBlockHeaderCache: 309,
				});

				stateStore = new StateStore(dataAccess, {
					lastBlockHeaders: [lastBlock.header],
					networkIdentifier: defaultNetworkIdentifier,
					lastBlockReward: BigInt(500000000),
					defaultAccount,
				});

				// Act & assert
				await expect(chainInstance.verifyBlockHeader(block, stateStore)).rejects.toThrow(
					'Invalid block reward',
				);
			});
		});

		describe('when all values are valid', () => {
			it('should not throw error', async () => {
				// Arrange
				block = await createValidDefaultBlock();
				const validatorBuffer = codec.encode(validatorsSchema, {
					validators: [{ address: getAddressFromPublicKey(block.header.generatorPublicKey) }],
				});
				when(db.get)
					.calledWith(Buffer.from('consensus:validators', 'utf8'))
					.mockResolvedValue(validatorBuffer as never);

				// Act & assert
				await expect(chainInstance.verifyBlockHeader(block, stateStore)).resolves.toBeUndefined();
			});
		});
	});

	describe('isValidSeedReveal', () => {
		const generatorPublicKey = Buffer.from(
			'b4f98dacb1609ad11b63ea20b61a5721a9b502af948c96522260e3d89910a8d9',
			'hex',
		);
		const blockHeaders = [
			{
				generatorPublicKey: Buffer.from(
					'b4f98dacb1609ad11b63ea20b61a5721a9b502af948c96522260e3d89910a8d9',
					'hex',
				),
				asset: {
					seedReveal: Buffer.from('5ba62f5eab476baa25a500dc87df6844', 'hex'),
				},
				height: 3,
			},
			{
				generatorPublicKey: Buffer.from(
					'b4f98dacb1609ad11b63ea20b61a5721a9b502af948c96522260e3d89910a8d9',
					'hex',
				),
				asset: {
					seedReveal: Buffer.from('da855fe23751069fcbd934fa6a1c6e70', 'hex'),
				},
				height: 2,
			},
			{
				generatorPublicKey: Buffer.from(
					'842dcd768bf0311100781e6caa7141b62303a20274fa0b83357d7c920b8854c1',
					'hex',
				),
				asset: {
					seedReveal: Buffer.from('40f6788cec6edda672e52dd63d10a31a', 'hex'),
				},
				height: 1,
			},
		];

		beforeEach(() => {
			chainInstance['_numberOfValidators'] = 103;
		});

		describe('Given delegate was only active in last three rounds', () => {
			it('should return false if current block seedReveal is not a preimage of previous block', () => {
				// Arrange
				const blockHeader = {
					asset: {
						seedReveal: Buffer.from('00000000000000000000000000000000', 'hex'),
					},
					height: 5,
					generatorPublicKey,
				} as BlockHeader;

				// Act
				const seedRevealValid = chainInstance.isValidSeedReveal(
					blockHeader,
					createStateStore(db, [blockHeader]),
				);
				// Assert
				expect(seedRevealValid).toBeFalse();
			});

			it('should return true if current block seedReveal is a preimage of previous block', () => {
				// Arrange
				const lastBlockHeaders = [...blockHeaders.slice(1)] as BlockHeader[];
				const blockHeader = {
					asset: {
						seedReveal: blockHeaders[0].asset.seedReveal,
					},
					height: 5,
					generatorPublicKey,
				} as BlockHeader;

				// Act
				const seedRevealValid = chainInstance.isValidSeedReveal(
					blockHeader,
					createStateStore(db, lastBlockHeaders),
				);
				// Assert
				expect(seedRevealValid).toBeTrue();
			});
		});

		describe('Given delegate was not active in last rounds', () => {
			it('should return true if the forger did not forge any block in the previous round or previously in the same round', () => {
				// Arrange
				const lastBlockHeaders = [...blockHeaders.slice(1)] as BlockHeader[];
				const blockHeader = {
					asset: {
						seedReveal: blockHeaders[0].asset.seedReveal,
					},
					height: 404,
					generatorPublicKey,
				} as BlockHeader;

				// Act
				const seedRevealValid = chainInstance.isValidSeedReveal(
					blockHeader,
					createStateStore(db, lastBlockHeaders),
				);
				// Assert
				expect(seedRevealValid).toBeTrue();
			});

			it('should return false if the forger did forge a block in the previous round or previously in the same round but new block with wrong seed reveal', () => {
				// Arrange
				const lastBlockHeaders = blockHeaders as BlockHeader[];
				const blockHeader = {
					asset: {
						seedReveal: Buffer.from('00000000000000000000000000000000', 'hex'),
					},
					height: 202,
					generatorPublicKey,
				} as BlockHeader;

				// Act
				const seedRevealValid = chainInstance.isValidSeedReveal(
					blockHeader,
					createStateStore(db, lastBlockHeaders),
				);
				// Assert
				expect(seedRevealValid).toBeFalse();
			});
		});
	});

	describe('validateGenesisBlockHeader', () => {
		it('should fail if "version" is not zero', () => {
			// Arrange
			const gb = objects.mergeDeep({}, genesisBlock, {
				header: { version: 1 },
			}) as GenesisBlock;

			// Act & Assert
			expect.assertions(3);
			try {
				chainInstance.validateGenesisBlockHeader(gb);
			} catch (error) {
				expect(error).toBeInstanceOf(LiskValidationError);
				expect((error as LiskValidationError).errors).toHaveLength(1);
				expect((error as LiskValidationError).errors[0]).toEqual(
					expect.objectContaining({
						message: 'must be equal to constant',
						params: { allowedValue: 0 },
					}),
				);
			}
		});

		it('should fail if "reward" is not zero', () => {
			// Arrange
			const gb = objects.mergeDeep({}, genesisBlock, {
				header: { reward: BigInt(1) },
			}) as GenesisBlock;

			// Act & Assert
			expect.assertions(3);
			try {
				chainInstance.validateGenesisBlockHeader(gb);
			} catch (error) {
				expect(error).toBeInstanceOf(LiskValidationError);
				expect((error as LiskValidationError).errors).toHaveLength(1);
				expect((error as LiskValidationError).errors[0]).toEqual(
					expect.objectContaining({
						message: 'should be equal to constant',
						params: { allowedValue: BigInt(0) },
					}),
				);
			}
		});

		it('should fail if "transactionRoot" is not empty hash', () => {
			// Arrange
			const gb = objects.mergeDeep({}, genesisBlock, {
				header: { transactionRoot: getRandomBytes(20) },
			}) as GenesisBlock;

			// Act & Assert
			expect.assertions(3);
			try {
				chainInstance.validateGenesisBlockHeader(gb);
			} catch (error) {
				expect(error).toBeInstanceOf(LiskValidationError);
				expect((error as LiskValidationError).errors).toHaveLength(1);
				expect((error as LiskValidationError).errors[0]).toEqual(
					expect.objectContaining({
						message: 'should be equal to constant',
						params: { allowedValue: hash(Buffer.alloc(0)) },
					}),
				);
			}
		});

		it('should fail if "generatorPublicKey" is not empty buffer', () => {
			// Arrange
			const gb = objects.mergeDeep({}, genesisBlock, {
				header: { generatorPublicKey: Buffer.from(getRandomBytes(20)) },
			}) as GenesisBlock;

			// Act & Assert
			expect.assertions(3);
			try {
				chainInstance.validateGenesisBlockHeader(gb);
			} catch (error) {
				expect(error).toBeInstanceOf(LiskValidationError);
				expect((error as LiskValidationError).errors).toHaveLength(1);
				expect((error as LiskValidationError).errors[0]).toEqual(
					expect.objectContaining({
						message: 'should be equal to constant',
						params: { allowedValue: Buffer.alloc(0) },
					}),
				);
			}
		});

		it('should fail if "signature" is not empty buffer', () => {
			// Arrange
			const gb = objects.mergeDeep({}, genesisBlock, {
				header: { signature: Buffer.from(getRandomBytes(20)) },
			}) as GenesisBlock;

			// Act & Assert
			expect.assertions(3);
			try {
				chainInstance.validateGenesisBlockHeader(gb);
			} catch (error) {
				expect(error).toBeInstanceOf(LiskValidationError);
				expect((error as LiskValidationError).errors).toHaveLength(1);
				expect((error as LiskValidationError).errors[0]).toEqual(
					expect.objectContaining({
						message: 'should be equal to constant',
						params: { allowedValue: Buffer.alloc(0) },
					}),
				);
			}
		});

		it('should fail if "payload" is less not empty array', () => {
			// Arrange
			const gb = objects.mergeDeep({}, genesisBlock, {
				payload: [Buffer.from(getRandomBytes(10))],
			}) as GenesisBlock;

			// Act & Assert
			expect.assertions(3);
			try {
				chainInstance.validateGenesisBlockHeader(gb);
			} catch (error) {
				expect(error).toBeInstanceOf(LiskValidationError);
				expect((error as LiskValidationError).errors).toHaveLength(1);
				expect((error as LiskValidationError).errors[0]).toEqual(
					expect.objectContaining({
						message: 'Payload length must be zero',
						params: { allowedValue: [] },
					}),
				);
			}
		});

		describe('asset.initDelegates', () => {
			it('should fail if "asset.initDelegates" list is not lexicographically ordered', () => {
				// Arrange
				const initDelegates = objects.cloneDeep([...genesisBlock.header.asset.initDelegates]);
				initDelegates.sort((a, b) => b.compare(a));
				const gb = objects.mergeDeep({}, genesisBlock, {
					header: {
						asset: {
							initDelegates,
						},
					},
				}) as GenesisBlock;

				// Act & Assert
				expect.assertions(3);
				try {
					chainInstance.validateGenesisBlockHeader(gb);
				} catch (error) {
					expect(error).toBeInstanceOf(LiskValidationError);
					expect((error as LiskValidationError).errors).toHaveLength(1);
					expect((error as LiskValidationError).errors[0]).toEqual(
						expect.objectContaining({
							message: 'should be lexicographically ordered',
							keyword: 'initDelegates',
							dataPath: 'header.asset.initDelegates',
							schemaPath: 'properties.initDelegates',
						}),
					);
				}
			});

			it('should fail if "asset.initDelegates" list items are not unique', () => {
				// Arrange
				const initDelegates = [
					...objects.cloneDeep(genesisBlock.header.asset.initDelegates),
					objects.cloneDeep(genesisBlock.header.asset.initDelegates[0]),
				].sort((a, b) => a.compare(b));
				const gb = objects.mergeDeep({}, genesisBlock, {
					header: {
						asset: {
							initDelegates,
						},
					},
				}) as GenesisBlock;

				// Act & Assert
				expect.assertions(3);
				try {
					chainInstance.validateGenesisBlockHeader(gb);
				} catch (error) {
					expect(error).toBeInstanceOf(LiskValidationError);
					expect((error as LiskValidationError).errors).toHaveLength(1);
					expect((error as LiskValidationError).errors[0]).toEqual(
						expect.objectContaining({
							dataPath: '.initDelegates',
							keyword: 'uniqueItems',
							message: 'must NOT have duplicate items',
							params: {},
							schemaPath: '#/properties/initDelegates/uniqueItems',
						}),
					);
				}
			});

			it('should fail if "asset.initDelegates" list is empty', () => {
				// Arrange
				const initDelegates: Buffer[] = [];
				const gb = objects.mergeDeep({}, genesisBlock, {
					header: {
						asset: {
							initDelegates,
						},
					},
				}) as GenesisBlock;

				// Act & Assert
				expect.assertions(3);
				try {
					chainInstance.validateGenesisBlockHeader(gb);
				} catch (error) {
					expect(error).toBeInstanceOf(LiskValidationError);
					expect((error as LiskValidationError).errors).toHaveLength(1);
					expect((error as LiskValidationError).errors[0]).toEqual(
						expect.objectContaining({
							dataPath: '.initDelegates',
							keyword: 'minItems',
							message: 'must NOT have fewer than 1 items',
							params: {
								limit: 1,
							},
							schemaPath: '#/properties/initDelegates/minItems',
						}),
					);
				}
			});
		});

		describe('asset.accounts', () => {
			const legacyAccounts = [
				{
					address: Buffer.from('8789de4316d79d22', 'hex'),
					token: {
						balance: BigInt('0'),
					},
					sequence: {
						nonce: BigInt('0'),
					},
					keys: {
						mandatoryKeys: [],
						optionalKeys: [],
						numberOfSignatures: 0,
					},
					dpos: {
						delegate: {
							username: '',
							pomHeights: [],
							consecutiveMissedBlocks: 0,
							lastForgedHeight: 0,
							isBanned: false,
							totalVotesReceived: BigInt('0'),
						},
						sentVotes: [],
						unlocking: [],
					},
				},
				{
					address: Buffer.from('bdf994ff9c884ffa', 'hex'),
					token: {
						balance: BigInt('0'),
					},
					sequence: {
						nonce: BigInt('0'),
					},
					keys: {
						mandatoryKeys: [],
						optionalKeys: [],
						numberOfSignatures: 0,
					},
					dpos: {
						delegate: {
							username: '',
							pomHeights: [],
							consecutiveMissedBlocks: 0,
							lastForgedHeight: 0,
							isBanned: false,
							totalVotesReceived: BigInt('0'),
						},
						sentVotes: [],
						unlocking: [],
					},
				},
			];

			it('should not fail if "asset.accounts" list is ordered by "address" length', () => {
				// Arrange
				const accounts = objects.cloneDeep([
					...legacyAccounts,
					...genesisBlock.header.asset.accounts,
				]);
				const gb = objects.mergeDeep({}, genesisBlock, {
					header: {
						asset: {
							accounts,
						},
					},
				}) as GenesisBlock;

				// Act & Assert
				expect(() => chainInstance.validateGenesisBlockHeader(gb)).not.toThrow();
			});

			it('should fail if "asset.accounts" list is not ordered by "address" length', () => {
				// Arrange
				const accounts = objects.cloneDeep([...genesisBlock.header.asset.accounts]);
				accounts.push(...legacyAccounts);
				const gb = objects.mergeDeep({}, genesisBlock, {
					header: {
						asset: {
							accounts,
						},
					},
				}) as GenesisBlock;

				// Act & Assert
				expect.assertions(3);
				try {
					chainInstance.validateGenesisBlockHeader(gb);
				} catch (error) {
					expect(error).toBeInstanceOf(LiskValidationError);
					expect((error as LiskValidationError).errors).toHaveLength(1);
					expect((error as LiskValidationError).errors[0]).toEqual(
						expect.objectContaining({
							message: 'should be length and lexicographically ordered',
							keyword: 'accounts',
							dataPath: 'header.asset.accounts',
							schemaPath: 'properties.accounts',
							params: { orderKey: 'address' },
						}),
					);
				}
			});

			it('should fail if "asset.accounts" list is not lexicographically ordered by "address" within the length', () => {
				// Arrange
				const accounts = objects.cloneDeep([
					legacyAccounts[1],
					legacyAccounts[0],
					...genesisBlock.header.asset.accounts,
				]);
				const gb = objects.mergeDeep({}, genesisBlock, {
					header: {
						asset: {
							accounts,
						},
					},
				}) as GenesisBlock;

				// Act & Assert
				expect.assertions(3);
				try {
					chainInstance.validateGenesisBlockHeader(gb);
				} catch (error) {
					expect(error).toBeInstanceOf(LiskValidationError);
					expect((error as LiskValidationError).errors).toHaveLength(1);
					expect((error as LiskValidationError).errors[0]).toEqual(
						expect.objectContaining({
							message: 'should be length and lexicographically ordered',
							keyword: 'accounts',
							dataPath: 'header.asset.accounts',
							schemaPath: 'properties.accounts',
							params: { orderKey: 'address' },
						}),
					);
				}
			});

			it('should fail if "asset.accounts" list is not lexicographically ordered by "address"', () => {
				// Arrange
				const accounts = objects.cloneDeep([...genesisBlock.header.asset.accounts]);
				accounts.sort((a, b) => b.address.compare(a.address));
				const gb = objects.mergeDeep({}, genesisBlock, {
					header: {
						asset: {
							accounts,
						},
					},
				}) as GenesisBlock;

				// Act & Assert
				expect.assertions(3);
				try {
					chainInstance.validateGenesisBlockHeader(gb);
				} catch (error) {
					expect(error).toBeInstanceOf(LiskValidationError);
					expect((error as LiskValidationError).errors).toHaveLength(1);
					expect((error as LiskValidationError).errors[0]).toEqual(
						expect.objectContaining({
							message: 'should be length and lexicographically ordered',
							keyword: 'accounts',
							dataPath: 'header.asset.accounts',
							schemaPath: 'properties.accounts',
							params: { orderKey: 'address' },
						}),
					);
				}
			});

			it('should fail if "asset.accounts" list contains duplicate account by "address"', () => {
				// Arrange
				const accounts = [
					...objects.cloneDeep(genesisBlock.header.asset.accounts),
					objects.cloneDeep(genesisBlock.header.asset.accounts[0]),
				];
				accounts.sort((a, b) => a.address.compare(b.address));
				const gb = objects.mergeDeep({}, genesisBlock, {
					header: {
						asset: {
							accounts,
						},
					},
				}) as GenesisBlock;

				// Act & Assert
				expect.assertions(3);
				try {
					chainInstance.validateGenesisBlockHeader(gb);
				} catch (error) {
					expect(error).toBeInstanceOf(LiskValidationError);
					expect((error as LiskValidationError).errors).toHaveLength(1);
					expect((error as LiskValidationError).errors[0]).toEqual(
						expect.objectContaining({
							dataPath: '.accounts',
							keyword: 'uniqueItems',
							message: 'must NOT have duplicate items',
							params: {},
							schemaPath: '#/properties/accounts/uniqueItems',
						}),
					);
				}
			});
		});
	});

	describe('applyGenesisBlock', () => {
		let stateStore: StateStore;

		beforeEach(() => {
			stateStore = createStateStore(db);
		});

		it('should store init delegates to the validators', async () => {
			jest.spyOn(stateStore.account, 'set');
			await chainInstance.applyGenesisBlock(genesisBlock, stateStore);
			expect(stateStore.account.set).toHaveBeenCalledTimes(
				genesisBlock.header.asset.accounts.length,
			);
		});

		it('should store all the accounts in the genesis block', async () => {
			await chainInstance.applyGenesisBlock(genesisBlock, stateStore);
			const validatorsBuffer = await stateStore.consensus.get(CONSENSUS_STATE_VALIDATORS_KEY);
			const { validators } = codec.decode<{ validators: Validator[] }>(
				validatorsSchema,
				validatorsBuffer as Buffer,
			);

			expect(validators).toHaveLength(genesisBlock.header.asset.initDelegates.length);
			expect(validators.every(v => !v.isConsensusParticipant)).toBeTrue();
			expect(
				validators.every(v => v.minActiveHeight === genesisBlock.header.height + 1),
			).toBeTrue();
		});
	});
});
