/*
 * Copyright © 2022 Lisk Foundation
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
import { intToBuffer, hash } from '@liskhq/lisk-cryptography';
import { sparseMerkleTree } from '@liskhq/lisk-tree';
import {
	CommandExecuteContext,
	CommandVerifyContext,
	VerificationResult,
	VerifyStatus,
} from '../../../../state_machine';
import { BaseInteroperabilityCommand } from '../../base_interoperability_command';
import {
	CHAIN_TERMINATED,
	COMMAND_ID_STATE_RECOVERY_INIT,
	EMPTY_BYTES,
	LIVENESS_LIMIT,
	MAINCHAIN_ID,
	MODULE_ID_INTEROPERABILITY,
	STORE_PREFIX_CHAIN_DATA,
	STORE_PREFIX_TERMINATED_STATE,
} from '../../constants';
import { chainAccountSchema, stateRecoveryInitParams, terminatedStateSchema } from '../../schema';
import {
	ChainAccount,
	StateRecoveryInitParams,
	StoreCallback,
	TerminatedStateAccount,
} from '../../types';
import { getIDAsKeyForStore } from '../../utils';
import { MainchainInteroperabilityStore } from '../store';

export class StateRecoveryInitCommand extends BaseInteroperabilityCommand {
	public name = 'stateRecoveryInitialization';
	public id = COMMAND_ID_STATE_RECOVERY_INIT;
	public schema = stateRecoveryInitParams;

	public async verify(
		context: CommandVerifyContext<StateRecoveryInitParams>,
	): Promise<VerificationResult> {
		const {
			getStore,
			params: { chainID, sidechainChainAccount, bitmap, siblingHashes },
		} = context;
		const chainIDBuffer = getIDAsKeyForStore(chainID);
		const interoperabilityStore = this.getInteroperabilityStore(getStore);
		const ownChainAccount = await interoperabilityStore.getOwnChainAccount();

		if (chainID === MAINCHAIN_ID || chainID === ownChainAccount.id) {
			return {
				status: VerifyStatus.FAIL,
				error: new Error(`Sidechain id is not valid`),
			};
		}

		const terminatedStateSubstore = context.getStore(
			MODULE_ID_INTEROPERABILITY,
			STORE_PREFIX_TERMINATED_STATE,
		);
		const terminatedStateAccountExists = await terminatedStateSubstore.has(chainIDBuffer);
		let terminatedStateAccount: TerminatedStateAccount;
		if (terminatedStateAccountExists) {
			terminatedStateAccount = await terminatedStateSubstore.getWithSchema<TerminatedStateAccount>(
				chainIDBuffer,
				terminatedStateSchema,
			);
			if (terminatedStateAccount.initialized) {
				return {
					status: VerifyStatus.FAIL,
					error: new Error('The sidechain is already terminated on this chain'),
				};
			}
		}

		const deserializedInteropAccount = codec.decode<ChainAccount>(
			chainAccountSchema,
			sidechainChainAccount,
		);
		const mainchainAccount = await interoperabilityStore.getChainAccount(
			getIDAsKeyForStore(MAINCHAIN_ID),
		);
		if (
			deserializedInteropAccount.status !== CHAIN_TERMINATED &&
			mainchainAccount.lastCertificate.timestamp -
				deserializedInteropAccount.lastCertificate.timestamp <=
				LIVENESS_LIMIT
		) {
			return {
				status: VerifyStatus.FAIL,
				error: new Error(
					'The sidechain is not terminated on the mainchain but the sidechain already violated the liveness requirement',
				),
			};
		}

		const interopAccKey = Buffer.concat([
			intToBuffer(MODULE_ID_INTEROPERABILITY, 4),
			intToBuffer(STORE_PREFIX_CHAIN_DATA, 4),
			chainIDBuffer,
		]);

		const query = { key: interopAccKey, value: hash(sidechainChainAccount), bitmap };

		const proofOfInclusion = { siblingHashes, queries: [query] };

		if (terminatedStateAccountExists) {
			terminatedStateAccount = await terminatedStateSubstore.getWithSchema<TerminatedStateAccount>(
				chainIDBuffer,
				terminatedStateSchema,
			);
			if (!terminatedStateAccount.mainchainStateRoot) {
				throw new Error('Sidechain account has missing property: mainchain state root');
			}
			const verified = sparseMerkleTree.verify(
				[interopAccKey],
				proofOfInclusion,
				terminatedStateAccount.mainchainStateRoot,
				1,
			);
			if (!verified) {
				return {
					status: VerifyStatus.FAIL,
					error: new Error('Failed to verify proof of inclusion'),
				};
			}
		} else {
			const verified = sparseMerkleTree.verify(
				[interopAccKey],
				proofOfInclusion,
				mainchainAccount.lastCertificate.stateRoot,
				1,
			);
			if (!verified) {
				return {
					status: VerifyStatus.FAIL,
					error: new Error('Failed to verify proof of inclusion'),
				};
			}
		}

		return {
			status: VerifyStatus.OK,
		};
	}

	public async execute(context: CommandExecuteContext<StateRecoveryInitParams>): Promise<void> {
		const { params, getStore } = context;
		const sidechainChainAccount = codec.decode<ChainAccount>(
			chainAccountSchema,
			params.sidechainChainAccount,
		);

		const interoperabilityStore = this.getInteroperabilityStore(getStore);

		const doesTerminatedStateAccountExist = await interoperabilityStore.hasTerminatedStateAccount(
			getIDAsKeyForStore(params.chainID),
		);
		if (doesTerminatedStateAccountExist) {
			const newTerminatedStateAccount: TerminatedStateAccount = {
				stateRoot: sidechainChainAccount.lastCertificate.stateRoot,
				mainchainStateRoot: EMPTY_BYTES,
				initialized: true,
			};

			const store = getStore(MODULE_ID_INTEROPERABILITY, STORE_PREFIX_TERMINATED_STATE);

			await store.setWithSchema(
				getIDAsKeyForStore(params.chainID),
				newTerminatedStateAccount,
				terminatedStateSchema,
			);
			return;
		}

		await interoperabilityStore.createTerminatedStateAccount(
			params.chainID,
			sidechainChainAccount.lastCertificate.stateRoot,
		);
	}

	protected getInteroperabilityStore(getStore: StoreCallback): MainchainInteroperabilityStore {
		return new MainchainInteroperabilityStore(this.moduleID, getStore, this.interoperableCCAPIs);
	}
}