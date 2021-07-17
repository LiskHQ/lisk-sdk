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

import { Readable } from 'stream';
import { when } from 'jest-when';
import { KVStore, NotFoundError, formatInt } from '@liskhq/lisk-db';
import { codec } from '@liskhq/lisk-codec';
import { getRandomBytes } from '@liskhq/lisk-cryptography';
import { Chain } from '../../src/chain';
import { StateStore } from '../../src/state_store';
import {
	createValidDefaultBlock,
	genesisBlock,
	defaultNetworkIdentifier,
	encodedDefaultBlock,
	encodeDefaultBlockHeader,
	encodeGenesisBlockHeader,
} from '../utils/block';
import { Block, Validator } from '../../src/types';
import { createFakeDefaultAccount, defaultAccountModules } from '../utils/account';
import { getTransaction } from '../utils/transaction';
import { stateDiffSchema, validatorsSchema } from '../../src/schema';
import { createStateStore } from '../utils/state_store';
import { CONSENSUS_STATE_VALIDATORS_KEY } from '../../src/constants';
import { concatKeys } from '../../src/utils';
import {
	DB_KEY_BLOCKS_HEIGHT,
	DB_KEY_BLOCKS_ID,
	DB_KEY_CONSENSUS_STATE,
	DB_KEY_DIFF_STATE,
	DB_KEY_TEMPBLOCKS_HEIGHT,
} from '../../src/data_access/constants';

jest.mock('events');
jest.mock('@liskhq/lisk-db');

