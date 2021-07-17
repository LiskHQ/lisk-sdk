/*
 * Copyright © 2018 Lisk Foundation
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

import { codec } from '@liskhq/lisk-codec';
import { dataStructures } from '@liskhq/lisk-utils';
import { getRandomBytes, getAddressFromPublicKey } from '@liskhq/lisk-cryptography';
import {
	BlockHeader,
	CONSENSUS_STATE_FINALIZED_HEIGHT_KEY,
	Chain,
	CONSENSUS_STATE_VALIDATORS_KEY,
	validatorsSchema,
	StateStore,
	testing,
} from '@liskhq/lisk-chain';
import {
	FinalityManager,
	CONSENSUS_STATE_VALIDATOR_LEDGER_KEY,
	BFTVotingLedgerSchema,
} from '../../src/finality_manager';
import { BFTError } from '../../src/types';
import { createFakeBlockHeader } from '../fixtures/blocks';
import { BFTFinalizedHeightCodecSchema } from '../../src';

const generateValidHeaders = (count: number): any[] => {
	return [...Array(count)].map((_, index) => {
		return createFakeBlockHeader({
			height: index + 1,
			asset: {
				maxHeightPreviouslyForged: index,
			},
		});
	});
};

describe('finality_manager', () => {
	const { StateStoreMock } = testing;

	describe('FinalityManager', () => {
		const finalizedHeight = 0;
		const threshold = 68;
		const preVoteThreshold = threshold;
		const preCommitThreshold = threshold;
		const processingThreshold = 308;
		const maxHeaders = 515;

		let finalityManager: FinalityManager;
		let chainStub: Chain;

		beforeEach(() => {
			chainStub = ({
				slots: {
					getSlotNumber: jest.fn(),
					isWithinTimeslot: jest.fn(),
					timeSinceGenesis: jest.fn(),
				},
				dataAccess: {
					getConsensusState: jest.fn(),
				},
				numberOfValidators: 103,
			} as unknown) as Chain;

			finalityManager = new FinalityManager({
				chain: chainStub,
				finalizedHeight,
				threshold,
			});
		});

		describe('constructor', () => {
			it('should initialize the object correctly', () => {
				expect(finalityManager).toBeInstanceOf(FinalityManager);
				expect(finalityManager.preVoteThreshold).toEqual(preVoteThreshold);
				expect(finalityManager.preCommitThreshold).toEqual(preCommitThreshold);
				expect(finalityManager.processingThreshold).toEqual(processingThreshold);
				expect(finalityManager.maxHeaders).toEqual(maxHeaders);
			});

			it('should throw error if number of validator is not positive', () => {
				(chainStub as any).numberOfValidators = -3;
				expect(
					() =>
						new FinalityManager({
							chain: chainStub,
							finalizedHeight,
							threshold,
						}),
				).toThrow('Invalid number of validators for BFT property');
			});

			it('should initialize maxHeightPrevoted to the finalizedHeight', async () => {
				const nonZeroFinalizedHeight = 10000000;
				finalityManager = new FinalityManager({
					chain: chainStub,
					finalizedHeight: nonZeroFinalizedHeight,
					threshold,
				});
				await expect(finalityManager.getMaxHeightPrevoted()).resolves.toEqual(
					nonZeroFinalizedHeight,
				);
			});
		});

		describe('verifyBlockHeaders', () => {
			let stateStore: StateStore;

			it('should throw error if maxHeightPrevoted is not accurate', async () => {
				// Add the header directly to list so verifyBlockHeaders can be validated against it
				const bftHeaders = generateValidHeaders(finalityManager.processingThreshold + 1);

				stateStore = (new StateStoreMock({
					lastBlockHeaders: bftHeaders,
				}) as unknown) as StateStore;

				const header = createFakeBlockHeader({
					asset: { maxHeightPrevoted: 10 },
				});

				expect.assertions(1);
				try {
					await finalityManager.verifyBlockHeaders(header, stateStore);
				} catch (error) {
					// eslint-disable-next-line jest/no-try-expect
					expect(error.message).toContain('Wrong maxHeightPrevoted in blockHeader.');
				}
			});

			it('should not throw error if maxHeightPrevoted is accurate', async () => {
				// Add the header directly to list so verifyBlockHeaders can be validated against it
				const bftHeaders = generateValidHeaders(finalityManager.processingThreshold + 1);
				const header = createFakeBlockHeader({
					asset: { maxHeightPrevoted: 10 },
				});
				const validatorLedger = {
					validators: [
						{
							address: getAddressFromPublicKey(header.generatorPublicKey),
							maxPreVoteHeight: 1,
							maxPreCommitHeight: 0,
						},
					],
					ledger: [
						{
							height: 10,
							prevotes: 69,
							precommits: 0,
						},
					],
				};
				stateStore = (new StateStoreMock({
					lastBlockHeaders: bftHeaders,
				}) as unknown) as StateStore;

				await stateStore.consensus.set(
					CONSENSUS_STATE_VALIDATOR_LEDGER_KEY,
					codec.encode(BFTVotingLedgerSchema, validatorLedger),
				);

				await expect(finalityManager.verifyBlockHeaders(header, stateStore)).resolves.toBeTrue();
			});

			it("should return true if validator didn't forge any block previously", async () => {
				const header = createFakeBlockHeader();
				stateStore = (new StateStoreMock({ lastBlockHeaders: [] }) as unknown) as StateStore;

				await expect(finalityManager.verifyBlockHeaders(header, stateStore)).resolves.toBeTruthy();
			});

			it('should throw error if same validator forged block on different height', async () => {
				const maxHeightPrevoted = 10;
				const generatorPublicKey = getRandomBytes(32);
				const lastBlock = createFakeBlockHeader({
					generatorPublicKey,
					asset: {
						maxHeightPreviouslyForged: 5,
						maxHeightPrevoted,
					},
					height: 10,
				});
				const currentBlock = createFakeBlockHeader({
					generatorPublicKey,
					asset: {
						maxHeightPrevoted,
						maxHeightPreviouslyForged: 6,
					},
					height: 9,
				});

				stateStore = (new StateStoreMock({
					lastBlockHeaders: [lastBlock],
				}) as unknown) as StateStore;

				await expect(finalityManager.verifyBlockHeaders(currentBlock, stateStore)).rejects.toThrow(
					BFTError,
				);
			});

			it('should throw error if validator forged block on same height', async () => {
				const maxHeightPreviouslyForged = 10;
				const generatorPublicKey = getRandomBytes(32);
				const lastBlock = createFakeBlockHeader({
					generatorPublicKey,
					asset: {
						maxHeightPreviouslyForged,
					},
					height: 10,
				});
				const currentBlock = createFakeBlockHeader({
					generatorPublicKey,
					asset: {
						maxHeightPreviouslyForged,
					},
					height: 10,
				});
				stateStore = (new StateStoreMock({
					lastBlockHeaders: [lastBlock],
				}) as unknown) as StateStore;

				await expect(finalityManager.verifyBlockHeaders(currentBlock, stateStore)).rejects.toThrow(
					BFTError,
				);
			});

			it('should throw error if maxHeightPreviouslyForged has wrong value', async () => {
				const generatorPublicKey = getRandomBytes(32);
				const lastBlock = createFakeBlockHeader({
					generatorPublicKey,
					height: 10,
				});
				const currentBlock = createFakeBlockHeader({
					generatorPublicKey,
					asset: {
						maxHeightPreviouslyForged: 9,
					},
				});

				stateStore = (new StateStoreMock({
					lastBlockHeaders: [lastBlock],
				}) as unknown) as StateStore;

				await expect(finalityManager.verifyBlockHeaders(currentBlock, stateStore)).rejects.toThrow(
					BFTError,
				);
			});

			it('should throw error if maxHeightPrevoted has wrong value', async () => {
				const generatorPublicKey = getRandomBytes(32);
				const lastBlock = createFakeBlockHeader({
					generatorPublicKey,
					height: 9,
					asset: {
						maxHeightPrevoted: 10,
					},
				});
				const currentBlock = createFakeBlockHeader({
					generatorPublicKey,
					height: 10,
					asset: {
						maxHeightPreviouslyForged: 9,
						maxHeightPrevoted: 9,
					},
				});

				stateStore = (new StateStoreMock({
					lastBlockHeaders: [lastBlock],
				}) as unknown) as StateStore;

				await expect(finalityManager.verifyBlockHeaders(currentBlock, stateStore)).rejects.toThrow(
					BFTError,
				);
			});

			it('should return true if headers are valid', async () => {
				const [lastBlock, currentBlock] = generateValidHeaders(2);
				stateStore = (new StateStoreMock({
					lastBlockHeaders: [lastBlock],
				}) as unknown) as StateStore;

				await expect(
					finalityManager.verifyBlockHeaders(currentBlock, stateStore),
				).resolves.toBeTruthy();
			});
		});

		describe('addBlockHeader', () => {
			const validatorLedger = {
				validators: [],
				ledger: [],
			};
			let stateStore: StateStore;
			let bftHeaders: Array<BlockHeader>;

			beforeEach(async () => {
				bftHeaders = generateValidHeaders(finalityManager.processingThreshold + 1);
				stateStore = (new StateStoreMock({
					lastBlockHeaders: bftHeaders,
				}) as unknown) as StateStore;
				await stateStore.consensus.set(
					CONSENSUS_STATE_FINALIZED_HEIGHT_KEY,
					codec.encode(BFTFinalizedHeightCodecSchema, {
						finalizedHeight: 5,
					}),
				);
				await stateStore.consensus.set(
					CONSENSUS_STATE_VALIDATOR_LEDGER_KEY,
					codec.encode(BFTVotingLedgerSchema, validatorLedger),
				);
				await stateStore.consensus.set(
					CONSENSUS_STATE_VALIDATORS_KEY,
					codec.encode(validatorsSchema, {
						validators: bftHeaders.slice(0, 103).map(h => ({
							address: getAddressFromPublicKey(h.generatorPublicKey),
							isConsensusParticipant: true,
							minActiveHeight: 0,
						})),
					}),
				);
			});

			it('should call verifyBlockHeaders with the provided header', async () => {
				const header1 = createFakeBlockHeader({
					height: 2,
					asset: {
						maxHeightPreviouslyForged: 0,
					},
					generatorPublicKey: bftHeaders[102].generatorPublicKey,
				});
				jest.spyOn(finalityManager, 'verifyBlockHeaders');
				await finalityManager.addBlockHeader(header1, stateStore);

				expect(finalityManager.verifyBlockHeaders).toHaveBeenCalledTimes(1);
				expect(finalityManager.verifyBlockHeaders).toHaveBeenCalledWith(header1, stateStore);
			});

			it('should call updatePrevotesPrecommits with the provided header', async () => {
				const header1 = createFakeBlockHeader({
					height: 2,
					asset: {
						maxHeightPreviouslyForged: 0,
					},
					generatorPublicKey: bftHeaders[102].generatorPublicKey,
				});
				jest.spyOn(finalityManager, 'updatePrevotesPrecommits');
				await finalityManager.addBlockHeader(header1, stateStore);

				expect(finalityManager.updatePrevotesPrecommits).toHaveBeenCalledTimes(1);
				expect(finalityManager.updatePrevotesPrecommits).toHaveBeenCalledWith(
					header1,
					stateStore,
					bftHeaders,
				);
			});

			it('should not update prevotes and precommits if validator does not have voting power', async () => {
				const header1 = createFakeBlockHeader({
					height: 2,
					asset: {
						maxHeightPreviouslyForged: 0,
					},
				});
				stateStore = (new StateStoreMock({
					lastBlockHeaders: bftHeaders,
				}) as unknown) as StateStore;

				await stateStore.consensus.set(
					CONSENSUS_STATE_VALIDATORS_KEY,
					codec.encode(validatorsSchema, {
						validators: [
							{
								address: getAddressFromPublicKey(header1.generatorPublicKey),
								isConsensusParticipant: false,
								minActiveHeight: 104,
							},
						],
					}),
				);

				jest.spyOn(finalityManager, 'updatePrevotesPrecommits');
				await finalityManager.addBlockHeader(header1, stateStore);

				expect(finalityManager.updatePrevotesPrecommits).toHaveBeenCalledTimes(1);
				expect(finalityManager.updatePrevotesPrecommits).toHaveBeenCalledWith(
					header1,
					stateStore,
					bftHeaders,
				);

				// Ignores a standby validator from prevotes and precommit calculations
				await expect(
					finalityManager.updatePrevotesPrecommits(header1, stateStore, bftHeaders),
				).resolves.toEqual(false);
			});

			it('should not update prevotes and precommits in case of a standby validator', async () => {
				const header1 = createFakeBlockHeader({
					height: 2,
					asset: {
						maxHeightPreviouslyForged: 0,
					},
				});

				stateStore = (new StateStoreMock({
					lastBlockHeaders: bftHeaders,
				}) as unknown) as StateStore;

				await stateStore.consensus.set(
					CONSENSUS_STATE_VALIDATORS_KEY,
					codec.encode(validatorsSchema, {
						validators: [
							{
								address: getAddressFromPublicKey(header1.generatorPublicKey),
								isConsensusParticipant: false,
								minActiveHeight: 104,
							},
						],
					}),
				);

				jest.spyOn(finalityManager, 'updatePrevotesPrecommits');
				await finalityManager.addBlockHeader(header1, stateStore);

				expect(finalityManager.updatePrevotesPrecommits).toHaveBeenCalledTimes(1);
				expect(finalityManager.updatePrevotesPrecommits).toHaveBeenCalledWith(
					header1,
					stateStore,
					bftHeaders,
				);

				// Ignores a standby validator from prevotes and precommit calculations
				await expect(
					finalityManager.updatePrevotesPrecommits(header1, stateStore, bftHeaders),
				).resolves.toEqual(false);
			});

			it('should throw error if blockheader has conflict (Violates disjointness condition)', async () => {
				const header1 = createFakeBlockHeader({
					height: 34624,
					asset: {
						maxHeightPreviouslyForged: 34501,
					},
				});
				const header2 = createFakeBlockHeader({
					height: 34666,
					generatorPublicKey: header1.generatorPublicKey,
					asset: {
						maxHeightPreviouslyForged: 34501,
					},
				});

				const headers = [header1];
				for (
					// eslint-disable-next-line @typescript-eslint/restrict-plus-operands
					let height = header1.height + 1;
					height < header2.height;
					height += 1
				) {
					const header = createFakeBlockHeader({
						height,
						asset: {
							maxHeightPreviouslyForged: height - 129,
						},
					});
					headers.push(header);
				}
				headers.push(header2);
				const addressMap = new dataStructures.BufferMap<Buffer>();
				for (const header of headers) {
					const addr = getAddressFromPublicKey(header.generatorPublicKey);
					addressMap.set(addr, addr);
				}
				stateStore = (new StateStoreMock({
					lastBlockHeaders: bftHeaders,
				}) as unknown) as StateStore;

				await stateStore.consensus.set(
					CONSENSUS_STATE_VALIDATORS_KEY,
					codec.encode(validatorsSchema, {
						validators: addressMap
							.values()
							.map(addr => ({ address: addr, isConsensusParticipant: true, minActiveHeight: 0 })),
					}),
				);

				try {
					for (const header of headers) {
						await finalityManager.addBlockHeader(header, stateStore);
					}
				} catch (error) {
					// eslint-disable-next-line jest/no-try-expect
					expect(error.message).toContain('Violation of disjointedness condition.');
				}
			});

			it('should not update finalized height if calculated value is lower', async () => {
				const header1 = createFakeBlockHeader({
					height: 2,
					asset: {
						maxHeightPreviouslyForged: 0,
						maxHeightPrevoted: 200,
					},
				});
				stateStore = (new StateStoreMock({
					lastBlockHeaders: bftHeaders,
				}) as unknown) as StateStore;

				await stateStore.consensus.set(
					CONSENSUS_STATE_VALIDATORS_KEY,
					codec.encode(validatorsSchema, {
						validators: [
							{
								address: getAddressFromPublicKey(header1.generatorPublicKey),
								isConsensusParticipant: false,
								minActiveHeight: 104,
							},
						],
					}),
				);

				await stateStore.consensus.set(
					CONSENSUS_STATE_VALIDATOR_LEDGER_KEY,
					codec.encode(BFTVotingLedgerSchema, {
						...validatorLedger,
						ledger: [
							{
								height: 200,
								prevotes: 99,
								precommits: 99,
							},
						],
					}),
				);
				const originalFinalizedHeight = 999;
				finalityManager.finalizedHeight = originalFinalizedHeight;
				jest.spyOn(finalityManager, 'updateFinalizedHeight');
				await finalityManager.addBlockHeader(header1, stateStore);

				// Ignores a standby validator from prevotes and precommit calculations
				expect(finalityManager.updateFinalizedHeight).toHaveBeenCalledTimes(1);
				expect(finalityManager.finalizedHeight).toEqual(originalFinalizedHeight);
			});
		});
	});
});
