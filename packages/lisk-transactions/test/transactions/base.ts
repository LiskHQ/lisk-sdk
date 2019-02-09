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
 *
 */
import { expect } from 'chai';
import { SinonStub } from 'sinon';
import * as cryptography from '@liskhq/lisk-cryptography';
import { BYTESIZES, MAX_TRANSACTION_AMOUNT } from '../../src/constants';
import {
	BaseTransaction,
	MultisignatureStatus,
} from '../../src/transactions/base';
import { TransactionJSON } from '../../src/transaction_types';
import { Status } from '../../src/response';
import {
	TransactionError,
	TransactionMultiError,
	TransactionPendingError,
} from '../../src/errors';
import * as BigNum from 'browserify-bignum';
import {
	addTransactionFields,
	MockStateStore as store,
	TestTransaction,
} from '../helpers';
import {
	validAccount as defaultSenderAccount,
	validMultisignatureAccount as defaultMultisignatureAccount,
	validMultisignatureTransaction,
	validTransaction,
	validSecondSignatureTransaction,
} from '../../fixtures';
import * as utils from '../../src/utils';

describe('Base transaction class', () => {
	const defaultTransaction = addTransactionFields(validTransaction);
	const defaultSecondSignatureTransaction = addTransactionFields(
		validSecondSignatureTransaction,
	);
	const defaultMultisignatureTransaction = addTransactionFields(
		validMultisignatureTransaction,
	);

	let validTestTransaction: BaseTransaction;
	let validSecondSignatureTestTransaction: BaseTransaction;
	let validMultisignatureTestTransaction: BaseTransaction;

	beforeEach(async () => {
		validTestTransaction = new TestTransaction(defaultTransaction);
		validSecondSignatureTestTransaction = new TestTransaction(
			defaultSecondSignatureTransaction,
		);
		validMultisignatureTestTransaction = new TestTransaction(
			defaultMultisignatureTransaction,
		);
		store.account.get = () => defaultSenderAccount;
	});

	describe('#constructor', () => {
		it('should create a new instance of BaseTransaction', async () => {
			expect(validTestTransaction)
				.to.be.an('object')
				.and.be.instanceof(BaseTransaction);
		});

		it('should have amount of type BigNum', async () => {
			expect(validTestTransaction)
				.to.have.property('amount')
				.and.be.instanceof(BigNum);
		});

		it('should have fee of type BigNum', async () => {
			expect(validTestTransaction)
				.to.have.property('fee')
				.and.be.instanceof(BigNum);
		});

		it('should have id string', async () => {
			expect(validTestTransaction)
				.to.have.property('id')
				.and.be.a('string');
		});

		it('should have recipientId string', async () => {
			expect(validTestTransaction)
				.to.have.property('recipientId')
				.and.be.a('string');
		});

		it('should have recipientPublicKey string', async () => {
			expect(validTestTransaction)
				.to.have.property('recipientPublicKey')
				.and.be.a('string');
		});

		it('should have senderId string', async () => {
			expect(validTestTransaction)
				.to.have.property('senderId')
				.and.be.a('string');
		});

		it('should have senderPublicKey string', async () => {
			expect(validTestTransaction)
				.to.have.property('senderPublicKey')
				.and.be.a('string');
		});

		it('should have signature string', async () => {
			expect(validTestTransaction)
				.to.have.property('senderPublicKey')
				.and.be.a('string');
		});

		it('should have signSignature string', async () => {
			expect(validTestTransaction)
				.to.have.property('senderPublicKey')
				.and.be.a('string');
		});

		it('should have signatures array', async () => {
			expect(validTestTransaction)
				.to.have.property('signatures')
				.and.be.a('array');
		});

		it('should have timestamp number', async () => {
			expect(validTestTransaction)
				.to.have.property('timestamp')
				.and.be.a('number');
		});

		it('should have type number', async () => {
			expect(validTestTransaction)
				.to.have.property('type')
				.and.be.a('number');
		});

		it('should have receivedAt Date', async () => {
			expect(validTestTransaction)
				.to.have.property('type')
				.and.be.a('number');
		});

		it('should have _multisignatureStatus number', async () => {
			expect(validTestTransaction)
				.to.have.property('_multisignatureStatus')
				.and.be.a('number');
		});

		it('should throw a transaction multierror with incorrectly typed transaction properties', async () => {
			const invalidTransaction = {
				...defaultTransaction,
				amount: 0,
				fee: 10,
			};
			try {
				new TestTransaction((invalidTransaction as unknown) as TransactionJSON);
			} catch (error) {
				expect(error).to.be.an.instanceOf(TransactionMultiError);
			}
		});
	});

	describe('#assetToJSON', async () => {
		it('should return an object of type transaction asset', async () => {
			expect(validTestTransaction.assetToJSON()).to.be.an('object');
		});
	});

	describe('#toJSON', () => {
		it('should call assetToJSON', async () => {
			const assetToJSONStub = sandbox
				.stub(validTestTransaction, 'assetToJSON')
				.returns({});
			validTestTransaction.toJSON();

			expect(assetToJSONStub).to.be.calledOnce;
		});

		it('should return transaction json', async () => {
			const transactionJSON = validTestTransaction.toJSON();

			expect(transactionJSON).to.be.eql(defaultTransaction);
		});
	});

	describe('#getAssetBytes', () => {
		it('should return a buffer', async () => {
			expect(
				(validTestTransaction as TestTransaction).getAssetBytes(),
			).to.be.an.instanceOf(Buffer);
		});
	});

	describe('#isReady', async () => {
		it('should return false on initialization of unknown transaction', async () => {
			expect(validTestTransaction.isReady()).to.be.false;
		});

		it('should return true on verification of non-multisignature transaction', async () => {
			validTestTransaction.apply(store);
			expect(validTestTransaction.isReady()).to.be.true;
		});

		it('should return false on verification of multisignature transaction with missing signatures', async () => {
			store.account.get = () => defaultMultisignatureAccount;
			const multisignaturesTransaction = new TestTransaction({
				...defaultMultisignatureTransaction,
				signatures: defaultMultisignatureTransaction.signatures.slice(0, 2),
			});
			multisignaturesTransaction.apply(store);

			expect(validMultisignatureTestTransaction.isReady()).to.be.false;
		});
	});

	describe('#getBasicBytes', () => {
		it('should call cryptography hexToBuffer', async () => {
			const cryptographyHexToBufferStub = sandbox
				.stub(cryptography, 'hexToBuffer')
				.returns(
					Buffer.from(
						'62b13b81836f3f1e371eba2f7f8306ff23d00a87d9473793eda7f742f4cfc21c',
						'hex',
					),
				);
			(validTestTransaction as any).getBasicBytes();

			expect(cryptographyHexToBufferStub).to.be.calledWithExactly(
				defaultTransaction.senderPublicKey,
			);
		});

		it('should call cryptography bigNumberToBuffer for non-empty recipientId', async () => {
			const cryptographyBigNumberToBufferStub = sandbox
				.stub(cryptography, 'bigNumberToBuffer')
				.returns(
					Buffer.from(defaultTransaction.recipientId.slice(0, -1), 'hex'),
				);
			(validTestTransaction as any).getBasicBytes();

			expect(cryptographyBigNumberToBufferStub).to.be.calledWithExactly(
				defaultTransaction.recipientId.slice(0, -1),
				BYTESIZES.RECIPIENT_ID,
			);
		});

		it('should call getAssetBytes for transaction with asset', async () => {
			const transactionWithAsset = {
				...defaultTransaction,
				asset: { data: 'data' },
			};
			const testTransactionWithAsset = new TestTransaction(
				transactionWithAsset,
			);
			const getAssetBytesStub = sandbox
				.stub(testTransactionWithAsset, 'getAssetBytes')
				.returns(Buffer.from('data'));
			(testTransactionWithAsset as any).getBasicBytes();

			expect(getAssetBytesStub).to.be.calledOnce;
		});

		it('should return a buffer without signatures bytes', async () => {
			const expectedBuffer = Buffer.from(
				'0022dcb9040eb0a6d7b862dc35c856c02c47fde3b4f60f2f3571a888b9a8ca7540c6793243ef4d6324449e824f6319182b02000000',
				'hex',
			);

			expect((validTestTransaction as any).getBasicBytes()).to.eql(
				expectedBuffer,
			);
		});
	});

	describe('#getBytes', () => {
		it('should call getBasicBytes', async () => {
			const getBasicBytesStub = sandbox
				.stub(validTestTransaction as any, 'getBasicBytes')
				.returns(
					Buffer.from(
						'0022dcb9040eb0a6d7b862dc35c856c02c47fde3b4f60f2f3571a888b9a8ca7540c6793243ef4d6324449e824f6319182b02000000',
						'hex',
					),
				);
			validTestTransaction.getBytes();

			expect(getBasicBytesStub).to.be.calledOnce;
		});

		it('should call cryptography hexToBuffer for transaction with signature', async () => {
			const cryptographyHexToBufferStub = sandbox
				.stub(cryptography, 'hexToBuffer')
				.returns(
					Buffer.from(
						'2092abc5dd72d42b289f69ddfa85d0145d0bfc19a0415be4496c189e5fdd5eff02f57849f484192b7d34b1671c17e5c22ce76479b411cad83681132f53d7b309',
						'hex',
					),
				);
			validTestTransaction.getBytes();

			expect(cryptographyHexToBufferStub.secondCall).to.have.been.calledWith(
				validTestTransaction.signature,
			);
		});

		it('should call cryptography hexToBuffer for transaction with signSignature', async () => {
			const cryptographyHexToBufferStub = sandbox
				.stub(cryptography, 'hexToBuffer')
				.returns(
					Buffer.from(
						'2092abc5dd72d42b289f69ddfa85d0145d0bfc19a0415be4496c189e5fdd5eff02f57849f484192b7d34b1671c17e5c22ce76479b411cad83681132f53d7b309',
						'hex',
					),
				);
			validSecondSignatureTestTransaction.getBytes();

			expect(cryptographyHexToBufferStub.thirdCall).to.have.been.calledWith(
				validSecondSignatureTestTransaction.signSignature,
			);
		});

		it('should return a buffer with signature bytes', async () => {
			const expectedBuffer = Buffer.from(
				'0022dcb9040eb0a6d7b862dc35c856c02c47fde3b4f60f2f3571a888b9a8ca7540c6793243ef4d6324449e824f6319182b020000002092abc5dd72d42b289f69ddfa85d0145d0bfc19a0415be4496c189e5fdd5eff02f57849f484192b7d34b1671c17e5c22ce76479b411cad83681132f53d7b309',
				'hex',
			);

			expect(validTestTransaction.getBytes()).to.eql(expectedBuffer);
		});

		it('should return a buffer with signSignature bytes', async () => {
			const expectedBuffer = Buffer.from(
				'004529cf04bc10685b802c8dd127e5d78faadc9fad1903f09d562fdcf632462408d4ba52e8b95af897b7e23cb900e40b54020000003357658f70b9bece24bd42769b984b3e7b9be0b2982f82e6eef7ffbd841598d5868acd45f8b1e2f8ab5ccc8c47a245fe9d8e3dc32fc311a13cc95cc851337e0111f77b8596df14400f5dd5cf9ef9bd2a20f66a48863455a163cabc0c220ea235d8b98dec684bd86f62b312615e7f64b23d7b8699775e7c15dad0aef0abd4f503',
				'hex',
			);

			expect(validSecondSignatureTestTransaction.getBytes()).to.eql(
				expectedBuffer,
			);
		});
	});

	describe('_validateSchema', () => {
		it('should call toJSON', async () => {
			const toJSONStub = sandbox
				.stub(validTestTransaction, 'toJSON')
				.returns({} as any);
			(validTestTransaction as any)._validateSchema();

			expect(toJSONStub).to.be.calledOnce;
		});

		it('should call cryptography getAddressFromPublicKey for transaction with valid senderPublicKey', async () => {
			const cryptographyGetAddressFromPublicKeyStub = sandbox
				.stub(cryptography, 'getAddressFromPublicKey')
				.returns('18278674964748191682L');
			(validTestTransaction as any)._validateSchema();

			expect(
				cryptographyGetAddressFromPublicKeyStub,
			).to.have.been.calledWithExactly(validTestTransaction.senderPublicKey);
		});

		it('should call getBytes', async () => {
			const getBytesStub = sandbox
				.stub(validTestTransaction, 'getBytes')
				.returns(
					Buffer.from(
						'0022dcb9040eb0a6d7b862dc35c856c02c47fde3b4f60f2f3571a888b9a8ca7540c6793243ef4d6324449e824f6319182b02000000',
						'hex',
					),
				);
			(validTestTransaction as any)._validateSchema();
			expect(getBytesStub).to.be.calledOnce;
		});

		it('should call getId', async () => {
			const getIdStub = sandbox
				.stub(utils, 'getId')
				.returns('15822870279184933850');
			(validTestTransaction as any)._validateSchema();

			expect(getIdStub).to.be.calledOnce;
		});

		it('should return a successful transaction response with a valid transaction', async () => {
			const errors = (validTestTransaction as any)._validateSchema();

			expect(errors).to.be.empty;
		});

		it('should return a failed transaction response with invalid formatting', async () => {
			const invalidTransaction = {
				type: 0,
				amount: '00001',
				fee: '0000',
				recipientId: '',
				senderPublicKey: '11111111',
				senderId: '11111111',
				timestamp: 79289378,
				asset: {},
				signature: '1111111111',
				id: '1',
			};
			const invalidTestTransaction = new TestTransaction(
				invalidTransaction as any,
			);
			const errors = (invalidTestTransaction as any)._validateSchema();

			expect(errors).to.not.be.empty;
		});

		it('should return a failed transaction response with unmatching senderId and senderPublicKey', async () => {
			const invalidSenderIdTransaction = {
				...defaultTransaction,
				senderId: defaultTransaction.senderId.replace('1', '0'),
			};
			const invalidSenderIdTestTransaction = new TestTransaction(
				invalidSenderIdTransaction as any,
			);
			const errors = (invalidSenderIdTestTransaction as any)._validateSchema();

			expect(errors).to.not.be.empty;
		});

		it('should return a failed transaction response with an invalid id', async () => {
			const invalidIdTransaction = {
				...defaultTransaction,
				id: defaultTransaction.id.replace('1', '0'),
			};

			const invalidIdTestTransaction = new TestTransaction(
				invalidIdTransaction as any,
			);
			const errors = (invalidIdTestTransaction as any)._validateSchema();

			expect(errors).to.not.be.empty;
		});
	});

	describe('#validate', () => {
		beforeEach(async () => {
			sandbox
				.stub(validTestTransaction, 'getBytes')
				.returns(
					Buffer.from(
						'0022dcb9040eb0a6d7b862dc35c856c02c47fde3b4f60f2f3571a888b9a8ca7540c6793243ef4d6324449e824f6319182b020000002092abc5dd72d42b289f69ddfa85d0145d0bfc19a0415be4496c189e5fdd5eff02f57849f484192b7d34b1671c17e5c22ce76479b411cad83681132f53d7b309',
					),
				);
		});

		it('should call getBasicBytes', async () => {
			const getBasicBytesStub = sandbox
				.stub(validTestTransaction as any, 'getBasicBytes')
				.returns(
					Buffer.from(
						'0022dcb9040eb0a6d7b862dc35c856c02c47fde3b4f60f2f3571a888b9a8ca7540c6793243ef4d6324449e824f6319182b02000000',
						'hex',
					),
				);
			validTestTransaction.validate();

			expect(getBasicBytesStub).to.be.calledOnce;
		});

		it('should call validateSignature', async () => {
			const validateSignatureStub = sandbox
				.stub(utils, 'validateSignature')
				.returns(true as any);
			validTestTransaction.validate();

			expect(validateSignatureStub).to.be.calledWithExactly(
				validTestTransaction.senderPublicKey,
				validTestTransaction.signature,
				Buffer.from(
					'0022dcb9040eb0a6d7b862dc35c856c02c47fde3b4f60f2f3571a888b9a8ca7540c6793243ef4d6324449e824f6319182b02000000',
					'hex',
				),
				validTestTransaction.id,
			);
		});

		it('should return a successful transaction response with a valid transaction', async () => {
			const { id, status, errors } = validTestTransaction.validate();

			expect(id).to.be.eql(validTestTransaction.id);
			expect(errors).to.be.empty;
			expect(status).to.eql(Status.OK);
		});

		it('should return a failed transaction response with invalid signature', async () => {
			const invalidSignature = defaultTransaction.signature.replace('1', '0');
			const invalidSignatureTransaction = {
				...defaultTransaction,
				signature: invalidSignature,
			};
			const invalidSignatureTestTransaction = new TestTransaction(
				invalidSignatureTransaction as any,
			);
			const { id, status, errors } = invalidSignatureTestTransaction.validate();

			expect(id).to.be.eql(invalidSignatureTestTransaction.id);
			expect((errors as ReadonlyArray<TransactionError>)[0])
				.to.be.instanceof(TransactionError)
				.and.to.have.property(
					'message',
					`Failed to verify signature ${invalidSignature}`,
				);
			expect(status).to.eql(Status.FAIL);
		});

		it('should return a failed transaction response with duplicate signatures', async () => {
			const invalidSignaturesTransaction = {
				...defaultTransaction,
				signatures: [
					defaultTransaction.signature,
					defaultTransaction.signature,
				],
			};
			const invalidSignaturesTestTransaction = new TestTransaction(
				invalidSignaturesTransaction as any,
			);
			const {
				id,
				status,
				errors,
			} = invalidSignaturesTestTransaction.validate();

			expect(id).to.be.eql(invalidSignaturesTestTransaction.id);
			expect((errors as ReadonlyArray<TransactionError>)[0])
				.to.be.instanceof(TransactionError)
				.and.to.have.property(
					'message',
					'Encountered duplicate signature in transaction',
				);
			expect(status).to.eql(Status.FAIL);
		});
	});

	describe('#verifyAgainstOtherTransactions', () => {
		it('should return a transaction response', async () => {
			const otherTransactions = [defaultTransaction, defaultTransaction];
			const {
				id,
				status,
				errors,
			} = validTestTransaction.verifyAgainstOtherTransactions(
				otherTransactions,
			);
			expect(id).to.be.eql(validTestTransaction.id);
			expect(errors).to.be.empty;
			expect(status).to.eql(Status.OK);
		});
	});

	describe('#processMultisignatures', () => {
		it('should return a successful transaction response with valid signatures', async () => {
			sandbox.stub(utils, 'verifyMultiSignature').returns({
				status: MultisignatureStatus.READY,
				errors: [],
			});
			const {
				id,
				status,
				errors,
			} = validMultisignatureTestTransaction.processMultisignatures(store);

			expect(id).to.be.eql(validMultisignatureTestTransaction.id);
			expect(errors).to.be.eql([]);
			expect(status).to.eql(Status.OK);
		});

		it('should return a pending transaction response with missing signatures', async () => {
			const pendingErrors = [
				new TransactionPendingError(
					`Missing signatures`,
					validMultisignatureTestTransaction.id,
					'.signatures',
				),
			];
			sandbox.stub(utils, 'verifyMultiSignature').returns({
				status: MultisignatureStatus.PENDING,
				errors: pendingErrors,
			});
			const {
				id,
				status,
				errors,
			} = validMultisignatureTestTransaction.processMultisignatures(store);

			expect(id).to.be.eql(validMultisignatureTestTransaction.id);
			expect(errors).to.be.eql(pendingErrors);
			expect(status).to.eql(Status.PENDING);
		});
	});

	describe('#addVerifiedMultisignature', () => {
		it('should return a successful transaction response if no duplicate signatures', async () => {
			const {
				id,
				status,
				errors,
			} = validMultisignatureTestTransaction.addVerifiedMultisignature(
				'3df1fae6865ec72783dcb5f87a7d906fe20b71e66ad9613c01a89505ebd77279e67efa2c10b5ad880abd09efd27ea350dd8a094f44efa3b4b2c8785fbe0f7e00',
			);

			expect(id).to.be.eql(validMultisignatureTestTransaction.id);
			expect(errors).to.be.eql([]);
			expect(status).to.eql(Status.OK);
		});

		it('should return a failed transaction response if duplicate signatures', async () => {
			const {
				id,
				status,
				errors,
			} = validMultisignatureTestTransaction.addVerifiedMultisignature(
				'f223799c2d30d2be6e7b70aa29b57f9b1d6f2801d3fccf5c99623ffe45526104b1f0652c2cb586c7ae201d2557d8041b41b60154f079180bb9b85f8d06b3010c',
			);

			expect(id).to.be.eql(validMultisignatureTestTransaction.id);
			expect(status).to.eql(Status.FAIL);
			(errors as ReadonlyArray<TransactionError>).forEach(error =>
				expect(error)
					.to.be.instanceof(TransactionError)
					.and.to.have.property('message', 'Failed to add signature.'),
			);
		});
	});

	describe('#apply', () => {
		it('should return a successful transaction response with an updated sender account', async () => {
			const { id, status, state, errors } = validTestTransaction.apply(store);
			expect(id).to.be.eql(validTestTransaction.id);
			expect(status).to.eql(Status.OK);
			expect(state)
				.to.be.an('object')
				.and.to.have.property('sender');
			expect((state as any).sender).to.have.property('balance', '0');
			expect(errors).to.be.empty;
		});

		it('should return a failed transaction response with insufficient account balance', async () => {
			store.account.get = () => {
				return {
					...defaultSenderAccount,
					balance: '0',
				};
			};
			const { id, status, state, errors } = validTestTransaction.apply(store);

			expect(id).to.be.eql(validTestTransaction.id);
			expect(status).to.eql(Status.FAIL);
			expect(state)
				.to.be.an('object')
				.and.to.have.property('sender');
			expect((state as any).sender).to.have.property('balance', '-10000000');
			expect((errors as ReadonlyArray<TransactionError>)[0])
				.to.be.instanceof(TransactionError)
				.and.to.have.property(
					'message',
					`Account does not have enough LSK: ${
						defaultSenderAccount.address
					}, balance: 0`,
				);
		});
	});

	describe('#undo', () => {
		it('should return a successful transaction response with an updated sender account', async () => {
			const { id, status, state, errors } = validTestTransaction.undo(store);
			expect(id).to.be.eql(validTestTransaction.id);
			expect(status).to.eql(Status.OK);
			expect(state)
				.to.be.an('object')
				.and.to.have.property('sender');
			expect((state as any).sender).to.have.property('balance', '20000000');
			expect(errors).to.be.eql([]);
		});

		it('should return a failed transaction response with account balance exceeding max amount', async () => {
			store.account.get = () => {
				return {
					...defaultSenderAccount,
					balance: MAX_TRANSACTION_AMOUNT.toString(),
				};
			};
			const { id, status, state, errors } = validTestTransaction.undo(store);
			expect(id).to.be.eql(validTestTransaction.id);
			expect(status).to.eql(Status.FAIL);
			expect(state)
				.to.be.an('object')
				.and.to.have.property('sender');
			expect((state as any).sender).to.have.property(
				'balance',
				new BigNum(MAX_TRANSACTION_AMOUNT)
					.add(validTestTransaction.fee)
					.toString(),
			);
			expect((errors as ReadonlyArray<TransactionError>)[0])
				.to.be.instanceof(TransactionError)
				.and.to.have.property('message', 'Invalid balance amount');
		});
	});

	describe('#isExpired', () => {
		let unexpiredTestTransaction: BaseTransaction;
		let expiredTestTransaction: BaseTransaction;
		beforeEach(async () => {
			const unexpiredTransaction = {
				...defaultTransaction,
				receivedAt: new Date(),
			};
			const expiredTransaction = {
				...defaultTransaction,
				receivedAt: new Date(+new Date() - 1300 * 60000),
			};
			unexpiredTestTransaction = new TestTransaction(unexpiredTransaction);
			expiredTestTransaction = new TestTransaction(expiredTransaction);
		});

		it('should return false for unexpired transaction', async () => {
			expect(unexpiredTestTransaction.isExpired()).to.be.false;
		});

		it('should return true for expired transaction', async () => {
			expect(expiredTestTransaction.isExpired(new Date())).to.be.true;
		});
	});

	describe('#sign', () => {
		const defaultPassphrase = 'passphrase';
		const defaultSecondPassphrase = 'second-passphrase';
		const defaultHash = Buffer.from(
			'0022dcb9040eb0a6d7b862dc35c856c02c47fde3b4f60f2f3571a888b9a8ca7540c6793243ef4d6324449e824f6319182b02111111',
			'hex',
		);
		const defaultSecondHash = Buffer.from(
			'0022dcb9040eb0a6d7b862dc35c856c02c47fde3b4f60f2f3571a888b9a8ca7540c6793243ef4d6324449e824f6319182b02000000',
			'hex',
		);
		const defaultSignature =
			'dc8fe25f817c81572585b3769f3c6df13d3dc93ff470b2abe807f43a3359ed94e9406d2539013971431f2d540e42dc7d3d71c7442da28572c827d59adc5dfa08';
		const defaultSecondSignature =
			'2092abc5dd72d42b289f69ddfa85d0145d0bfc19a0415be4496c189e5fdd5eff02f57849f484192b7d34b1671c17e5c22ce76479b411cad83681132f53d7b309';

		let signDataStub: SinonStub;

		beforeEach(async () => {
			const hashStub = sandbox
				.stub(cryptography, 'hash')
				.onFirstCall()
				.returns(defaultHash)
				.onSecondCall()
				.returns(defaultSecondHash);
			hashStub.returns(defaultHash);
			signDataStub = sandbox
				.stub(cryptography, 'signData')
				.onFirstCall()
				.returns(defaultSignature)
				.onSecondCall()
				.returns(defaultSecondSignature);
		});

		describe('when sign is called with passphrase', () => {
			beforeEach(async () => {
				validTestTransaction.sign(defaultPassphrase);
			});

			it('should set signature property', async () => {
				expect(validTestTransaction.signature).to.equal(defaultSignature);
			});

			it('should not set signSignature property', async () => {
				expect(validTestTransaction.signSignature).to.be.undefined;
			});

			it('should set id property', async () => {
				expect(validTestTransaction.id).not.to.be.empty;
			});

			it('should call signData with the hash result and the passphrase', async () => {
				expect(signDataStub).to.be.calledWithExactly(
					defaultHash,
					defaultPassphrase,
				);
			});
		});

		describe('when sign is called with passphrase and second passphrase', () => {
			beforeEach(async () => {
				validTestTransaction.sign(defaultPassphrase, defaultSecondPassphrase);
			});

			it('should set signature property', async () => {
				expect(validTestTransaction.signature).to.equal(defaultSignature);
			});

			it('should set signSignature property', async () => {
				expect(validTestTransaction.signSignature).to.equal(
					defaultSecondSignature,
				);
			});

			it('should set id property', async () => {
				expect(validTestTransaction.id).not.to.be.empty;
			});

			it('should call signData with the hash result and the passphrase', async () => {
				expect(signDataStub).to.be.calledWithExactly(
					defaultHash,
					defaultPassphrase,
				);
			});

			it('should call signData with the hash result and the passphrase', async () => {
				expect(signDataStub).to.be.calledWithExactly(
					defaultSecondHash,
					defaultSecondPassphrase,
				);
			});
		});
	});
});
