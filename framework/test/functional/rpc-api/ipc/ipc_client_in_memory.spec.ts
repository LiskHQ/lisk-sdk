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
import { createIPCClient } from '@liskhq/lisk-api-client';
import {
	closeApplication,
	waitNBlocks,
	createApplicationWithHelloPlugin,
} from '../../utils/application';
import { Application } from '../../../../src';
import { APP_EVENT_BLOCK_NEW } from '../../../../src/constants';

describe('api client ipc mode', () => {
	const label = 'client-ipc-in-memory';
	let app: Application;
	let client: any;
	let helloMessage: any;
	let newBlockEvent: any[];

	beforeAll(async () => {
		newBlockEvent = [];
		app = await createApplicationWithHelloPlugin({
			label,
			pluginChildProcess: false,
			rpcConfig: { enable: true, mode: 'ipc', port: 8080 },
		});

		const dataPath = `${app.config.rootPath}/${label}`;

		client = await createIPCClient(dataPath);

		client.subscribe(APP_EVENT_BLOCK_NEW, (blockEvent: any) => {
			newBlockEvent.push(blockEvent);
		});

		client.subscribe('hello:greet', (message: any) => {
			helloMessage = message;
		});
	});

	afterAll(async () => {
		await client.disconnect();
		await closeApplication(app);
	});

	describe('application actions', () => {
		it('should return getNetworkStats', async () => {
			// Arrange
			const defaultNetworkStats = {
				incoming: { count: 0, connects: 0, disconnects: 0 },
				outgoing: { count: 1, connects: 1, disconnects: 0 },
				banning: { bannedPeers: {}, count: 0 },
				totalErrors: 0,
				totalPeersDiscovered: 0,
				totalRemovedPeers: 0,
				totalMessagesReceived: { postNodeInfo: 1 },
				totalRequestsReceived: {},
			};
			// Act
			const netStats = await client.node.getNetworkStats();
			// Assert
			expect(Object.keys(netStats)).toContainValues(Object.keys(defaultNetworkStats));
		});

		it('should invoke getNodeInfo action', async () => {
			// Act
			const nodeInfo = await client.invoke('app:getNodeInfo');

			// Assert
			expect(nodeInfo.version).toEqual(app.config.version);
			expect(nodeInfo.networkVersion).toEqual(app.config.networkVersion);
		});

		it('should return block by height', async () => {
			// Arrange
			await waitNBlocks(app, 2);
			// Act
			const block = await client.block.getByHeight(1);
			// Assert
			expect(block.header.height).toEqual(1);
		});

		it('should throw an error when action fails due to missing argument', async () => {
			// Assert
			await expect(client.invoke('app:getAccount')).rejects.toThrow(
				'The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received undefined',
			);
		});

		it('should throw an error on invalid action fails due to invalid argument', async () => {
			// Assert
			await expect(
				client.invoke('app:getAccount', { address: 'randomString*&&^%^' }),
			).rejects.toThrow(
				`Specified key ${Buffer.from('accounts:address:', 'utf8').toString('hex')} does not exist`,
			);
		});

		it('should return a list of registered actions', async () => {
			const actions = await await client.invoke('app:getRegisteredActions');
			expect(actions).toBeArray();
			expect(actions).toContain('app:getConnectedPeers');
			expect(actions).toContain('dpos:getAllDelegates');
			expect(actions).toContain('hello:callGreet');
		});
	});

	describe('application events', () => {
		it('should listen to new block events', async () => {
			// We need to wait for 1 extra block
			// 	as the event handler of subscribe need to finish before we go for expectations
			await waitNBlocks(app, 2);

			// Assert
			expect(newBlockEvent.length).toBeGreaterThan(0);
			expect(newBlockEvent[0]).toHaveProperty('block');
		});
		it('should return a list of registered events', async () => {
			const events = await await client.invoke('app:getRegisteredEvents');
			expect(events).toBeArray();
			expect(events).toContain('app:ready');
			expect(events).toContain('token:registeredToBus');
			expect(events).toContain('hello:greet');
		});
	});

	describe('module actions', () => {
		it('should return all the delegates', async () => {
			// Act
			const delegates = await client.invoke('dpos:getAllDelegates');
			// Assert
			expect(delegates).toHaveLength(103);
		});

		it('should throw an error on invalid action', async () => {
			// Assert
			await expect(client.invoke('token:getAllDelegates')).rejects.toThrow(
				"Action 'token:getAllDelegates' is not registered to bus",
			);
		});
	});

	describe('plugin actions', () => {
		it('should be able to get data from plugin action', async () => {
			// Act
			const data = await client.invoke('hello:callGreet');

			// Assert
			expect(data).toEqual({
				greet: 'hi, how are you?',
			});
		});

		it('should be able to get data from plugin `hello:greet` event by calling action that returns undefined', async () => {
			// Act
			const data = await client.invoke('hello:publishGreetEvent');

			// Assert
			expect(data).toBeUndefined();
			expect(helloMessage).toEqual({ message: 'hello event' });
		});

		it('should return undefined when void action `hello:blankAction` is called', async () => {
			// Act
			const data = await client.invoke('hello:publishGreetEvent');

			// Assert
			expect(data).toBeUndefined();
		});

		it('should throw an error on invalid action `hello:randomEventName`', async () => {
			// Assert
			await expect(client.invoke('hello:randomEventName')).rejects.toThrow(
				"Action 'hello:randomEventName' is not registered to bus",
			);
		});
	});
});