describe('chain', () => {
	const constants = {
		maxPayloadLength: 15 * 1024,
		rewardDistance: 3000000,
		rewardOffset: 2160,
		rewardMilestones: [
			BigInt('500000000'), // Initial Reward
			BigInt('400000000'), // Milestone 1
			BigInt('300000000'), // Milestone 2
			BigInt('200000000'), // Milestone 3
			BigInt('100000000'), // Milestone 4
		],
		blockTime: 10,
		networkIdentifier: defaultNetworkIdentifier,
		minFeePerByte: 1000,
		baseFees: [],
	};
	const emptyEncodedDiff = codec.encode(stateDiffSchema, {
		created: [],
		updated: [],
		deleted: [],
	});
	let chainInstance: Chain;
	let db: any;

	beforeEach(() => {
		// Arrange
		db = new KVStore('temp');
		(formatInt as jest.Mock).mockImplementation(n => {
			const buf = Buffer.alloc(4);
			buf.writeUInt32BE(n, 0);
			return buf;
		});
		(db.createReadStream as jest.Mock).mockReturnValue(Readable.from([]));

		chainInstance = new Chain({
			db,
			genesisBlock,
			accountSchemas: defaultAccountModules,
			...constants,
		});
	});

	describe('constructor', () => {
		it('should initialize private variables correctly', () => {
			// Assert stubbed values are assigned

			// Assert constants
			Object.entries((chainInstance as any).constants).forEach(([constantName, constantValue]) =>
				expect((constants as any)[constantName]).toEqual(constantValue),
			);
		});
	});

	describe('genesisBlockExists', () => {
		it.todo('should throw an error when genesis block does not exist and last block does exist');
		it.todo('should return false when genesis block does not exist and last block does not exist');
		it.todo('should return true when genesis block exists');
	});

	describe('init', () => {
		let lastBlock: Block;
		beforeEach(async () => {
			(db.createReadStream as jest.Mock).mockReturnValue(
				Readable.from([{ value: genesisBlock.header.id }]),
			);
			lastBlock = await createValidDefaultBlock({ header: { height: 103 } });
			(db.createReadStream as jest.Mock).mockReturnValue(
				Readable.from([{ value: lastBlock.header.id }]),
			);
			when(db.get)
				.mockRejectedValue(new NotFoundError('Data not found') as never)
				.calledWith(concatKeys(DB_KEY_BLOCKS_HEIGHT, formatInt(1)))
				.mockResolvedValue(genesisBlock.header.id as never)
				.calledWith(concatKeys(DB_KEY_BLOCKS_ID, genesisBlock.header.id))
				.mockResolvedValue(encodeGenesisBlockHeader(genesisBlock.header) as never)
				.calledWith(concatKeys(DB_KEY_BLOCKS_ID, lastBlock.header.id))
				.mockResolvedValue(encodeDefaultBlockHeader(lastBlock.header) as never);
			jest.spyOn(chainInstance.dataAccess, 'getBlockHeadersByHeightBetween').mockResolvedValue([]);
		});

		it('should throw an error when Block.get throws error', async () => {
			// Act & Assert
			(db.createReadStream as jest.Mock).mockReturnValue(
				Readable.from([{ value: Buffer.from('randomID') }]),
			);
			await expect(chainInstance.init()).rejects.toThrow('Failed to load last block');
		});

		it('should return the the stored last block', async () => {
			// Act
			await chainInstance.init();

			// Assert
			expect(chainInstance.lastBlock.header.id).toEqual(lastBlock.header.id);
			expect(chainInstance.dataAccess.getBlockHeadersByHeightBetween).toHaveBeenCalledWith(0, 103);
		});
	});

	describe('newStateStore', () => {
		beforeEach(async () => {
			// eslint-disable-next-line dot-notation
			chainInstance['_lastBlock'] = await createValidDefaultBlock({
				header: { height: 532 },
			});
			jest
				.spyOn(chainInstance.dataAccess, 'getBlockHeadersByHeightBetween')
				.mockResolvedValue([
					(await createValidDefaultBlock()).header,
					genesisBlock.header,
				] as never);
		});

		it('should populate the chain state with genesis block', async () => {
			chainInstance['_lastBlock'] = await createValidDefaultBlock({
				header: { height: 1 },
			});
			chainInstance['_numberOfValidators'] = 103;
			await chainInstance.newStateStore();
			expect(chainInstance.dataAccess.getBlockHeadersByHeightBetween).toHaveBeenCalledWith(0, 1);
		});

		it('should return with the chain state with lastBlock.height to lastBlock.height - 309', async () => {
			chainInstance['_numberOfValidators'] = 103;
			await chainInstance.newStateStore();
			expect(chainInstance.dataAccess.getBlockHeadersByHeightBetween).toHaveBeenCalledWith(
				chainInstance.lastBlock.header.height - 309,
				chainInstance.lastBlock.header.height,
			);
		});

		it('should get the rewards of the last block', async () => {
			chainInstance['_numberOfValidators'] = 103;
			const stateStore = await chainInstance.newStateStore();

			expect(stateStore.chain.lastBlockReward.toString()).toEqual(
				stateStore.chain.lastBlockHeaders[0].reward.toString(),
			);
		});

		it('should return with the chain state with lastBlock.height to lastBlock.height - 310', async () => {
			chainInstance['_numberOfValidators'] = 103;
			await chainInstance.newStateStore(1);
			expect(chainInstance.dataAccess.getBlockHeadersByHeightBetween).toHaveBeenCalledWith(
				chainInstance.lastBlock.header.height - 310,
				chainInstance.lastBlock.header.height - 1,
			);
		});
	});

	describe('saveBlock', () => {
		let stateStoreStub: StateStore;
		let batchMock: any;
		let savingBlock: Block;

		const fakeAccounts = [createFakeDefaultAccount(), createFakeDefaultAccount()];

		beforeEach(async () => {
			savingBlock = await createValidDefaultBlock({ header: { height: 300 } });
			batchMock = {
				put: jest.fn(),
				del: jest.fn(),
				write: jest.fn(),
			};
			(db.batch as jest.Mock).mockReturnValue(batchMock);
			stateStoreStub = {
				finalize: jest.fn(),
				account: {
					getUpdated: jest.fn().mockReturnValue(fakeAccounts),
				},
			} as any;
		});

		it('should remove diff until finalized height', async () => {
			await chainInstance.saveBlock(savingBlock, stateStoreStub, 100, {
				removeFromTempTable: true,
			});
			expect(db.clear).toHaveBeenCalledWith({
				gte: concatKeys(DB_KEY_DIFF_STATE, formatInt(0)),
				lt: concatKeys(DB_KEY_DIFF_STATE, formatInt(100)),
			});
		});

		it('should remove tempBlock by height when removeFromTempTable is true', async () => {
			await chainInstance.saveBlock(savingBlock, stateStoreStub, 0, {
				removeFromTempTable: true,
			});
			expect(batchMock.del).toHaveBeenCalledWith(
				concatKeys(DB_KEY_TEMPBLOCKS_HEIGHT, formatInt(savingBlock.header.height)),
			);
			expect(stateStoreStub.finalize).toHaveBeenCalledTimes(1);
		});

		it('should save block', async () => {
			await chainInstance.saveBlock(savingBlock, stateStoreStub, 0);
			expect(batchMock.put).toHaveBeenCalledWith(
				concatKeys(DB_KEY_BLOCKS_ID, savingBlock.header.id),
				expect.anything(),
			);
			expect(batchMock.put).toHaveBeenCalledWith(
				concatKeys(DB_KEY_BLOCKS_HEIGHT, formatInt(savingBlock.header.height)),
				expect.anything(),
			);
			expect(stateStoreStub.finalize).toHaveBeenCalledTimes(1);
		});

		it('should emit block and accounts', async () => {
			// Arrange
			jest.spyOn((chainInstance as any).events, 'emit');
			const block = await createValidDefaultBlock();

			// Act
			await chainInstance.saveBlock(block, stateStoreStub, 0);

			// Assert
			expect((chainInstance as any).events.emit).toHaveBeenCalledWith('EVENT_NEW_BLOCK', {
				accounts: fakeAccounts,
				block,
			});
		});
	});

	describe('removeBlock', () => {
		const fakeAccounts = [createFakeDefaultAccount(), createFakeDefaultAccount()];

		let stateStoreStub: StateStore;
		let batchMock: any;

		beforeEach(() => {
			batchMock = {
				put: jest.fn(),
				del: jest.fn(),
				write: jest.fn(),
			};
			(db.batch as jest.Mock).mockReturnValue(batchMock);
			stateStoreStub = {
				finalize: jest.fn(),
				account: {
					getUpdated: jest.fn().mockReturnValue(fakeAccounts),
				},
			} as any;
		});

		it('should throw an error when removing genesis block', async () => {
			// Act & Assert
			await expect(chainInstance.removeBlock(genesisBlock as any, stateStoreStub)).rejects.toThrow(
				'Cannot delete genesis block',
			);
		});

		it('should throw an error when previous block does not exist in the database', async () => {
			// Arrange
			(db.get as jest.Mock).mockRejectedValue(new NotFoundError('Data not found') as never);
			const block = await createValidDefaultBlock();
			// Act & Assert
			await expect(chainInstance.removeBlock(block, stateStoreStub)).rejects.toThrow(
				'PreviousBlock is null',
			);
		});

		it('should throw an error when deleting block fails', async () => {
			// Arrange
			jest.spyOn(chainInstance.dataAccess, 'getBlockByID').mockResolvedValue(genesisBlock as never);

			const block = await createValidDefaultBlock();
			when(db.get)
				.calledWith(concatKeys(DB_KEY_DIFF_STATE, formatInt(block.header.height)))
				.mockResolvedValue(emptyEncodedDiff as never);

			const deleteBlockError = new Error('Delete block failed');
			batchMock.write.mockRejectedValue(deleteBlockError);

			// Act & Assert
			await expect(chainInstance.removeBlock(block, stateStoreStub)).rejects.toEqual(
				deleteBlockError,
			);
		});

		it('should not create entry in temp block table when saveToTemp flag is false', async () => {
			// Arrange
			jest.spyOn(chainInstance.dataAccess, 'getBlockByID').mockResolvedValue(genesisBlock as never);
			const block = await createValidDefaultBlock();
			when(db.get)
				.calledWith(concatKeys(DB_KEY_DIFF_STATE, formatInt(block.header.height)))
				.mockResolvedValue(emptyEncodedDiff as never);
			// Act
			await chainInstance.removeBlock(block, stateStoreStub);
			// Assert
			expect(batchMock.put).not.toHaveBeenCalledWith(
				concatKeys(DB_KEY_TEMPBLOCKS_HEIGHT, formatInt(block.header.height)),
				block,
			);
		});

		it('should create entry in temp block with full block when saveTempBlock is true', async () => {
			// Arrange
			jest.spyOn(chainInstance.dataAccess, 'getBlockByID').mockResolvedValue(genesisBlock as never);
			const tx = getTransaction();
			const block = await createValidDefaultBlock({ payload: [tx] });
			when(db.get)
				.calledWith(concatKeys(DB_KEY_DIFF_STATE, formatInt(block.header.height)))
				.mockResolvedValue(emptyEncodedDiff as never);
			// Act
			await chainInstance.removeBlock(block, stateStoreStub, {
				saveTempBlock: true,
			});
			// Assert
			expect(batchMock.put).toHaveBeenCalledWith(
				concatKeys(DB_KEY_TEMPBLOCKS_HEIGHT, formatInt(block.header.height)),
				encodedDefaultBlock(block),
			);
		});

		it('should emit block and accounts', async () => {
			// Arrange
			jest.spyOn((chainInstance as any).events, 'emit');
			const block = await createValidDefaultBlock();

			// Act
			await chainInstance.saveBlock(block, stateStoreStub, 0);

			// Assert
			expect((chainInstance as any).events.emit).toHaveBeenCalledWith('EVENT_NEW_BLOCK', {
				accounts: fakeAccounts,
				block,
			});
		});
	});

	describe('getValidators', () => {
		const defaultMinActiveHeight = 104;
		let validators: Validator[];

		beforeEach(() => {
			const addresses = [];
			for (let i = 0; i < 103; i += 1) {
				addresses.push(getRandomBytes(20));
			}
			validators = addresses.map(addr => ({
				address: addr,
				minActiveHeight: defaultMinActiveHeight,
				isConsensusParticipant: true,
			}));
			const validatorBuffer = codec.encode(validatorsSchema, {
				validators,
			});
			when(db.get)
				.calledWith(concatKeys(DB_KEY_CONSENSUS_STATE, CONSENSUS_STATE_VALIDATORS_KEY))
				.mockResolvedValue(validatorBuffer as never);
		});

		it('should return current set of validators', async () => {
			const currentValidators = await chainInstance.getValidators();
			expect(currentValidators).toEqual(validators);
		});
	});

	describe('getValidator', () => {
		const defaultMinActiveHeight = 104;
		let validators: Validator[];

		beforeEach(() => {
			const addresses = [];
			for (let i = 0; i < 103; i += 1) {
				addresses.push(getRandomBytes(20));
			}
			validators = addresses.map(addr => ({
				address: addr,
				minActiveHeight: defaultMinActiveHeight,
				isConsensusParticipant: true,
			}));
			const validatorBuffer = codec.encode(validatorsSchema, {
				validators,
			});
			when(db.get)
				.calledWith(concatKeys(DB_KEY_CONSENSUS_STATE, CONSENSUS_STATE_VALIDATORS_KEY))
				.mockResolvedValue(validatorBuffer as never);
		});

		it('should return current validator based on the timestamp and round robin from genesis timestamp', async () => {
			const validator = await chainInstance.getValidator(genesisBlock.header.timestamp);
			expect(validator.address).toEqual(validators[0].address);
		});

		it('should return current validator based on the timestamp and round robin from genesis timestamp with offset 5', async () => {
			const validator = await chainInstance.getValidator(genesisBlock.header.timestamp + 50);
			expect(validator.address).toEqual(validators[5].address);
		});
	});

	describe('setValidators', () => {
		const defaultMinActiveHeight = 104;
		let stateStore: StateStore;
		let addresses: Buffer[];

		beforeEach(() => {
			addresses = [];
			for (let i = 0; i < 103; i += 1) {
				addresses.push(getRandomBytes(20));
			}
			const validatorBuffer = codec.encode(validatorsSchema, {
				validators: addresses.map(addr => ({
					address: addr,
					minActiveHeight: defaultMinActiveHeight,
					isConsensusParticipant: true,
				})),
			});
			chainInstance['_numberOfValidators'] = 103;
			when(db.get)
				.calledWith(concatKeys(DB_KEY_CONSENSUS_STATE, CONSENSUS_STATE_VALIDATORS_KEY))
				.mockResolvedValue(validatorBuffer as never);
		});

		it('should not affect validator if block is within bootstrap period', async () => {
			const validators = [{ address: addresses[0], isConsensusParticipant: true }];
			stateStore = createStateStore(db, [
				(await createValidDefaultBlock({ header: { height: 307 } })).header,
			]);
			const currentBlock = await createValidDefaultBlock({ header: { height: 308 } });
			jest.spyOn(stateStore.consensus, 'get');
			jest.spyOn(stateStore.consensus, 'set');

			await chainInstance.setValidators(validators, stateStore, currentBlock.header);

			expect(stateStore.consensus.get).not.toHaveBeenCalled();
			expect(stateStore.consensus.set).not.toHaveBeenCalled();
		});

		it('should affect validator if block is at the last height of bootstrap period', async () => {
			const validators = [{ address: addresses[0], isConsensusParticipant: true }];
			stateStore = createStateStore(db, [
				(await createValidDefaultBlock({ header: { height: 308 } })).header,
			]);
			const currentBlock = await createValidDefaultBlock({ header: { height: 309 } });
			jest.spyOn(stateStore.consensus, 'get');
			jest.spyOn(stateStore.consensus, 'set');

			await chainInstance.setValidators(validators, stateStore, currentBlock.header);

			expect(stateStore.consensus.get).toHaveBeenCalledTimes(1);
			expect(stateStore.consensus.set).toHaveBeenCalledTimes(1);

			const updatedValidatorsBuffer = await stateStore.consensus.get(
				CONSENSUS_STATE_VALIDATORS_KEY,
			);
			const { validators: updatedValidators } = codec.decode<{ validators: Validator[] }>(
				validatorsSchema,
				updatedValidatorsBuffer as Buffer,
			);

			expect(updatedValidators[0].address).toEqual(validators[0].address);
			expect(updatedValidators[0].isConsensusParticipant).toEqual(
				validators[0].isConsensusParticipant,
			);
		});

		it('should set address and isConsensusParticipant as the input', async () => {
			const validators = [{ address: addresses[0], isConsensusParticipant: true }];
			const currentBlock = await createValidDefaultBlock({ header: { height: 513 } });
			stateStore = createStateStore(db, [
				(await createValidDefaultBlock({ header: { height: 512 } })).header,
			]);
			await chainInstance.setValidators(validators, stateStore, currentBlock.header);

			const updatedValidatorsBuffer = await stateStore.consensus.get(
				CONSENSUS_STATE_VALIDATORS_KEY,
			);
			const { validators: updatedValidators } = codec.decode<{ validators: Validator[] }>(
				validatorsSchema,
				updatedValidatorsBuffer as Buffer,
			);

			expect(updatedValidators[0].address).toEqual(validators[0].address);
			expect(updatedValidators[0].isConsensusParticipant).toEqual(
				validators[0].isConsensusParticipant,
			);
		});

		it('should emit event EVENT_VALIDATORS_CHANGED', async () => {
			jest.spyOn((chainInstance as any).events, 'emit');
			const validators = [
				{ address: addresses[0], isConsensusParticipant: true, minActiveHeight: 104 },
			];
			const currentBlock = await createValidDefaultBlock({ header: { height: 513 } });
			stateStore = createStateStore(db, [
				(await createValidDefaultBlock({ header: { height: 512 } })).header,
			]);

			await chainInstance.setValidators(validators, stateStore, currentBlock.header);

			expect((chainInstance as any).events.emit).toHaveBeenCalledWith('EVENT_VALIDATORS_CHANGED', {
				validators,
			});
		});

		it('should set minActiveHeight to the next height (last block height + 2) if the address does not exist in the previous set', async () => {
			const validators = [
				{ address: getRandomBytes(20), isConsensusParticipant: false },
				{ address: addresses[0], isConsensusParticipant: true },
			];
			stateStore = createStateStore(db, [
				(await createValidDefaultBlock({ header: { height: 514 } })).header,
			]);
			const currentBlock = await createValidDefaultBlock({ header: { height: 515 } });
			await chainInstance.setValidators(validators, stateStore, currentBlock.header);

			const updatedValidatorsBuffer = await stateStore.consensus.get(
				CONSENSUS_STATE_VALIDATORS_KEY,
			);
			const { validators: updatedValidators } = codec.decode<{ validators: Validator[] }>(
				validatorsSchema,
				updatedValidatorsBuffer as Buffer,
			);

			expect(updatedValidators[0].address).toEqual(validators[0].address);
			expect(updatedValidators[0].isConsensusParticipant).toEqual(
				validators[0].isConsensusParticipant,
			);
			expect(updatedValidators[0].minActiveHeight).toEqual(516);

			expect(updatedValidators[1].address).toEqual(validators[1].address);
			expect(updatedValidators[1].isConsensusParticipant).toEqual(
				validators[1].isConsensusParticipant,
			);
			expect(updatedValidators[1].minActiveHeight).toEqual(defaultMinActiveHeight);
		});

		it('should set minActiveHeight should not be changed if the address exists in the previous set', async () => {
			const validators = [{ address: addresses[0], isConsensusParticipant: true }];
			stateStore = createStateStore(db, [
				(await createValidDefaultBlock({ header: { height: 512 } })).header,
			]);
			const currentBlock = await createValidDefaultBlock({ header: { height: 513 } });
			await chainInstance.setValidators(validators, stateStore, currentBlock.header);

			const updatedValidatorsBuffer = await stateStore.consensus.get(
				CONSENSUS_STATE_VALIDATORS_KEY,
			);
			const { validators: updatedValidators } = codec.decode<{ validators: Validator[] }>(
				validatorsSchema,
				updatedValidatorsBuffer as Buffer,
			);

			expect(updatedValidators[0].address).toEqual(validators[0].address);
			expect(updatedValidators[0].isConsensusParticipant).toEqual(
				validators[0].isConsensusParticipant,
			);
			expect(updatedValidators[0].minActiveHeight).toEqual(defaultMinActiveHeight);
		});
	});
});
