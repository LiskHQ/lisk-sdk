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

/**
 * Fixtures used by Block Synchronization Mechanism's Peer selection algorithm
 * It represents an array of Peers supposedly returned by the network module
 * @type {*[]}
 */
export const peersList = {
	connectedPeers: [
		{
			options: {
				lastBlockID: Buffer.from('12343245'),
				blockVersion: 2,
				maxHeightPrevoted: 1,
				height: 66,
			},
			peerId: '127.0.0.2:5000',
			ipAddress: '127.0.0.2',
			port: '5000',
		},
		{
			options: {
				lastBlockID: Buffer.from('12343245'),
				maxHeightPrevoted: 1,
				blockVersion: 2,
				height: 67,
			},
			peerId: '127.0.0.3:5000',
			ipAddress: '127.0.0.3',
			port: '5000',
		},
		{
			options: {
				lastBlockID: Buffer.from('12343245'),
				blockVersion: 2,
				maxHeightPrevoted: 2,
				height: 68,
			},
			peerId: '127.0.0.3:5000',
			ipAddress: '127.0.0.3',
			port: '5000',
		},
		{
			options: {
				lastBlockID: Buffer.from('12343245'),
				blockVersion: 2,
				maxHeightPrevoted: 2,
				height: 69,
			},
			peerId: '127.0.0.4:5000',
			ipAddress: '127.0.0.4',
			port: '5000',
		},
		{
			options: {
				lastBlockID: Buffer.from('12343245'),
				blockVersion: 2,
				maxHeightPrevoted: 2,
				height: 69,
			},
			peerId: '127.0.0.5:5000',
			ipAddress: '127.0.0.5',
			port: '5000',
		},
		{
			options: {
				lastBlockID: Buffer.from('12343245'),
				blockVersion: 2,
				maxHeightPrevoted: 2,
				height: 69,
			},
			peerId: '127.0.0.6:5000',
			ipAddress: '127.0.0.6',
			port: '5000',
		},
		{
			options: {
				lastBlockID: Buffer.from('12343246'),
				blockVersion: 2,
				maxHeightPrevoted: 2,
				height: 69,
			},
			peerId: '127.0.0.7:5000',
			ipAddress: '127.0.0.7',
			port: '5000',
		},
		{
			options: {
				lastBlockID: Buffer.from('12343246'),
				blockVersion: 2,
				maxHeightPrevoted: 2,
				height: 69,
			},
			peerId: '127.0.0.8:5000',
			ipAddress: '127.0.0.8',
			port: '5000',
		},
		{
			options: {
				lastBlockID: Buffer.from('12343246'),
				blockVersion: 2,
				maxHeightPrevoted: 2,
				height: 69,
			},
			peerId: '127.0.0.9:5000',
			ipAddress: '127.0.0.9',
			port: '5000',
		}, // Next three are incompatible peers (No height or blockVersion or maxHeightPrevoted properties are present
		{
			options: {
				lastBlockID: Buffer.from('12343246'),
				maxHeightPrevoted: 2,
				height: 69,
			},
			peerId: '127.0.0.10:5000',
			ipAddress: '127.0.0.10',
			port: '5000',
		},
		{
			options: {
				lastBlockID: Buffer.from('12343246'),
				blockVersion: 2,
				height: 69,
			},
			peerId: '127.0.0.11:5000',
			ipAddress: '127.0.0.11',
			port: '5000',
		},
		{
			options: {
				lastBlockID: Buffer.from('12343246'),
				blockVersion: 2,
				maxHeightPrevoted: 2,
			},
			peerId: '127.0.0.12:5000',
			ipAddress: '127.0.0.12',
			port: '5000',
		},
	],
	expectedSelection: [
		{
			options: {
				lastBlockID: Buffer.from('12343245'),
				blockVersion: 2,
				maxHeightPrevoted: 2,
				height: 69,
			},
			peerId: '127.0.0.4:5000',
			ipAddress: '127.0.0.4',
			port: '5000',
		},
		{
			options: {
				lastBlockID: Buffer.from('12343245'),
				blockVersion: 2,
				maxHeightPrevoted: 2,
				height: 69,
			},
			peerId: '127.0.0.5:5000',
			ipAddress: '127.0.0.5',
			port: '5000',
		},
		{
			options: {
				lastBlockID: Buffer.from('12343245'),
				blockVersion: 2,
				maxHeightPrevoted: 2,
				height: 69,
			},
			peerId: '127.0.0.6:5000',
			ipAddress: '127.0.0.6',
			port: '5000',
		},
	],
};
