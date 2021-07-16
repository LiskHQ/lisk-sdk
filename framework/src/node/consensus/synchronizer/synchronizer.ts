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

import * as assert from 'assert';
import { BFT } from '@liskhq/lisk-bft';
import { Chain, Block } from '@liskhq/lisk-chain';
import { jobHandlers } from '@liskhq/lisk-utils';
import { BaseSynchronizer } from './base_synchronizer';
import { Logger } from '../../../logger';
import { BlockExecutor } from './type';
import * as utils from './utils';

interface SynchronizerInput {
	readonly logger: Logger;
	readonly chainModule: Chain;
	readonly bftModule: BFT;
	readonly blockExecutor: BlockExecutor;
	readonly mechanisms: BaseSynchronizer[];
}

export class Synchronizer {
	protected logger: Logger;
	private readonly chainModule: Chain;
	private readonly bftModule: BFT;
	private readonly _mutex: jobHandlers.Mutex;
	private readonly blockExecutor: BlockExecutor;
	private readonly mechanisms: BaseSynchronizer[];

	public constructor({
		logger,
		chainModule,
		bftModule,
		blockExecutor,
		mechanisms = [],
	}: SynchronizerInput) {
		assert(Array.isArray(mechanisms), 'mechanisms should be an array of mechanisms');
		this.mechanisms = mechanisms;
		this.logger = logger;
		this.chainModule = chainModule;
		this.bftModule = bftModule;
		this.blockExecutor = blockExecutor;

		this._checkMechanismsInterfaces();
		this._mutex = new jobHandlers.Mutex();
	}

	public async init(): Promise<void> {
		const isEmpty = await this.chainModule.dataAccess.isTempBlockEmpty();
		if (!isEmpty) {
			try {
				await utils.restoreBlocksUponStartup(
					this.logger,
					this.chainModule,
					this.bftModule,
					this.blockExecutor,
				);
			} catch (err) {
				this.logger.error(
					{ err: err as Error },
					'Failed to restore blocks from temp table upon startup',
				);
			}
		}
	}

	public async run(receivedBlock: Block, peerId: string): Promise<void> {
		if (this._mutex.isLocked()) {
			this.logger.debug('Synchronizer is already running.');
			return;
		}
		await this._mutex.runExclusive(async () => {
			assert(receivedBlock, 'A block must be provided to the Synchronizer in order to run');
			this.logger.info(
				{
					blockId: receivedBlock.header.id,
					height: receivedBlock.header.height,
				},
				'Starting synchronizer',
			);
			// Moving to a Different Chain
			// 1. Step: Validate new tip of chain
			await this.blockExecutor.validate(receivedBlock);

			// Choose the right mechanism to sync
			const validMechanism = await this._determineSyncMechanism(receivedBlock, peerId);

			if (!validMechanism) {
				this.logger.info(
					{ blockId: receivedBlock.header.id },
					'Syncing mechanism could not be determined for the given block',
				);
				return;
			}

			this.logger.info(`Triggering: ${validMechanism.constructor.name}`);

			await validMechanism.run(receivedBlock, peerId);

			this.logger.info(
				{
					lastBlockHeight: this.chainModule.lastBlock.header.height,
					lastBlockID: this.chainModule.lastBlock.header.id,
					mechanism: validMechanism.constructor.name,
				},
				'Synchronization finished.',
			);
		});
	}

	public get isActive(): boolean {
		return this._mutex.isLocked();
	}

	public async stop(): Promise<void> {
		for (const mechanism of this.mechanisms) {
			mechanism.stop();
		}
		// Add mutex to wait for the current mutex to finish
		await this._mutex.acquire();
	}

	private async _determineSyncMechanism(
		receivedBlock: Block,
		peerId: string,
	): Promise<BaseSynchronizer | undefined> {
		for (const mechanism of this.mechanisms) {
			if (await mechanism.isValidFor(receivedBlock, peerId)) {
				return mechanism;
			}
		}

		return undefined;
	}

	private _checkMechanismsInterfaces(): void {
		for (const mechanism of this.mechanisms) {
			assert(
				typeof mechanism.isValidFor === 'function',
				`Mechanism ${mechanism.constructor.name} should implement "isValidFor" method`,
			);
			assert(
				typeof mechanism.run === 'function',
				`Mechanism ${mechanism.constructor.name} should implement "run" method`,
			);
		}
	}
}
