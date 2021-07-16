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

import { DEFAULT_KEY_LENGTH, EMPTY_HASH, EMPTY_VALUE, NodeSide } from './constants';
import { Leaf } from './leaf';
import { Database, Proof, Query } from './types';
import {
	parseBranchData,
	parseLeafData,
	isLeaf,
	binaryExpansion,
	sortByBitmapAndKey,
	binaryStringToBuffer,
	bufferToBinaryString,
	binarySearch,
	treeSort,
} from './utils';
import { Branch } from './branch';
import { Empty } from './empty';

type TreeNode = Branch | Leaf | Empty;
type SingleProof = {
	key: Buffer;
	value: Buffer;
	binaryBitmap: string;
	ancestorHashes: Buffer[];
	siblingHashes: Buffer[];
};
type QueryWithHeight = {
	key: Buffer;
	value: Buffer;
	binaryBitmap: string;
	siblingHashes: Buffer[];
	height: number;
};

export class SparseMerkleTree {
	private readonly _db: Database;
	private readonly _keyLength: number;
	private _rootHash: Buffer;

	public constructor(options: { db: Database; rootHash?: Buffer; keyLength?: number }) {
		this._db = options.db;
		this._keyLength = options.keyLength ?? DEFAULT_KEY_LENGTH;
		// Make sure to always set rootHash explicitly whenever updating the tree
		this._rootHash = options.rootHash ?? EMPTY_HASH;
	}
	public get rootHash(): Buffer {
		return this._rootHash;
	}

	public get keyLength(): number {
		return this._keyLength;
	}

	public async getNode(nodeHash: Buffer): Promise<TreeNode> {
		if (nodeHash.equals(EMPTY_HASH)) {
			return new Empty();
		}
		const data = await this._db.get(nodeHash);

		if (!data) {
			throw new Error(
				`Node with input hash: ${nodeHash.toString('hex')} does not exist in the tree`,
			);
		}
		if (isLeaf(data)) {
			const { key, value } = parseLeafData(data, this.keyLength);

			return new Leaf(key, value);
		}

		const { leftHash, rightHash } = parseBranchData(data);

		return new Branch(leftHash, rightHash);
	}
	// As specified in from https://github.com/LiskHQ/lips/blob/master/proposals/lip-0039.md
	public async update(key: Buffer, value: Buffer): Promise<TreeNode> {
		if (value.length === 0) {
			throw new Error('Value cannot be empty');
		}

		if (key.byteLength !== this.keyLength) {
			throw new Error(`Key is not equal to defined key length of ${this.keyLength}`);
		}
		let rootNode = await this.getNode(this._rootHash);
		let currentNode = rootNode;
		const newLeaf = new Leaf(key, value);
		await this._db.set(newLeaf.hash, newLeaf.data);
		const binaryKey = binaryExpansion(key, this.keyLength);
		// if the currentNode is EMPTY node then assign it to leafNode and return
		if (currentNode instanceof Empty) {
			rootNode = newLeaf;
			this._rootHash = rootNode.hash;

			return rootNode;
		}
		let h = 0;
		const ancestorNodes: TreeNode[] = [];
		while (currentNode instanceof Branch) {
			const d = binaryKey.charAt(h);
			// Append currentNode to ancestorNodes
			ancestorNodes.push(currentNode);
			if (d === '0') {
				currentNode = await this.getNode(currentNode.leftHash);
			} else if (d === '1') {
				currentNode = await this.getNode(currentNode.rightHash);
			}
			h += 1;
		}

		// The currentNode is an empty node, newLeaf will replace the default empty node or currentNode will be updated to newLeaf
		let bottomNode: TreeNode = new Empty();
		if (currentNode instanceof Empty) {
			// delete the empty node and update the tree, the new leaf will substitute the empty node
			bottomNode = newLeaf;
		} else if (currentNode.key === key) {
			bottomNode = newLeaf;
		} else {
			// We need to create new branches in the tree to fulfill the
			// Condition of one leaf per empty subtree
			// Note: h is set to the last value from the previous loop
			const currentNodeBinaryKey = binaryExpansion(currentNode.key, this.keyLength);
			while (binaryKey.charAt(h) === currentNodeBinaryKey.charAt(h)) {
				// Create branch node with empty value
				const newBranch = new Branch(EMPTY_HASH, EMPTY_HASH);
				// Append defaultBranch to ancestorNodes
				ancestorNodes.push(newBranch);
				h += 1;
			}
			// Create last branch node, parent of node and newLeaf
			const d = binaryKey.charAt(h);
			if (d === '0') {
				bottomNode = new Branch(newLeaf.hash, currentNode.hash);
				await this._db.set(bottomNode.hash, bottomNode.data);
			} else if (d === '1') {
				bottomNode = new Branch(currentNode.hash, newLeaf.hash);
				await this._db.set(bottomNode.hash, bottomNode.data);
			}
		}
		// Finally update all branch nodes in ancestorNodes
		// Starting from the last
		while (h > 0) {
			const p = ancestorNodes[h - 1];
			const d = binaryKey.charAt(h - 1);
			if (d === '0') {
				(p as Branch).update(bottomNode.hash, NodeSide.LEFT);
			} else if (d === '1') {
				(p as Branch).update(bottomNode.hash, NodeSide.RIGHT);
			}
			await this._db.set(p.hash, (p as Branch).data);
			bottomNode = p;
			h -= 1;
		}
		rootNode = bottomNode;
		this._rootHash = rootNode.hash;
		await this._db.set(rootNode.hash, (rootNode as Branch).data);

		return rootNode;
	}

