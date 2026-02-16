import { cpSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { describe, it, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert';

import { generateConfigKeyPair } from '../src/helpers';

let importCounter = 0;
async function getProgram() {
    const program = (await import(`../src/cli.program?t=${importCounter++}`)).program;
    program.exitOverride();
    return program;
}

describe('CLI', () => {
    beforeEach(() => {
        mock.restoreAll();
        delete process.env.CONFIG_ENCRYPTION_KEY;
        delete process.env.CONFIG_DECRYPTION_KEY;
        cpSync(`${__dirname}/fixtures/sample.env`, `${__dirname}/fixtures/cli.env.test`);
    });

    after(() => {
        rmSync(`${__dirname}/fixtures/cli.env.test`);
    });

    it('should generate encryption keys', async () => {
        const program = await getProgram();
        const logMock = mock.method(console, 'log', () => {});
        program.parse(['generate-keys'], { from: 'user' });
        assert.ok(
            logMock.mock.calls.some(call => call.arguments[0].startsWith('CONFIG_ENCRYPTION_KEY=')),
            'should log CONFIG_ENCRYPTION_KEY'
        );
        assert.ok(
            logMock.mock.calls.some(call => call.arguments[0].startsWith('CONFIG_DECRYPTION_KEY=')),
            'should log CONFIG_DECRYPTION_KEY'
        );
    });

    it('should require an encryption key', async () => {
        const program = await getProgram();
        assert.throws(
            () => {
                program.parse(['encrypt', `${__dirname}/fixtures/cli.env.test`], { from: 'user' });
            },
            { message: /^No encryption key specified for .*cli\.env\.test/ }
        );
    });

    it('should encrypt and decrypt with keys specified on the command line', async () => {
        const program = await getProgram();

        const beforeContent = readFileSync(`${__dirname}/fixtures/cli.env.test`, 'utf8');

        const { privateKey, publicKey } = generateConfigKeyPair();

        program.parse(['encrypt', `${__dirname}/fixtures/cli.env.test`, '-k', publicKey], { from: 'user' });
        const encryptedContent = readFileSync(`${__dirname}/fixtures/cli.env.test`, 'utf8');
        assert.notStrictEqual(beforeContent, encryptedContent);
        assert.match(encryptedContent, /^VAR_3_SECRET=\$\$\[.*\]$/m);
        assert.match(encryptedContent, /^VAR_5_SECRET=\$\$\[.*\]$/m);

        program.parse(['decrypt', `${__dirname}/fixtures/cli.env.test`, '-k', privateKey], { from: 'user' });
        const afterContent = readFileSync(`${__dirname}/fixtures/cli.env.test`, 'utf8');
        assert.strictEqual(beforeContent, afterContent);
    });

    it('should encrypt and decrypt with keys specified in the environment', async () => {
        const program = await getProgram();

        const beforeContent = readFileSync(`${__dirname}/fixtures/cli.env.test`, 'utf8');

        const { privateKey, publicKey } = generateConfigKeyPair();
        process.env.CONFIG_ENCRYPTION_KEY = publicKey;
        process.env.CONFIG_DECRYPTION_KEY = privateKey;

        program.parse(['encrypt', `${__dirname}/fixtures/cli.env.test`], { from: 'user' });
        const encryptedContent = readFileSync(`${__dirname}/fixtures/cli.env.test`, 'utf8');
        assert.notStrictEqual(beforeContent, encryptedContent);
        assert.match(encryptedContent, /^VAR_3_SECRET=\$\$\[.*\]$/m);
        assert.match(encryptedContent, /^VAR_5_SECRET=\$\$\[.*\]$/m);

        program.parse(['decrypt', `${__dirname}/fixtures/cli.env.test`], { from: 'user' });
        const afterContent = readFileSync(`${__dirname}/fixtures/cli.env.test`, 'utf8');
        assert.strictEqual(beforeContent, afterContent);
    });

    it('should encrypt with a key specified in the file', async () => {
        const program = await getProgram();

        const beforeContent = readFileSync(`${__dirname}/fixtures/cli.env.test`, 'utf8');

        const { privateKey, publicKey } = generateConfigKeyPair();
        const beforeContentWithKey = `CONFIG_ENCRYPTION_KEY=${publicKey}\n\n${beforeContent}`;
        writeFileSync(`${__dirname}/fixtures/cli.env.test`, beforeContentWithKey, 'utf8');

        program.parse(['encrypt', `${__dirname}/fixtures/cli.env.test`], { from: 'user' });
        const encryptedContent = readFileSync(`${__dirname}/fixtures/cli.env.test`, 'utf8');
        assert.notStrictEqual(beforeContent, encryptedContent);
        assert.match(encryptedContent, /^VAR_3_SECRET=\$\$\[.*\]$/m);
        assert.match(encryptedContent, /^VAR_5_SECRET=\$\$\[.*\]$/m);

        program.parse(['decrypt', `${__dirname}/fixtures/cli.env.test`, '-k', privateKey], { from: 'user' });
        const afterContent = readFileSync(`${__dirname}/fixtures/cli.env.test`, 'utf8');
        assert.strictEqual(beforeContentWithKey, afterContent);
    });

    it('should encrypt only the specified keys', async () => {
        const program = await getProgram();

        const beforeContent = readFileSync(`${__dirname}/fixtures/cli.env.test`, 'utf8');

        const { privateKey, publicKey } = generateConfigKeyPair();

        program.parse(['encrypt', `${__dirname}/fixtures/cli.env.test`, '-k', publicKey, '-e', 'VAR_2', 'VAR_4'], { from: 'user' });
        const encryptedContent = readFileSync(`${__dirname}/fixtures/cli.env.test`, 'utf8');
        assert.notStrictEqual(beforeContent, encryptedContent);
        assert.match(encryptedContent, /^VAR_2=\$\$\[.*\]$/m);
        assert.match(encryptedContent, /^VAR_4=\$\$\[.*\]$/m);

        program.parse(['decrypt', `${__dirname}/fixtures/cli.env.test`, '-k', privateKey], { from: 'user' });
        const afterContent = readFileSync(`${__dirname}/fixtures/cli.env.test`, 'utf8');
        assert.strictEqual(beforeContent, afterContent);
    });
});
