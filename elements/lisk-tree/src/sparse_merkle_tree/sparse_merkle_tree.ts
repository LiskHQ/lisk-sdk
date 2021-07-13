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

import { EMPTY_HASH, NodeSide } from './constants';
import { Leaf } from './leaf';
import { Database } from './types';
import { binaryExpansion, bufferToBinaryString, getBranchData, getLeafData, isLeaf } from './utils';
import { Branch } from './branch';
import { Empty } from './empty';
import { InMemoryDB } from '../inmemory_db';

type TreeNode = Branch | Leaf | Empty;
export class SparseMerkleTree {
	private readonly _db: Database;
	private readonly _keyLength: number;
	private _rootNode: TreeNode;

	public constructor(options: { db?: Database, rootHash?: Buffer, keyLength?: number }) {
		this._db = options?.db ?? new InMemoryDB();
		this._keyLength = options?.keyLength || 32;
		this._rootNode = new Empty();
	}
	public get rootHash(): Buffer {
		return this._rootNode.hash;
	}
	public get rootNode(): TreeNode {
		return this._rootNode;
	}
	// temporary, to be removed
	public get keyLength(): number {
		return this._keyLength;
	}
	// temporary, to be removed
	public get db(): Database {
		return this._db;
	}

	public async getNode(nodeHash: Buffer): Promise<TreeNode> {
		if (nodeHash.equals(EMPTY_HASH)) {
			return new Empty();
		}
		const data = await this._db.get(nodeHash);

		if (!data) {
			throw new Error(`Hash does not exist in merkle tree: ${nodeHash.toString('hex')}`);
		}
		if (isLeaf(data)) {
			const { key, value } = getLeafData(data, this.keyLength);
			return new Leaf(key, value);
		}

		const { leftHash, rightHash } = getBranchData(data);

		return new Branch(leftHash, rightHash);
	}
	// As specified in from https://github.com/LiskHQ/lips/blob/master/proposals/lip-0039.md
	public async update(key: Buffer, value: Buffer) {
		if (value.length === 0) {
			throw new Error('Value cannot be empty');
		}

		if (key.byteLength !== this.keyLength) {
			throw new Error(`Key is not equal to defined key length of ${this.keyLength}`);
		}

		let currentNode = this.rootNode;
		const newLeaf = new Leaf(key, value);
		const binaryKey = binaryExpansion(key, this.keyLength);
		// if the currentNode is EMPTY node then assign it to leafNode and return
		if (currentNode instanceof Empty) {
			this._rootNode = newLeaf;
			await this._db.set(newLeaf.hash, newLeaf.data);
            return this.rootNode;
        }
		const ancestorNodes: TreeNode[] = [];
		let h = 0;
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
			await this._db.del(currentNode.hash);
			bottomNode = newLeaf;
		} else if(currentNode.key === key) {
			bottomNode = newLeaf;
		} else {
			// We need to create new branches in the tree to fulfill the
			// Condition of one leaf per empty subtree
			// Note: h is set to the last value from the previous loop
			const currentNodeBinaryKey = bufferToBinaryString(currentNode.key);
			while (binaryKey.charAt(h) === currentNodeBinaryKey.charAt(h)) {
				// Create branch node with empty value
				const newBranch = new Branch(EMPTY_HASH, EMPTY_HASH);
				await this._db.set(newBranch.hash, newBranch.data);
				// Append defaultBranch to ancestorNodes
				ancestorNodes.push(newBranch);
				h += 1;
			}
			// Create last branch node, parent of node and newLeaf
			let d = binaryKey.charAt(h);//(key & 1<<(this.KEY_LENGTH-h)) >> (this.KEY_LENGTH-h)
			if (d === '0') {
				bottomNode = new Branch(newLeaf.hash, currentNode.hash);
				await this._db.set(bottomNode.hash, bottomNode.data);
			} else if (d === '1') {
				bottomNode = new Branch(currentNode.hash, newLeaf.hash);
				await this._db.set(bottomNode.hash, bottomNode.data);
			}
		}
		await this._db.set(newLeaf.hash, newLeaf.data);
		// Finally update all branch nodes in ancestorNodes
		// Starting from the last
		while (h > 0) {
			let p = ancestorNodes[h - 1];
            let d = binaryKey.charAt(h - 1);
			if (d === '0') {
				(p as Branch).update(bottomNode.hash, NodeSide.LEFT);
			} else if (d === '1') {
				(p as Branch).update(bottomNode.hash, NodeSide.RIGHT);
			}
			await this._db.set(p.hash, (p as Branch).data);
            bottomNode = p;
            h--;
		}
		this._rootNode = bottomNode;
		await this._db.set(this.rootNode.hash, (this.rootNode as Branch).data);

        return this._rootNode;
	}

	/*
    public remove() {}
    public generateSingleProof() {}
    public generateMultiProof() {}
    public verifyMultiProof() {}
    */
}