	public async remove(key: Buffer): Promise<TreeNode> {
		if (key.length !== this.keyLength) {
			throw new Error(`Key is not equal to defined key length of ${this.keyLength}`);
		}

		const ancestorNodes: TreeNode[] = [];
		const binaryKey = binaryExpansion(key, this.keyLength);
		let currentNode = await this.getNode(this._rootHash);
		let h = 0;
		let currentNodeSibling: TreeNode = new Empty();

		// Collect all ancestor nodes through traversing the binary expansion by height
		// End of the loop ancestorNodes has all the branch nodes
		// currentNode will be the leaf/node we are looking to remove
		while (currentNode instanceof Branch) {
			ancestorNodes.push(currentNode);
			const d = binaryKey[h];
			if (d === '0') {
				currentNodeSibling = await this.getNode(currentNode.rightHash);
				currentNode = await this.getNode(currentNode.leftHash);
			} else if (d === '1') {
				currentNodeSibling = await this.getNode(currentNode.leftHash);
				currentNode = await this.getNode(currentNode.rightHash);
			}
			h += 1;
		}

		// When currentNode is empty, nothing to remove
		if (currentNode instanceof Empty) {
			return currentNode;
		}
		// When the input key does not match node key, nothing to remove
		if (!currentNode.key.equals(key)) {
			return currentNode;
		}
		let bottomNode: TreeNode = new Empty();

		// currentNode has a branch sibling, delete currentNode
		if (currentNodeSibling instanceof Branch) {
			await this._db.del(currentNode.hash);
		} else if (currentNodeSibling instanceof Leaf) {
			// currentNode has a leaf sibling,
			// remove the leaf and move sibling up the tree
			await this._db.del(currentNode.hash);
			bottomNode = currentNodeSibling;

			h -= 1;
			// In order to move sibling up the tree
			// an exact emptyHash check is required
			// not using EMPTY_HASH here to make sure we use correct hash from Empty class
			const emptyHash = new Empty().hash;
			while (h > 0) {
				const p = ancestorNodes[h - 1] as Branch;

				// if one of the children is empty then break the condition
				if (
					p instanceof Branch &&
					!p.leftHash.equals(emptyHash) &&
					!p.rightHash.equals(emptyHash)
				) {
					break;
				}

				await this._db.del(p.hash);
				h -= 1;
			}
		}

		// finally update all branch nodes in ancestorNodes.
		// note that h now is set to the correct height from which
		// nodes have to be updated
		while (h > 0) {
			const p = ancestorNodes[h - 1];
			const d = binaryKey.charAt(h - 1);

			if (d === '0') {
				(p as Branch).update(bottomNode.hash, NodeSide.LEFT);
			} else if (d === '1') {
				(p as Branch).update(bottomNode.hash, NodeSide.RIGHT);
			}
			await this._db.set(p.hash, (p as Branch).data);
			bottomNode = p;
			h -= 1;
		}
		this._rootHash = bottomNode.hash;
		await this._db.set(bottomNode.hash, (bottomNode as Branch).data);

		return bottomNode;
	}

