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

import { formatInt, NotFoundError } from '@liskhq/lisk-db';
import {
	Block,
	stateDiffSchema,
	Account,
	Transaction,
	CONSENSUS_STATE_VALIDATORS_KEY,
} from '@liskhq/lisk-chain';
import { codec } from '@liskhq/lisk-codec';

import { nodeUtils } from '../../../utils';
import { genesis, DefaultAccountProps } from '../../../fixtures';
import { createTransferTransaction } from '../../../utils/node/transaction';
import * as testing from '../../../../src/testing';
import { Processor } from '../../../../src/node/processor';

describe('Delete block', () => {
	let processEnv: testing.BlockProcessingEnv;
	let networkIdentifier: Buffer;
	let processor: Processor;
	const databasePath = '/tmp/lisk/delete_block/test';
	const emptyDiffState = codec.encode(stateDiffSchema, {
		updated: [],
		created: [],
		deleted: [],
	});

	beforeAll(async () => {
		processEnv = await testing.getBlockProcessingEnv({
			options: {
				databasePath,
			},
		});
		networkIdentifier = processEnv.getNetworkId();
		processor = processEnv.getProcessor();
	});

	afterAll(async () => {
		await processEnv.cleanup({ databasePath });
	});

	describe('given there is only a genesis block', () => {
		describe('when deleteLastBlock is called', () => {
			it('should fail to delete genesis block', async () => {
				await expect(processEnv.getProcessor().deleteLastBlock()).rejects.toEqual(
					expect.objectContaining({
						message: expect.stringContaining(
							'Can not delete block below or same as finalized height',
						),
					}),
				);
			});
		});
	});

	describe('given there a valid block with transfer transaction is forged', () => {
		const recipientAccount = nodeUtils.createAccount();

		let newBlock: Block;
		let transaction: Transaction;
		let genesisAccount: Account<DefaultAccountProps>;

		describe('when deleteLastBlock is called', () => {
			beforeEach(async () => {
				genesisAccount = await processEnv
					.getDataAccess()
					.getAccountByAddress<DefaultAccountProps>(genesis.address);
				transaction = createTransferTransaction({
					nonce: genesisAccount.sequence.nonce,
					recipientAddress: recipientAccount.address,
					amount: BigInt('100000000000'),
					networkIdentifier,
					passphrase: genesis.passphrase,
				});
				newBlock = await processEnv.createBlock([transaction]);
				await processEnv
					.getBlockchainDB()
					.put(
						Buffer.concat([Buffer.from('diff:', 'utf8'), formatInt(newBlock.header.height)]),
						emptyDiffState,
					);
				await processEnv.process(newBlock);
				await processor.deleteLastBlock();
			});

			it('should delete the block from the database', async () => {
				await expect(
					processEnv.getDataAccess().isBlockPersisted(newBlock.header.id),
				).resolves.toBeFalse();
			});

			it('should delete the transactions from the database', async () => {
				await expect(
					processEnv.getDataAccess().isTransactionPersisted(transaction.id),
				).resolves.toBeFalse();
			});

			it('should match the sender account to the original state', async () => {
				const genesisAfter = await processEnv
					.getDataAccess()
					.getAccountByAddress<DefaultAccountProps>(genesis.address);
				expect(genesisAfter.token.balance.toString()).toEqual(
					genesisAccount.token.balance.toString(),
				);
			});

			it('should not persist virgin recipient account', async () => {
				await expect(
					processEnv.getDataAccess().getAccountByAddress(recipientAccount.address),
				).rejects.toBeInstanceOf(NotFoundError);
			});

			it('should not persist the state diff for that block height', async () => {
				await expect(
					processEnv
						.getBlockchainDB()
						.get(Buffer.concat([Buffer.from('diff:', 'utf8'), formatInt(newBlock.header.height)])),
				).rejects.toBeInstanceOf(NotFoundError);
			});
		});
	});

	describe('given an block that introduces account state change', () => {
		describe('when the deleteLastBlock is called', () => {
			it('should rollback all the accounts to the previous state', async () => {
				// Arrange
				const genesisAccount = await processEnv
					.getDataAccess()
					.getAccountByAddress<DefaultAccountProps>(genesis.address);
				const genesisBalance = genesisAccount.token.balance;
				const recipientAccount = nodeUtils.createAccount();
				const transaction1 = createTransferTransaction({
					nonce: genesisAccount.sequence.nonce,
					recipientAddress: recipientAccount.address,
					amount: BigInt('100000000000'),
					networkIdentifier,
					passphrase: genesis.passphrase,
				});
				const newBlock = await processEnv.createBlock([transaction1]);
				await processEnv.process(newBlock);
				await processor.deleteLastBlock();
				// Assert
				await expect(
					processEnv.getDataAccess().getAccountByAddress(recipientAccount.address),
				).rejects.toThrow(
					`Specified key ${Buffer.concat([
						Buffer.from('accounts:address:', 'utf8'),
						recipientAccount.address,
					]).toString('hex')} does not exist`,
				);
				const revertedGenesisAccount = await processEnv
					.getDataAccess()
					.getAccountByAddress<DefaultAccountProps>(genesisAccount.address);
				expect(revertedGenesisAccount.token.balance).toEqual(genesisBalance);
			});
		});
	});

	describe('given an block that introduces consensus state change', () => {
		describe('when the deleteLastBlock is called', () => {
			it('should rollback validators to the previous state', async () => {
				// Arrange
				const lastBootstrapHeight = processEnv.getChain()['_getLastBootstrapHeight']();
				while (processEnv.getLastBlock().header.height !== lastBootstrapHeight - 1) {
					const newBlock = await processEnv.createBlock([]);
					await processEnv.process(newBlock);
				}
				const consensusStateBefore = await processEnv
					.getDataAccess()
					.getConsensusState(CONSENSUS_STATE_VALIDATORS_KEY);
				const newBlock = await processEnv.createBlock([]);
				await processEnv.process(newBlock);
				const consensusStateAfter = await processEnv
					.getDataAccess()
					.getConsensusState(CONSENSUS_STATE_VALIDATORS_KEY);
				expect(consensusStateBefore).not.toEqual(consensusStateAfter);
				await processor.deleteLastBlock();
				const consensusStateReverted = await processEnv
					.getDataAccess()
					.getConsensusState(CONSENSUS_STATE_VALIDATORS_KEY);
				expect(consensusStateReverted).toEqual(consensusStateBefore);
			});
		});
	});
});
