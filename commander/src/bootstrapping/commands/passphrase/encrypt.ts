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
 *
 */

import { Command, Flags as flagParser } from '@oclif/core';
import { encryptPassphrase } from '../../../utils/commons';
import { flagsWithParser } from '../../../utils/flags';
import { getPassphraseFromPrompt, getPasswordFromPrompt } from '../../../utils/reader';
import { handleOutputFlag } from '../../../utils/output';

const outputPublicKeyOptionDescription =
	'Includes the public key in the output. This option is provided for the convenience of node operators.';

export class EncryptCommand extends Command {
	static description = 'Encrypt secret passphrase using password.';

	static examples = [
		'passphrase:encrypt',
		'passphrase:encrypt --passphrase your-passphrase --output /mypath/keys.json',
		'passphrase:encrypt --password your-password',
		'passphrase:encrypt --password your-password --passphrase your-passphrase --output /mypath/keys.json',
		'passphrase:encrypt --output-public-key --output /mypath/keys.json',
	];

	static flags = {
		password: flagsWithParser.password,
		passphrase: flagsWithParser.passphrase,
		'output-public-key': flagParser.boolean({
			description: outputPublicKeyOptionDescription,
		}),
		output: flagParser.string({
			char: 'o',
			description: 'The output directory. Default will set to current working directory.',
		}),
	};

	async run(): Promise<void> {
		const {
			flags: {
				passphrase: passphraseSource,
				password: passwordSource,
				'output-public-key': outputPublicKey,
				output,
			},
		} = await this.parse(EncryptCommand);

		const passphrase = passphraseSource ?? (await getPassphraseFromPrompt('passphrase', true));
		const password = passwordSource ?? (await getPasswordFromPrompt('password', true));
		const result = await encryptPassphrase(passphrase, password, outputPublicKey);

		if (output) {
			const res = await handleOutputFlag(output, result, 'passphrase', 'keys.json');
			this.log(res);
		} else {
			this.log(JSON.stringify(result, undefined, '  '));
		}
	}
}
