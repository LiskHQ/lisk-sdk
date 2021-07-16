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
 */

import { ForkStatus } from '@liskhq/lisk-bft';
import { Block, Chain } from '@liskhq/lisk-chain';
import { KVStore } from '@liskhq/lisk-db';
import { ApplyPenaltyError } from '../../../../src/errors';
import { Consensus } from '../../../../src/node/consensus/consensus';
import { Endpoint } from '../../../../src/node/consensus/endpoints';
import { Synchronizer } from '../../../../src/node/consensus/synchronizer';
import {
	ApplyPenaltyAndRestartError,
	RestartError,
	AbortError,
} from '../../../../src/node/consensus/synchronizer/errors';
import { Network } from '../../../../src/node/network';
import { StateMachine } from '../../../../src/node/state_machine/state_machine';
import { loggerMock } from '../../../../src/testing/mocks';
import { createValidDefaultBlock, encodeValidBlock, genesisBlock } from '../../../fixtures';

describe('consensus', () => {
	const genesis = (genesisBlock() as unknown) as Block;

	let consensus: Consensus;
	let chain: Chain;
	let network: Network;
	let stateMachine: StateMachine;

	beforeEach(async () => {
		const lastBlock = await createValidDefaultBlock({ header: { height: 1 } });
		chain = ({
			genesisBlockExist: jest.fn().mockResolvedValue(true),
			validateGenesisBlockHeader: jest.fn(),
			newStateStore: jest.fn().mockResolvedValue({}),
			applyGenesisBlock: jest.fn(),
			saveBlock: jest.fn(),
			init: jest.fn(),
			dataAccess: {
				decode: jest.fn(),
			},
			lastBlock,
			validateBlockHeader: jest.fn(),
			verifyBlockHeader: jest.fn(),
			validateTransaction: jest.fn(),
			removeBlock: jest.fn(),
		} as unknown) as Chain;
		network = ({
			registerEndpoint: jest.fn(),
			applyPenaltyOnPeer: jest.fn(),
			send: jest.fn(),
		} as unknown) as Network;
		stateMachine = ({
			executeGenesisBlock: jest.fn(),
			verifyBlock: jest.fn(),
			executeBlock: jest.fn(),
		} as unknown) as StateMachine;
		consensus = new Consensus({
			chain,
			network,
			stateMachine,
		});
		jest.spyOn(consensus['_bft'], 'init').mockResolvedValue();
	});

	describe('init', () => {
		it('should instantiate synchronizer', async () => {
			(chain.genesisBlockExist as jest.Mock).mockResolvedValue(true);
			await consensus.init({
				logger: loggerMock,
				db: {} as KVStore,
				genesisBlock: genesis,
			});
			expect(consensus['_synchronizer']).toBeInstanceOf(Synchronizer);
		});

		it('should instantiate endpoint', async () => {
			(chain.genesisBlockExist as jest.Mock).mockResolvedValue(true);
			await consensus.init({
				logger: loggerMock,
				db: {} as KVStore,
				genesisBlock: genesis,
			});
			expect(consensus['_endpoint']).toBeInstanceOf(Endpoint);
		});

		it('should register endpoints', async () => {
			(chain.genesisBlockExist as jest.Mock).mockResolvedValue(true);
			await consensus.init({
				logger: loggerMock,
				db: {} as KVStore,
				genesisBlock: genesis,
			});
			expect(network.registerEndpoint).toHaveBeenCalledTimes(3);
		});

		it('should execute genesis block if genesis block does not exist', async () => {
			(chain.genesisBlockExist as jest.Mock).mockResolvedValue(false);
			await consensus.init({
				logger: loggerMock,
				db: {} as KVStore,
				genesisBlock: genesis,
			});

			expect(chain.validateGenesisBlockHeader).toHaveBeenCalledTimes(1);
			expect(chain.applyGenesisBlock).toHaveBeenCalledTimes(1);
			expect(chain.saveBlock).toHaveBeenCalledTimes(1);
			expect(stateMachine.executeGenesisBlock).toHaveBeenCalledTimes(1);
			expect(chain.init).toHaveBeenCalledTimes(1);
			expect(consensus['_bft'].init).toHaveBeenCalledTimes(1);
		});

		it('should not execute genesis block if it exists in chain', async () => {
			(chain.genesisBlockExist as jest.Mock).mockResolvedValue(true);
			await consensus.init({
				logger: loggerMock,
				db: {} as KVStore,
				genesisBlock: genesis,
			});
			expect(chain.saveBlock).not.toHaveBeenCalled();
			expect(stateMachine.executeGenesisBlock).not.toHaveBeenCalled();
			expect(chain.init).toHaveBeenCalledTimes(1);
			expect(consensus['_bft'].init).toHaveBeenCalledTimes(1);
		});
	});

	describe('onBlockReceive', () => {
		const peerID = 'peer-id';
		beforeEach(async () => {
			await consensus.init({
				logger: loggerMock,
				db: {} as KVStore,
				genesisBlock: genesis,
			});
		});

		it('should not execute when syncing', async () => {
			jest.spyOn(consensus, 'syncing').mockReturnValue(true);
			await consensus.onBlockReceive(Buffer.alloc(0), peerID);
			expect(network.applyPenaltyOnPeer).not.toHaveBeenCalled();
		});

		it('should apply when data is not Buffer', async () => {
			await consensus.onBlockReceive('not buffer', peerID);
			expect(network.applyPenaltyOnPeer).toHaveBeenCalledTimes(1);
		});

		it('should apply penalty on the peer when data format is invalid', async () => {
			const invalidBytes = Buffer.from([244, 21, 21]);

			await expect(consensus.onBlockReceive(invalidBytes, peerID)).rejects.toThrow();
			expect(network.applyPenaltyOnPeer).toHaveBeenCalledTimes(1);
		});

		it('should apply penalty on the peer when execute fail with penalty error', async () => {
			const validBlock = await createValidDefaultBlock();
			const encodedValidBlock = encodeValidBlock(validBlock);

			jest.spyOn(consensus, '_execute' as any).mockRejectedValue(new ApplyPenaltyError());

			await expect(consensus.onBlockReceive(encodedValidBlock, peerID)).rejects.toThrow();
			expect(network.applyPenaltyOnPeer).toHaveBeenCalledTimes(1);
		});

		it('should not apply penalty on the peer when execute fail with other error', async () => {
			const validBlock = await createValidDefaultBlock();
			const encodedValidBlock = encodeValidBlock(validBlock);

			jest.spyOn(consensus, '_execute' as any).mockRejectedValue(new Error());

			await expect(consensus.onBlockReceive(encodedValidBlock, peerID)).rejects.toThrow();
			expect(network.applyPenaltyOnPeer).not.toHaveBeenCalled();
		});

		it('should execute block', async () => {
			const validBlock = await createValidDefaultBlock();
			const encodedValidBlock = encodeValidBlock(validBlock);
			jest.spyOn(consensus, '_execute' as any).mockResolvedValue(undefined);

			await expect(consensus.onBlockReceive(encodedValidBlock, peerID)).resolves.toBeUndefined();
			expect(network.applyPenaltyOnPeer).not.toHaveBeenCalled();
			expect(consensus['_execute']).toHaveBeenCalledTimes(1);
		});

		describe('when block is executed', () => {
			let block: Block;
			beforeEach(async () => {
				block = await createValidDefaultBlock({ header: { height: 2 } });
				jest.spyOn(chain.dataAccess, 'decode').mockReturnValue(block);
			});

			describe('when the fork step returns unknown fork status', () => {
				it('should throw an error', async () => {
					jest.spyOn(consensus['_bft'], 'forkChoice').mockReturnValue('unknown' as any);
					await expect(consensus.onBlockReceive(encodeValidBlock(block), peerID)).rejects.toThrow(
						'Unknown fork status',
					);
				});
			});

			describe('when the fork step returns ForkStatus.IDENTICAL_BLOCK', () => {
				beforeEach(async () => {
					jest.spyOn(consensus['_bft'], 'forkChoice').mockReturnValue(ForkStatus.IDENTICAL_BLOCK);
					jest.spyOn(consensus, '_validate' as any);
					jest.spyOn(consensus, '_executeValidated' as any);
					await consensus.onBlockReceive(encodeValidBlock(block), peerID);
				});

				it('should not validate block', () => {
					expect(consensus['_validate']).not.toHaveBeenCalled();
				});

				it('should not execute block', () => {
					expect(consensus['_executeValidated']).not.toHaveBeenCalled();
				});
			});

			describe('when the fork step returns ForkStatus.DOUBLE_FORGING', () => {
				beforeEach(async () => {
					jest.spyOn(consensus['_bft'], 'forkChoice').mockReturnValue(ForkStatus.DOUBLE_FORGING);
					jest.spyOn(consensus.events, 'emit');
					jest.spyOn(consensus, '_validate' as any);
					jest.spyOn(consensus, '_executeValidated' as any);
					await consensus.onBlockReceive(encodeValidBlock(block), peerID);
				});

				it('should not validate block', () => {
					expect(consensus['_validate']).not.toHaveBeenCalled();
				});

				it('should not execute block', () => {
					expect(consensus['_executeValidated']).not.toHaveBeenCalled();
				});

				it('should publish fork event', () => {
					expect(consensus.events.emit).toHaveBeenCalledTimes(1);
				});
			});

			describe('when the fork step returns ForkStatus.TIE_BREAK and success to execute', () => {
				beforeEach(async () => {
					jest.spyOn(consensus['_bft'], 'forkChoice').mockReturnValue(ForkStatus.TIE_BREAK);
					jest.spyOn(consensus.events, 'emit');
					jest.spyOn(consensus, '_validate' as any);
					jest.spyOn(consensus, '_executeValidated' as any).mockResolvedValue(undefined);
					Object.defineProperty(consensus['_bft'], 'finalizedHeight', {
						get: jest.fn(() => 0),
					});
					await consensus.onBlockReceive(encodeValidBlock(block), peerID);
				});

				it('should publish fork event', () => {
					expect(consensus.events.emit).toHaveBeenCalledTimes(1);
				});

				it('should validate block', () => {
					expect(consensus['_validate']).toHaveBeenCalledWith(block);
				});

				it('should revert the last block', () => {
					expect(chain.removeBlock).toHaveBeenCalledTimes(1);
				});

				it('should execute the block', () => {
					expect(consensus['_executeValidated']).toHaveBeenCalledWith(block);
				});
			});

			describe('when the fork step returns ForkStatus.TIE_BREAK and fail to execute', () => {
				beforeEach(async () => {
					jest.spyOn(consensus['_bft'], 'forkChoice').mockReturnValue(ForkStatus.TIE_BREAK);
					jest.spyOn(consensus.events, 'emit');
					jest.spyOn(consensus, '_validate' as any);
					jest
						.spyOn(consensus, '_executeValidated' as any)
						.mockRejectedValueOnce(new Error('invalid block'));
					jest.spyOn(consensus, '_executeValidated' as any).mockResolvedValueOnce(undefined);
					Object.defineProperty(consensus['_bft'], 'finalizedHeight', {
						get: jest.fn(() => 0),
					});
					await consensus.onBlockReceive(encodeValidBlock(block), peerID);
				});

				it('should publish fork event', () => {
					expect(consensus.events.emit).toHaveBeenCalledTimes(1);
				});

				it('should validate block', () => {
					expect(consensus['_validate']).toHaveBeenCalledWith(block);
				});

				it('should revert the last block', () => {
					expect(chain.removeBlock).toHaveBeenCalledTimes(1);
				});

				it('should execute the last block', () => {
					expect(consensus['_executeValidated']).toHaveBeenCalledWith(chain.lastBlock, {
						skipBroadcast: true,
					});
					expect(consensus['_executeValidated']).toHaveBeenCalledTimes(2);
				});
			});

			describe('when the fork step returns ForkStatus.DIFFERENT_CHAIN', () => {
				beforeEach(async () => {
					jest.spyOn(consensus['_bft'], 'forkChoice').mockReturnValue(ForkStatus.DIFFERENT_CHAIN);
					jest.spyOn(consensus.events, 'emit');
					jest.spyOn(consensus, '_validate' as any);
					jest.spyOn(consensus, '_executeValidated' as any);
					jest.spyOn(consensus['_synchronizer'], 'run').mockResolvedValue(undefined);
					await consensus.onBlockReceive(encodeValidBlock(block), peerID);
				});

				it('should not validate block', () => {
					expect(consensus['_validate']).not.toHaveBeenCalled();
				});

				it('should not execute block', () => {
					expect(consensus['_executeValidated']).not.toHaveBeenCalled();
				});

				it('should publish fork event', () => {
					expect(consensus.events.emit).toHaveBeenCalledTimes(1);
				});

				it('should start sync', () => {
					expect(consensus['_synchronizer'].run).toHaveBeenCalledTimes(1);
				});
			});

			describe('when fork step returns ForkStatus.DIFFERENT_CHAIN and synchronizer fail once with ApplyPenaltyAndRestartError', () => {
				beforeEach(async () => {
					jest.spyOn(consensus['_bft'], 'forkChoice').mockReturnValue(ForkStatus.DIFFERENT_CHAIN);
					jest.spyOn(consensus.events, 'emit');
					jest.spyOn(consensus, '_validate' as any);
					jest.spyOn(consensus, '_executeValidated' as any);
					jest
						.spyOn(consensus['_synchronizer'], 'run')
						.mockRejectedValueOnce(new ApplyPenaltyAndRestartError('fail', 'reason'));
					jest.spyOn(consensus['_synchronizer'], 'run').mockResolvedValueOnce();
					await consensus.onBlockReceive(encodeValidBlock(block), peerID);
				});

				it('should call sync again after applying penalty', () => {
					expect(consensus['_synchronizer'].run).toHaveBeenCalledTimes(2);
					expect(network.applyPenaltyOnPeer).toHaveBeenCalledTimes(1);
				});
			});

			describe('when fork step returns ForkStatus.DIFFERENT_CHAIN and synchronizer fail once with RestartError', () => {
				beforeEach(async () => {
					jest.spyOn(consensus['_bft'], 'forkChoice').mockReturnValue(ForkStatus.DIFFERENT_CHAIN);
					jest.spyOn(consensus.events, 'emit');
					jest.spyOn(consensus, '_validate' as any);
					jest.spyOn(consensus, '_executeValidated' as any);
					jest
						.spyOn(consensus['_synchronizer'], 'run')
						.mockRejectedValueOnce(new RestartError('fail'));
					jest.spyOn(consensus['_synchronizer'], 'run').mockResolvedValueOnce();
					await consensus.onBlockReceive(encodeValidBlock(block), peerID);
				});

				it('should call sync again after applying penalty', () => {
					expect(consensus['_synchronizer'].run).toHaveBeenCalledTimes(2);
					expect(network.applyPenaltyOnPeer).not.toHaveBeenCalled();
				});
			});

			describe('when fork step returns ForkStatus.DIFFERENT_CHAIN and synchronizer fail once with AbortError', () => {
				beforeEach(async () => {
					jest.spyOn(consensus['_bft'], 'forkChoice').mockReturnValue(ForkStatus.DIFFERENT_CHAIN);
					jest.spyOn(consensus.events, 'emit');
					jest.spyOn(consensus, '_validate' as any);
					jest.spyOn(consensus, '_executeValidated' as any);
					jest
						.spyOn(consensus['_synchronizer'], 'run')
						.mockRejectedValueOnce(new AbortError('fail'));
					jest.spyOn(consensus['_synchronizer'], 'run').mockResolvedValueOnce();
					await consensus.onBlockReceive(encodeValidBlock(block), peerID);
				});

				it('should call sync again after applying penalty', () => {
					expect(consensus['_synchronizer'].run).toHaveBeenCalledTimes(1);
					expect(network.applyPenaltyOnPeer).not.toHaveBeenCalled();
				});
			});

			describe('when fork step returns ForkStatus.DIFFERENT_CHAIN and synchronizer fail once with Error', () => {
				beforeEach(() => {
					jest.spyOn(consensus['_bft'], 'forkChoice').mockReturnValue(ForkStatus.DIFFERENT_CHAIN);
					jest.spyOn(consensus.events, 'emit');
					jest.spyOn(consensus, '_validate' as any);
					jest.spyOn(consensus, '_executeValidated' as any);
					jest.spyOn(consensus['_synchronizer'], 'run').mockRejectedValueOnce(new Error('fail'));
					jest.spyOn(consensus['_synchronizer'], 'run').mockResolvedValueOnce();
				});

				it('should call sync again after applying penalty', async () => {
					await expect(consensus.onBlockReceive(encodeValidBlock(block), peerID)).rejects.toThrow();
					expect(consensus['_synchronizer'].run).toHaveBeenCalledTimes(1);
					expect(network.applyPenaltyOnPeer).not.toHaveBeenCalled();
				});
			});

			describe('when the fork step returns ForkStatus.DISCARD', () => {
				beforeEach(async () => {
					jest.spyOn(consensus['_bft'], 'forkChoice').mockReturnValue(ForkStatus.DISCARD);
					jest.spyOn(consensus.events, 'emit');
					jest.spyOn(consensus, '_validate' as any);
					jest.spyOn(consensus, '_executeValidated' as any).mockResolvedValue(undefined);
					await consensus.onBlockReceive(encodeValidBlock(block), peerID);
				});

				it('should not validate block', () => {
					expect(consensus['_validate']).not.toHaveBeenCalled();
				});

				it('should not execute block', () => {
					expect(consensus['_executeValidated']).not.toHaveBeenCalled();
				});

				it('should publish fork event', () => {
					expect(consensus.events.emit).toHaveBeenCalledTimes(1);
				});
			});

			describe('when the fork step returns ForkStatus.VALID_BLOCK', () => {
				beforeEach(async () => {
					jest.spyOn(consensus['_bft'], 'forkChoice').mockReturnValue(ForkStatus.VALID_BLOCK);
					jest.spyOn(consensus.events, 'emit');
					jest.spyOn(consensus, '_validate' as any);
					jest.spyOn(consensus, '_executeValidated' as any).mockResolvedValue(undefined);
					await consensus.onBlockReceive(encodeValidBlock(block), peerID);
				});

				it('should not validate block', () => {
					expect(consensus['_validate']).toHaveBeenCalledTimes(1);
				});

				it('should not execute block', () => {
					expect(consensus['_executeValidated']).toHaveBeenCalledWith(block);
					expect(consensus['_executeValidated']).toHaveBeenCalledTimes(1);
				});
			});
		});
	});

	describe('execute', () => {
		let block: Block;
		beforeEach(async () => {
			block = await createValidDefaultBlock({ header: { height: 2 } });
			jest.spyOn(chain, 'verifyBlockHeader').mockResolvedValue();
			jest.spyOn(chain, 'saveBlock').mockResolvedValue();
			jest.spyOn(consensus['_bft'], 'verifyBlockHeader').mockResolvedValue();
			Object.defineProperty(consensus['_bft'], 'finalizedHeight', {
				get: jest.fn(() => 0),
			});
			jest.spyOn(stateMachine, 'verifyBlock').mockResolvedValue();
			jest.spyOn(stateMachine, 'executeBlock').mockResolvedValue();
			jest.spyOn(consensus.events, 'emit');

			await consensus.execute(block);
		});

		it('should verify block header', () => {
			expect(chain.verifyBlockHeader).toHaveBeenCalledWith(block, expect.anything());
			expect(consensus['_bft'].verifyBlockHeader).toHaveBeenCalledWith(
				block.header,
				expect.anything(),
			);
		});

		it('should veryfy block using state machine', () => {
			expect(stateMachine.verifyBlock).toHaveBeenCalledTimes(1);
		});

		it('should call broadcast to the network', () => {
			expect(network.send).toHaveBeenCalledTimes(1);
			expect(consensus.events.emit).toHaveReturnedTimes(1);
		});

		it('should execute block using state machine', () => {
			expect(stateMachine.executeBlock).toHaveBeenCalledTimes(1);
		});

		it('should save block', () => {
			expect(chain.saveBlock).toHaveBeenCalledWith(block, expect.anything(), 0, {
				removeFromTempTable: false,
			});
		});
	});
});
