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

import { BlockHeader, StateStore } from '@liskhq/lisk-chain';
import { utils } from '@liskhq/lisk-cryptography';
import { objects } from '@liskhq/lisk-utils';
import {
	areDistinctHeadersContradicting,
	computeValidatorsHash,
	sortValidatorsByAddress,
} from './utils';
import { getBFTParameters } from './bft_params';
import {
	EMPTY_BLS_KEY,
	EMPTY_KEY,
	MAX_UINT32,
	MODULE_STORE_PREFIX_BFT,
	STORE_PREFIX_BFT_PARAMETERS,
	STORE_PREFIX_BFT_VOTES,
} from './constants';
import {
	bftVotesSchema,
	BFTVotes,
	BFTParameters,
	bftParametersSchema,
	BFTVotesActiveValidatorsVoteInfo,
} from './schemas';
import { BFTHeights } from './types';
import { BFTParameterNotFoundError } from './errors';
import { Validator } from '../../abi';

export interface BlockHeaderAsset {
	maxHeightPrevoted: number;
	maxHeightPreviouslyForged: number;
}

export class BFTMethod {
	private _batchSize!: number;
	private _blockTime!: number;

	public blockTime(): number {
		return this._blockTime;
	}

	public init(batchSize: number, blockTime: number) {
		this._batchSize = batchSize;
		this._blockTime = blockTime;
	}

	public areHeadersContradicting(bftHeader1: BlockHeader, bftHeader2: BlockHeader): boolean {
		if (bftHeader1.id.equals(bftHeader2.id)) {
			return false;
		}
		return areDistinctHeadersContradicting(bftHeader1, bftHeader2);
	}

	public async isHeaderContradictingChain(
		stateStore: StateStore,
		header: BlockHeader,
	): Promise<boolean> {
		const votesStore = stateStore.getStore(MODULE_STORE_PREFIX_BFT, STORE_PREFIX_BFT_VOTES);
		const bftVotes = await votesStore.getWithSchema<BFTVotes>(EMPTY_KEY, bftVotesSchema);
		for (const bftBlock of bftVotes.blockBFTInfos) {
			if (bftBlock.generatorAddress.equals(header.generatorAddress)) {
				return areDistinctHeadersContradicting(bftBlock, header);
			}
		}
		return false;
	}

	public async existBFTParameters(stateStore: StateStore, height: number): Promise<boolean> {
		const paramsStore = stateStore.getStore(MODULE_STORE_PREFIX_BFT, STORE_PREFIX_BFT_PARAMETERS);
		return paramsStore.has(utils.intToBuffer(height, 4));
	}

	public async getBFTParameters(stateStore: StateStore, height: number): Promise<BFTParameters> {
		const paramsStore = stateStore.getStore(MODULE_STORE_PREFIX_BFT, STORE_PREFIX_BFT_PARAMETERS);
		return getBFTParameters(paramsStore, height);
	}

	public async getBFTParametersActiveValidators(
		stateStore: StateStore,
		height: number,
	): Promise<BFTParameters> {
		const bftParams = await this.getBFTParameters(stateStore, height);

		return {
			...bftParams,
			// Filter standby validators with bftWeight === 0
			validators: bftParams.validators.filter(v => v.bftWeight > BigInt(0)),
		};
	}

	public async getBFTHeights(stateStore: StateStore): Promise<BFTHeights> {
		const votesStore = stateStore.getStore(MODULE_STORE_PREFIX_BFT, STORE_PREFIX_BFT_VOTES);
		const bftVotes = await votesStore.getWithSchema<BFTVotes>(EMPTY_KEY, bftVotesSchema);
		return {
			maxHeightPrevoted: bftVotes.maxHeightPrevoted,
			maxHeightPrecommitted: bftVotes.maxHeightPrecommitted,
			maxHeightCertified: bftVotes.maxHeightCertified,
		};
	}

	public async impliesMaximalPrevotes(
		stateStore: StateStore,
		header: { height: number; generatorAddress: Buffer; maxHeightGenerated: number },
	): Promise<boolean> {
		const votesStore = stateStore.getStore(MODULE_STORE_PREFIX_BFT, STORE_PREFIX_BFT_VOTES);
		const bftVotes = await votesStore.getWithSchema<BFTVotes>(EMPTY_KEY, bftVotesSchema);
		// if blockBFTInfos is empty(for genesis block + 1), check the consistency in height and maxHeightGenerated
		if (bftVotes.blockBFTInfos.length === 0) {
			return header.height > header.maxHeightGenerated;
		}
		const [currentTip] = bftVotes.blockBFTInfos;
		// input height is not next block of the stored information
		if (currentTip.height + 1 !== header.height) {
			throw new Error(
				`Input header with height ${header.height} is invalid. It must be ${
					currentTip.height + 1
				}.`,
			);
		}
		const previousHeight = header.maxHeightGenerated;

		// the block does not imply any prevotes
		if (previousHeight >= header.height) {
			return false;
		}

		// there is no block information stored for height previousHeight and blockHeader implies the maximal number of prevotes
		const offset = currentTip.height - previousHeight;
		if (offset >= bftVotes.blockBFTInfos.length) {
			return true;
		}
		// block at previousHeight is generated by a different validator and header doesn't
		// imply maximal number of prevotes
		if (!bftVotes.blockBFTInfos[offset].generatorAddress.equals(header.generatorAddress)) {
			return false;
		}
		return true;
	}

