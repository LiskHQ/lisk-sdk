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

import { TransferAsset } from '../../../../src/modules/token';
import { MAX_TRANSACTION_AMOUNT } from '../../../../src/modules/token/constants';
import { createFakeDefaultAccount } from '../../../utils/node';
import { createTransaction, mocks } from '../../../../src/testing';

describe('Transfer asset', () => {
	let asset: any;
	let validTransaction: any;
	let sender: any;
	let recipient: any;
	let stateStore: any;
	let storeAccountGetOrDefaultStub: jest.SpyInstance;
	let storeAccountSetStub: jest.SpyInstance;
	let transferAsset: TransferAsset;
	let reducerHandler: any;
	const minRemainingBalance = '1';

	beforeEach(() => {
		asset = {
			amount: BigInt('100000000'),
			recipientAddress: Buffer.from('8f5685bf5dcb8c1d3b9bbc98cffb0d0c6077be17', 'hex'),
			data: 'moon',
		};
		validTransaction = createTransaction({
			moduleID: 2,
			assetClass: TransferAsset,
			asset,
			nonce: BigInt(0),
			fee: BigInt('10000000'),
			passphrase: 'wear protect skill sentence lift enter wild sting lottery power floor neglect',
			networkIdentifier: Buffer.from(
				'e48feb88db5b5cf5ad71d93cdcd1d879b6d5ed187a36b0002cc34e0ef9883255',
				'hex',
			),
		});
		transferAsset = new TransferAsset(BigInt(minRemainingBalance));
		sender = createFakeDefaultAccount({
			address: Buffer.from('8f5685bf5dcb8c1d3b9bbc98cffb0d0c6077be17', 'hex'),
			token: {
				balance: BigInt('1000000000000000'),
			},
		});
		recipient = createFakeDefaultAccount({
			address: Buffer.from('8f5685bf5dcb8c1d3b9bbc98cffb0d0c6077be17', 'hex'),
			token: {
				balance: BigInt('1000000000000000'),
			},
		});
		stateStore = new mocks.StateStoreMock({ accounts: [sender, recipient] });
		storeAccountGetOrDefaultStub = jest
			.spyOn(stateStore.account, 'getOrDefault')
			.mockResolvedValue(recipient);
		jest.spyOn(stateStore.account, 'get').mockResolvedValue(sender);
		storeAccountSetStub = jest.spyOn(stateStore.account, 'set');
		reducerHandler = {};
	});

	describe('#applyAsset', () => {
		it('should return not throw error with a valid transfer asset', () => {
			expect(async () =>
				transferAsset.apply({
					asset,
					stateStore,
					reducerHandler,
					transaction: validTransaction,
				}),
			).not.toThrow();
		});

		it('should call state store with a valid transfer asset', async () => {
			await transferAsset.apply({
				asset,
				stateStore,
				reducerHandler,
				transaction: validTransaction,
			});
			expect(stateStore.account.get).toHaveBeenCalledWith(validTransaction.senderAddress);
			expect(storeAccountSetStub).toHaveBeenCalledWith(
				sender.address,
				expect.objectContaining({
					address: sender.address,
				}),
			);
			expect(stateStore.account.getOrDefault).toHaveBeenCalledWith(asset.recipientAddress);
			expect(stateStore.account.set).toHaveBeenCalledWith(
				recipient.address,
				expect.objectContaining({
					address: recipient.address,
				}),
			);
		});

		it('should throw error when recipient balance is over maximum amount', async () => {
			storeAccountGetOrDefaultStub.mockResolvedValue({
				...recipient,
				token: {
					...recipient.token,
					balance: BigInt(MAX_TRANSACTION_AMOUNT),
				},
			});
			return expect(async () =>
				transferAsset.apply({
					asset,
					stateStore,
					reducerHandler,
					transaction: validTransaction,
				}),
			).rejects.toStrictEqual(
				new Error(
					`Invalid transfer amount: ${asset.amount.toString()}. Maximum allowed balance for recipient is: ${MAX_TRANSACTION_AMOUNT}`,
				),
			);
		});

		it('should throw error when recipient balance is below minimum remaining balance', async () => {
			storeAccountGetOrDefaultStub.mockResolvedValue({
				...recipient,
				token: {
					...recipient.token,
					balance: BigInt(0),
				},
			});
			return expect(async () =>
				transferAsset.apply({
					asset: { ...validTransaction.asset, amount: BigInt(0) },
					stateStore,
					reducerHandler,
					transaction: validTransaction,
				}),
			).rejects.toStrictEqual(
				new Error(
					`Recipient account ${recipient.address.toString(
						'hex',
					)} does not meet the minimum remaining balance requirement: ${minRemainingBalance}.`,
				),
			);
		});
	});
});