	public generateSingleProof = async (queryKey: Buffer): Promise<SingleProof> => {
		const rootNode = await this.getNode(this._rootHash);
		let currentNode = rootNode;
		if (currentNode instanceof Empty) {
			return {
				key: queryKey,
				value: EMPTY_VALUE,
				binaryBitmap: bufferToBinaryString(EMPTY_HASH),
				siblingHashes: [],
				ancestorHashes: [],
			};
		}

		let h = 0;
		const siblingHashes = [];
		const ancestorHashes = [];
		let binaryBitmap = '';
		const binaryKey = binaryExpansion(queryKey, this.keyLength);

		while (currentNode instanceof Branch) {
			ancestorHashes.push(currentNode.hash);
			const d = binaryKey.charAt(h);
			let currentNodeSibling: TreeNode = new Empty();
			if (d === '0') {
				currentNodeSibling = await this.getNode(currentNode.rightHash);
				currentNode = await this.getNode(currentNode.leftHash);
			} else if (d === '1') {
				currentNodeSibling = await this.getNode(currentNode.leftHash);
				currentNode = await this.getNode(currentNode.rightHash);
			}

			if (currentNodeSibling instanceof Empty) {
				binaryBitmap = `0${binaryBitmap}`;
			} else {
				binaryBitmap = `1${binaryBitmap}`;
				siblingHashes.push(currentNodeSibling.hash);
			}
			h += 1;
		}

		if (currentNode instanceof Empty) {
			// exclusion proof
			return {
				siblingHashes,
				ancestorHashes,
				binaryBitmap,
				key: queryKey,
				value: EMPTY_VALUE,
			};
		}

		if (
			currentNode instanceof Leaf &&
			currentNode.key.toString('hex') !== queryKey.toString('hex')
		) {
			// exclusion proof
			ancestorHashes.push(currentNode.hash); // in case the leaf is sibling to another node
			return {
				siblingHashes,
				ancestorHashes,
				binaryBitmap,
				key: currentNode.key,
				value: currentNode.value,
			};
		}
		if (
			currentNode instanceof Leaf &&
			currentNode.key.toString('hex') === queryKey.toString('hex')
		) {
			// inclusion proof
			ancestorHashes.push(currentNode.hash); // in case the leaf is sibling to another node
			return {
				siblingHashes,
				ancestorHashes,
				binaryBitmap,
				key: currentNode.key,
				value: currentNode.value,
			};
		}
		return {
			key: queryKey,
			value: EMPTY_VALUE,
			binaryBitmap: bufferToBinaryString(EMPTY_HASH),
			siblingHashes: [],
			ancestorHashes: [],
		};
	};

	public generateMultiProof = async (queryKeys: Buffer[]): Promise<Proof> => {
		const partialQueries: SingleProof[] = [];
		for (const queryKey of queryKeys) {
			const query = await this.generateSingleProof(queryKey);
			partialQueries.push(query);
		}

		const queries: Query[] = [...partialQueries].map(sp => ({
			bitmap: binaryStringToBuffer(sp.binaryBitmap),
			key: sp.key,
			value: sp.value,
		}));
		const siblingHashes: Buffer[] = [];
		const ancestorHashes = [...partialQueries].map(sp => sp.ancestorHashes).flat();
		let sortedQueries: QueryWithHeight[] = [...partialQueries].map(sp => ({
			binaryBitmap: sp.binaryBitmap,
			key: sp.key,
			value: sp.value,
			siblingHashes: sp.siblingHashes,
			height: sp.binaryBitmap.length,
		}));
		sortedQueries = sortByBitmapAndKey(sortedQueries);

		while (sortedQueries.length > 0) {
			const sp = sortedQueries.shift()!;
			if (sp.height === 0) {
				continue;
			}
			const b = sp.binaryBitmap.charAt(sp.binaryBitmap.length - sp.height);
			if (b === '1') {
				const nodeHash = sp.siblingHashes.pop()!;
				let isPresentInSiblingHashes = false;
				let isPresentInAncestorHashes = false;
				for (const i of siblingHashes) {
					if (i.equals(nodeHash)) isPresentInSiblingHashes = true;
				}
				for (const i of ancestorHashes) {
					if (i.equals(nodeHash)) isPresentInAncestorHashes = true;
				}
				if (!isPresentInSiblingHashes && !isPresentInAncestorHashes) {
					// TODO : optimize this
					siblingHashes.push(nodeHash);
				}
			}
			sp.height -= 1;

			if (sortedQueries.length > 0) {
				const sortedQueriesWithBinaryKey = sortedQueries.map(query => ({
					binaryKey: binaryExpansion(query.key, this.keyLength),
					binaryBitmap: query.binaryBitmap,
					value: query.value,
					siblingHashes: query.siblingHashes,
					height: query.height,
				}));
				const spWithBinaryKey = {
					binaryKey: binaryExpansion(sp.key, this.keyLength),
					binaryBitmap: sp.binaryBitmap,
					value: sp.value,
					siblingHashes: sp.siblingHashes,
					height: sp.height,
				};
				const insertIndex = binarySearch(
					sortedQueriesWithBinaryKey,
					callback => treeSort(spWithBinaryKey, callback) < 0,
				);
				if (insertIndex === sortedQueries.length) sortedQueries.push(sp);
				else {
					const keyPrefix = bufferToBinaryString(sp.key).substring(0, sp.height);
					const query = sortedQueries[insertIndex];
					if (!bufferToBinaryString(query.key).endsWith(keyPrefix, query.height))
						sortedQueries.splice(insertIndex, 0, sp);
				}
			} else {
				sortedQueries.push(sp);
			}
		}

		return { siblingHashes, queries };
	};
}
