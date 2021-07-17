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
import { Block, Transaction } from '@liskhq/lisk-chain';
import { getRandomBytes } from '@liskhq/lisk-cryptography';
import { when } from 'jest-when';
import { TokenModule, TransferAsset } from '../../../../src/modules/token';
import {
	CHAIN_STATE_BURNT_FEE,
	GENESIS_BLOCK_MAX_BALANCE,
} from '../../../../src/modules/token/constants';
import { createAccount, createFakeDefaultAccount } from '../../../utils/node';
import { GenesisConfig } from '../../../../src';
import { createTransaction, mocks } from '../../../../src/testing';

describe('token module', () => {
	let tokenModule: TokenModule;
	let validTransaction: any;
	let senderAccount: any;
	let recipientAccount: any;
	let stateStore: any;
	let genesisBlock: any;
	let reducerHandler: any;
	const minRemainingBalance = '10';
	const genesisConfig: GenesisConfig = {
		baseFees: [
			{
				assetID: 0,
				baseFee: '10000000',
				moduleID: 2,
			},
		],
		bftThreshold: 67,
		blockTime: 10,
		communityIdentifier: 'lisk',
		maxPayloadLength: 15360,
		minFeePerByte: 1,
		rewards: {
			distance: 1,
			milestones: ['milestone'],
			offset: 2,
		},
		minRemainingBalance,
	};

	beforeEach(() => {
		tokenModule = new TokenModule(genesisConfig);
		validTransaction = createTransaction({
			moduleID: 2,
			assetClass: TransferAsset,
			asset: {
				amount: BigInt('100000000'),
				recipientAddress: Buffer.from('8f5685bf5dcb8c1d3b9bbc98cffb0d0c6077be17', 'hex'),
				data: 'moon',
			},
			nonce: BigInt(0),
			fee: BigInt('10000000'),
			passphrase: 'wear protect skill sentence lift enter wild sting lottery power floor neglect',
			networkIdentifier: Buffer.from(
				'e48feb88db5b5cf5ad71d93cdcd1d879b6d5ed187a36b0002cc34e0ef9883255',
				'hex',
			),
		});
		senderAccount = createFakeDefaultAccount({
			address: Buffer.from('8f5685bf5dcb8c1d3b9bbc98cffb0d0c6077be17', 'hex'),
			token: {
				balance: BigInt('1000000000000000'),
			},
		});
		recipientAccount = createFakeDefaultAccount({
			address: Buffer.from('8f5685bf5dcb8c1d3b9bbc98cffb0d0c6077be17', 'hex'),
			token: {
				balance: BigInt('1000000000000000'),
			},
		});
		genesisBlock = {
			header: {
				asset: {
					accounts: [senderAccount],
				},
			},
		};
		stateStore = new mocks.StateStoreMock({ accounts: [senderAccount, recipientAccount] });
		jest.spyOn(stateStore.account, 'getOrDefault').mockResolvedValue(senderAccount);
		jest.spyOn(stateStore.account, 'get').mockResolvedValue(senderAccount);
		jest.spyOn(stateStore.account, 'set');
		jest.spyOn(stateStore.chain, 'get');
		jest.spyOn(stateStore.chain, 'set');

		reducerHandler = {};
	});

	describe('#reducers.credit', () => {
		it('should throw error if address is not a buffer', async () => {
			return expect(
				tokenModule.reducers.credit({ address: 'address', amount: BigInt('1000') }, stateStore),
			).rejects.toStrictEqual(new Error('Address must be a buffer'));
		});

		it('should throw error if amount is not a bigint', async () => {
			return expect(
				tokenModule.reducers.credit({ address: senderAccount.address, amount: '1000' }, stateStore),
			).rejects.toStrictEqual(new Error('Amount must be a bigint'));
		});

		it('should throw error if amount is zero', async () => {
			senderAccount.token.balance = BigInt(0);

			return expect(
				tokenModule.reducers.credit(
					{ address: senderAccount.address, amount: BigInt('0') },
					stateStore,
				),
			).rejects.toThrow('Amount must be a positive bigint.');
		});

		it('should throw error if amount is less than zero', async () => {
			senderAccount.token.balance = BigInt(0);

			return expect(
				tokenModule.reducers.credit(
					{ address: senderAccount.address, amount: BigInt(-10) },
					stateStore,
				),
			).rejects.toThrow('Amount must be a positive bigint.');
		});

		it('should throw error if account does not have sufficient balance', async () => {
			senderAccount.token.balance = BigInt(0);

			return expect(
				tokenModule.reducers.credit(
					{ address: senderAccount.address, amount: BigInt('1') },
					stateStore,
				),
			).rejects.toStrictEqual(
				new Error(`Remaining balance must be greater than ${minRemainingBalance}`),
			);
		});

		it('should credit target account', async () => {
			await tokenModule.reducers.credit(
				{ address: senderAccount.address, amount: BigInt('1000') },
				stateStore,
			);
			const expected = {
				...senderAccount,
				token: {
					...senderAccount.token,
					balance: (senderAccount.token.balance += BigInt('1000')),
				},
			};
			expect(stateStore.account.set).toHaveBeenCalledWith(senderAccount.address, expected);
		});
	});

	describe('#reducers.debit', () => {
		it('should throw error if address is not a buffer', async () => {
			return expect(
				tokenModule.reducers.debit({ address: 'address', amount: BigInt('1000') }, stateStore),
			).rejects.toStrictEqual(new Error('Address must be a buffer'));
		});

		it('should throw error if amount is not a bigint', async () => {
			return expect(
				tokenModule.reducers.debit({ address: senderAccount.address, amount: '1000' }, stateStore),
			).rejects.toStrictEqual(new Error('Amount must be a bigint'));
		});

		it('should throw error if account does not have sufficient balance', async () => {
			senderAccount.token.balance = BigInt(0);

			return expect(
				tokenModule.reducers.debit(
					{ address: senderAccount.address, amount: BigInt('1000') },
					stateStore,
				),
			).rejects.toStrictEqual(
				new Error(`Remaining balance must be greater than ${minRemainingBalance}`),
			);
		});

		it('should debit target account', async () => {
			await tokenModule.reducers.credit(
				{ address: senderAccount.address, amount: BigInt('1000') },
				stateStore,
			);
			const expected = {
				...senderAccount,
				token: {
					...senderAccount.token,
					balance: (senderAccount.token.balance -= BigInt('1000')),
				},
			};
			expect(stateStore.account.set).toHaveBeenCalledWith(senderAccount.address, expected);
		});
	});

	describe('#reducers.getBalance', () => {
		it('should throw error if address is not a buffer', async () => {
			return expect(
				tokenModule.reducers.getBalance({ address: 'address' }, stateStore),
			).rejects.toStrictEqual(new Error('Address must be a buffer'));
		});

		it('should should return account balance', async () => {
			return expect(
				tokenModule.reducers.getBalance({ address: senderAccount.address }, stateStore),
			).resolves.toBe(senderAccount.token.balance);
		});
	});

	describe('#beforeTransactionApply', () => {
		it('should deduct transaction fee from sender account', async () => {
			const expectedSenderAccount = {
				...senderAccount,
				token: {
					...senderAccount.token,
					balance: senderAccount.token.balance - validTransaction.fee,
				},
			};

			await tokenModule.beforeTransactionApply({
				stateStore,
				transaction: validTransaction,
				reducerHandler,
			});

			expect(stateStore.account.set).toHaveBeenCalledWith(
				senderAccount.address,
				expectedSenderAccount,
			);
		});
	});

	describe('#afterTransactionApply', () => {
		it('should not throw error if account has sufficient balance', async () => {
			return expect(
				tokenModule.afterTransactionApply({
					stateStore,
					transaction: validTransaction,
					reducerHandler,
				}),
			).resolves.toBeUndefined();
		});

		it('should throw error when sender balance is below the minimum required balance', async () => {
			senderAccount.token.balance = BigInt(0);

			return expect(
				tokenModule.afterTransactionApply({
					stateStore,
					transaction: validTransaction,
					reducerHandler,
				}),
			).rejects.toStrictEqual(
				new Error(
					// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
					`Account ${senderAccount.address.toString(
						'hex',
					)} does not meet the minimum remaining balance requirement: ${minRemainingBalance}.`,
				),
			);
		});
	});

	describe('#afterBlockApply', () => {
		let block: Block;
		let minFee: bigint;
		let tx: any;
		let generatorAccount: any;

		beforeEach(() => {
			const generator = createAccount();
			generatorAccount = createFakeDefaultAccount({
				address: generator.address,
			});
			tx = new Transaction({
				moduleID: 2,
				assetID: 0,
				asset: getRandomBytes(200),
				nonce: BigInt(0),
				senderPublicKey: getRandomBytes(32),
				signatures: [getRandomBytes(20)],
				fee: BigInt(20000000),
			});
			block = ({
				header: {
					generatorPublicKey: generator.publicKey,
					reward: BigInt(100000000),
				},
				payload: [tx],
			} as unknown) as Block;
			minFee =
				BigInt(genesisConfig.minFeePerByte) * BigInt(tx.getBytes().length) +
				BigInt(genesisConfig.baseFees[0].baseFee);
			when(stateStore.account.get)
				.calledWith(generator.address)
				.mockResolvedValue(generatorAccount as never);
		});

		describe('when block contains transactions', () => {
			it('should update generator balance to give rewards and fees - minFee', async () => {
				// eslint-disable-next-line @typescript-eslint/restrict-plus-operands
				let expected = generatorAccount.token.balance + block.header.reward;
				for (const transaction of block.payload) {
					expected += transaction.fee - minFee;
				}
				await tokenModule.afterBlockApply({
					block,
					stateStore,
					reducerHandler,
					consensus: {} as any,
				});

				expect(generatorAccount.token.balance).toEqual(expected);
			});

			it('should update burntFee in the chain state', async () => {
				const expected = minFee;
				const expectedBuffer = Buffer.alloc(8);
				expectedBuffer.writeBigInt64BE(expected);
				await tokenModule.afterBlockApply({
					block,
					stateStore,
					reducerHandler,
					consensus: {} as any,
				});

				expect(stateStore.chain.set).toHaveBeenCalledWith(CHAIN_STATE_BURNT_FEE, expectedBuffer);
			});
		});

		describe('when block does not contain transactions', () => {
			it('should update generator balance to give rewards', async () => {
				block.payload = [];
				const expected = BigInt(generatorAccount.token.balance) + block.header.reward;
				await tokenModule.afterBlockApply({
					block,
					stateStore,
					reducerHandler,
					consensus: {} as any,
				});

				expect(generatorAccount.token.balance).toEqual(expected);
			});

			it('should not have updated burnt fee', () => {
				expect(stateStore.chain.set).not.toHaveBeenCalled();
			});
		});
	});

	describe('#afterGenesisBlockApply', () => {
		it('should not throw error if total genesis accounts balance does not exceed limit', async () => {
			return expect(
				tokenModule.afterGenesisBlockApply({
					stateStore,
					genesisBlock,
					reducerHandler,
				}),
			).resolves.toBeUndefined();
		});

		it('should throw error if total genesis accounts balance exceeds limit', async () => {
			senderAccount.token.balance = BigInt(GENESIS_BLOCK_MAX_BALANCE) + BigInt(1);
			return expect(
				tokenModule.afterGenesisBlockApply({
					stateStore,
					genesisBlock,
					reducerHandler,
				}),
			).rejects.toStrictEqual(new Error('Total balance exceeds the limit (2^63)-1'));
		});
	});
});
