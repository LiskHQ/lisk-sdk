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
 *
 */
import {
	ConnectionKind,
	DEFAULT_RANDOM_SECRET,
	PeerKind,
} from '../../src/constants';
import { Peer } from '../../src/peer';
import { P2PPeerInfo } from '../../src/p2p_types';

export const initPeerInfoList = (): ReadonlyArray<P2PPeerInfo> => {
	const peerOption1: P2PPeerInfo = {
		id: '204.120.0.15:5001',
		ipAddress: '204.120.0.15',
		sharedState: {
			wsPort: 5001,
			advertiseAddress: true,
			height: 545776,
			isDiscoveredPeer: false,
			version: '1.1.1',
			protocolVersion: '1.1',
		},
	};

	const peerOption2: P2PPeerInfo = {
		id: '204.120.0.16:5002',
		ipAddress: '204.120.0.16',
		sharedState: {
			wsPort: 5002,
			advertiseAddress: true,
			height: 545981,
			isDiscoveredPeer: false,
			version: '1.1.1',
			protocolVersion: '1.1',
		},
	};

	const peerOption3: P2PPeerInfo = {
		id: '204.120.0.17:5008',
		ipAddress: '204.120.0.17',
		sharedState: {
			wsPort: 5008,
			advertiseAddress: true,
			height: 645980,
			isDiscoveredPeer: false,
			version: '1.3.1',
			protocolVersion: '1.1',
		},
	};

	const peerOption4: P2PPeerInfo = {
		id: '204.120.0.18:5006',
		ipAddress: '204.120.0.18',
		sharedState: {
			wsPort: 5006,
			advertiseAddress: true,
			height: 645982,
			isDiscoveredPeer: false,
			version: '1.2.1',
			protocolVersion: '1.1',
		},
	};

	const peerOption5: P2PPeerInfo = {
		id: '204.120.0.19:5001',
		ipAddress: '204.120.0.19',
		sharedState: {
			wsPort: 5001,
			advertiseAddress: true,
			height: 645980,
			isDiscoveredPeer: false,
			version: '1.1.1',
			protocolVersion: '1.1',
		},
	};

	return [peerOption1, peerOption2, peerOption3, peerOption4, peerOption5];
};

export const initPeerInfoListWithSuffix = (
	ipSuffix: string,
	qty: number,
): ReadonlyArray<P2PPeerInfo> => {
	let peerInfos = [];
	for (let i = 0; i < qty; i++) {
		peerInfos.push({
			id: `${i % 255}.${ipSuffix}:${5000 + (i % 40000)}`,
			ipAddress: `${i % 255}.${ipSuffix}`,
			sharedState: {
				wsPort: 5000 + (i % 40000),
				advertiseAddress: true,
				height: 645980,
				isDiscoveredPeer: false,
				version: '1.1.1',
				protocolVersion: '1.1',
			},
			internalState: {
				connectionKind:
					i % 4 === 0 ? ConnectionKind.OUTBOUND : ConnectionKind.INBOUND,
				dateAdded: new Date(),
				peerKind: PeerKind.NONE,
				isBanned: false,
				advertiseAddress: true,
			},
		});
	}

	return peerInfos;
};

export const initPeerList = (): ReadonlyArray<Peer> =>
	initPeerInfoList().map(
		(peerInfo: P2PPeerInfo) =>
			new Peer(peerInfo, {
				rateCalculationInterval: 1000,
				wsMaxMessageRate: 1000,
				wsMaxMessageRatePenalty: 10,
				secret: DEFAULT_RANDOM_SECRET,
				maxPeerInfoSize: 10000,
				maxPeerDiscoveryResponseLength: 1000,
			}),
	);