	public async getNextHeightBFTParameters(stateStore: StateStore, height: number): Promise<number> {
		const paramsStore = stateStore.getStore(MODULE_STORE_PREFIX_BFT, STORE_PREFIX_BFT_PARAMETERS);
		const start = utils.intToBuffer(height + 1, 4);
		const end = utils.intToBuffer(MAX_UINT32, 4);
		const results = await paramsStore.iterate({
			limit: 1,
			gte: start,
			lte: end,
		});
		if (results.length !== 1) {
			throw new BFTParameterNotFoundError();
		}
		const [result] = results;
		return result.key.readUInt32BE(0);
	}

	public async setBFTParameters(
		stateStore: StateStore,
		precommitThreshold: bigint,
		certificateThreshold: bigint,
		validators: Validator[],
	): Promise<void> {
		if (validators.length > this._batchSize) {
			throw new Error(
				`Invalid validators size. The number of validators can be at most the batch size ${this._batchSize}.`,
			);
		}

		const validatorAddresses = [];
		const validatorValidBLSKeys = [];
		for (const validator of validators) {
			validatorAddresses.push(validator.address);
			// invalid bls key is used when initializing the mainchain. Therefore, it needs to ignore the empty bls key.
			if (!validator.blsKey.equals(EMPTY_BLS_KEY)) {
				validatorValidBLSKeys.push(validator.blsKey);
			}
		}

		if (!objects.bufferArrayUniqueItems(validatorAddresses)) {
			throw new Error('Provided validator addresses are not unique.');
		}

		if (!objects.bufferArrayUniqueItems(validatorValidBLSKeys)) {
			throw new Error('Provided validator BLS keys are not unique.');
		}

		let aggregateBFTWeight = BigInt(0);
		for (const validator of validators) {
			if (validator.bftWeight < 0) {
				throw new Error('BFT Weight must be 0 or greater.');
			}
			aggregateBFTWeight += validator.bftWeight;
		}
		if (
			aggregateBFTWeight / BigInt(3) + BigInt(1) > precommitThreshold ||
			precommitThreshold > aggregateBFTWeight
		) {
			throw new Error('Invalid precommitThreshold input.');
		}
		if (
			aggregateBFTWeight / BigInt(3) + BigInt(1) > certificateThreshold ||
			certificateThreshold > aggregateBFTWeight
		) {
			throw new Error('Invalid certificateThreshold input.');
		}

		sortValidatorsByAddress(validators);
		const validatorsHash = computeValidatorsHash(
			validators.filter(v => v.bftWeight > BigInt(0)),
			certificateThreshold,
		);
		const bftParams: BFTParameters = {
			prevoteThreshold: (BigInt(2) * aggregateBFTWeight) / BigInt(3) + BigInt(1),
			precommitThreshold,
			certificateThreshold,
			validators,
			validatorsHash,
		};

		const votesStore = stateStore.getStore(MODULE_STORE_PREFIX_BFT, STORE_PREFIX_BFT_VOTES);
		const bftVotes = await votesStore.getWithSchema<BFTVotes>(EMPTY_KEY, bftVotesSchema);
		// This assumes bftVotes.blockBFTInfos will contain currently executing block
		const nextHeight =
			(bftVotes.blockBFTInfos.length > 0
				? bftVotes.blockBFTInfos[0].height
				: bftVotes.maxHeightPrevoted) + 1;

		const paramsStore = stateStore.getStore(MODULE_STORE_PREFIX_BFT, STORE_PREFIX_BFT_PARAMETERS);

		const nextHeightBytes = utils.intToBuffer(nextHeight, 4);
		await paramsStore.setWithSchema(nextHeightBytes, bftParams, bftParametersSchema);

		const nextActiveValidators: BFTVotesActiveValidatorsVoteInfo[] = [];
		for (const validator of validators) {
			const existingValidator = bftVotes.activeValidatorsVoteInfo.find(v =>
				v.address.equals(validator.address),
			);
			if (existingValidator) {
				nextActiveValidators.push(existingValidator);
				continue;
			}
			nextActiveValidators.push({
				address: validator.address,
				minActiveHeight: nextHeight,
				largestHeightPrecommit: nextHeight - 1,
			});
		}
		sortValidatorsByAddress(nextActiveValidators);
		bftVotes.activeValidatorsVoteInfo = nextActiveValidators;
		await votesStore.setWithSchema(EMPTY_KEY, bftVotes, bftVotesSchema);
	}

	public async getGeneratorAtTimestamp(
		stateStore: StateStore,
		height: number,
		timestamp: number,
	): Promise<Validator> {
		const paramsStore = stateStore.getStore(MODULE_STORE_PREFIX_BFT, STORE_PREFIX_BFT_PARAMETERS);
		const bftParams = await getBFTParameters(paramsStore, height);
		const currentSlot = this.getSlotNumber(timestamp);
		const generator = bftParams.validators[currentSlot % bftParams.validators.length];
		return generator;
	}

	public getSlotNumber(timestamp: number): number {
		return Math.floor(timestamp / this._blockTime);
	}

	public getSlotTime(slot: number): number {
		return slot * this._blockTime;
	}

	public isWithinTimeslot(slot: number, timestamp: number): boolean {
		return this.getSlotNumber(timestamp) === slot;
	}
}
