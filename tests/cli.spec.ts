import { cpSync, readFileSync, rmSync, writeFileSync } from 'fs';
import assert from 'node:assert';
import { describe, it, beforeEach, after, mock } from 'node:test';

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
        delete process.env.APP_ENV;
        cpSync(`${__dirname}/fixtures/sample.env`, `${__dirname}/fixtures/cli.env.test`);
    });

    after(() => {
        rmSync(`${__dirname}/fixtures/cli.env.test`, { force: true });
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

    describe('verify', () => {
        it('should pass verification for a correctly encrypted file', async () => {
            const program = await getProgram();
            const { privateKey, publicKey } = generateConfigKeyPair();

            program.parse(['encrypt', `${__dirname}/fixtures/cli.env.test`, '-k', publicKey], { from: 'user' });

            const logMock = mock.method(console, 'log', () => {});
            program.parse(['verify', `${__dirname}/fixtures/cli.env.test`, '-k', privateKey], { from: 'user' });

            assert.ok(
                logMock.mock.calls.some(call => call.arguments[0]?.includes('cli.env.test')),
                'should log the verified file'
            );
        });

        it('should warn when no decryption key is provided', async () => {
            const program = await getProgram();
            const { publicKey } = generateConfigKeyPair();

            program.parse(['encrypt', `${__dirname}/fixtures/cli.env.test`, '-k', publicKey], { from: 'user' });

            const warnMock = mock.method(console, 'warn', () => {});
            const logMock = mock.method(console, 'log', () => {});
            program.parse(['verify', `${__dirname}/fixtures/cli.env.test`], { from: 'user' });

            assert.ok(
                warnMock.mock.calls.some(call => call.arguments[0]?.includes('no decryption key')),
                'should warn about missing key'
            );
            assert.ok(
                logMock.mock.calls.some(call => call.arguments[0]?.includes('cli.env.test')),
                'should still pass (no decrypt check)'
            );
        });

        it('should detect unencrypted secrets', async () => {
            const program = await getProgram();
            const exitMock = mock.method(process, 'exit', () => {
                throw new Error('process.exit');
            });
            const errorMock = mock.method(console, 'error', () => {});

            assert.throws(() => program.parse(['verify', `${__dirname}/fixtures/cli.env.test`], { from: 'user' }), { message: 'process.exit' });

            assert.ok(
                errorMock.mock.calls.some(call => call.arguments[0]?.includes('is not encrypted')),
                'should report unencrypted secrets'
            );
            exitMock.mock.restore();
        });
    });

    describe('sh', () => {
        it('should output export statements for an unencrypted file', async () => {
            const program = await getProgram();
            const logMock = mock.method(console, 'log', () => {});

            program.parse(['sh', `${__dirname}/fixtures/cli.env.test`], { from: 'user' });

            const output = logMock.mock.calls.map(call => call.arguments[0]).join('\n');
            assert.match(output, /export VAR_1="a"/);
            assert.match(output, /export VAR_2="b"/);
        });

        it('should output export statements for an encrypted file with a key', async () => {
            const program = await getProgram();
            const { privateKey, publicKey } = generateConfigKeyPair();

            program.parse(['encrypt', `${__dirname}/fixtures/cli.env.test`, '-k', publicKey], { from: 'user' });

            const logMock = mock.method(console, 'log', () => {});
            program.parse(['sh', `${__dirname}/fixtures/cli.env.test`, '-k', privateKey], { from: 'user' });

            const output = logMock.mock.calls.map(call => call.arguments[0]).join('\n');
            assert.match(output, /export VAR_1="a"/);
            assert.match(output, /export VAR_3_SECRET="the quick brown fox jumps over the lazy dog"/);
        });

        it('should not export variables already set in the environment', async () => {
            const program = await getProgram();
            process.env.VAR_1 = 'already_set';

            const logMock = mock.method(console, 'log', () => {});
            program.parse(['sh', `${__dirname}/fixtures/cli.env.test`], { from: 'user' });

            const output = logMock.mock.calls.map(call => call.arguments[0]).join('\n');
            assert.doesNotMatch(output, /export VAR_1=/);
            assert.match(output, /export VAR_2="b"/);

            delete process.env.VAR_1;
        });
    });

    describe('exec', () => {
        it('should execute a command with env vars from .env files', async () => {
            const program = await getProgram();
            const exitMock = mock.method(process, 'exit', () => {
                throw new Error('process.exit');
            });

            // Use the test fixture as the .env file by setting CONFIG_PATH
            process.env.CONFIG_PATH = `${__dirname}/fixtures`;
            cpSync(`${__dirname}/fixtures/sample.env`, `${__dirname}/fixtures/.env`);

            try {
                assert.throws(() => program.parse(['exec', '--', 'echo', 'hello'], { from: 'user' }), { message: 'process.exit' });

                // spawnSync was called and process.exit was invoked
                assert.ok(exitMock.mock.calls.length > 0, 'process.exit should have been called');
            } finally {
                exitMock.mock.restore();
                rmSync(`${__dirname}/fixtures/.env`);
                delete process.env.CONFIG_PATH;
            }
        });

        it('should use APP_ENV to determine env files', async () => {
            const program = await getProgram();
            const exitMock = mock.method(process, 'exit', () => {
                throw new Error('process.exit');
            });

            process.env.CONFIG_PATH = `${__dirname}/fixtures`;
            process.env.APP_ENV = 'test';
            cpSync(`${__dirname}/fixtures/sample.env`, `${__dirname}/fixtures/.env`);

            try {
                assert.throws(() => program.parse(['exec', '--', 'echo', 'hello'], { from: 'user' }), { message: 'process.exit' });

                assert.ok(exitMock.mock.calls.length > 0, 'process.exit should have been called');
            } finally {
                exitMock.mock.restore();
                rmSync(`${__dirname}/fixtures/.env`);
                delete process.env.CONFIG_PATH;
                delete process.env.APP_ENV;
            }
        });

        it('should use -e flag to specify environment', async () => {
            const program = await getProgram();
            const exitMock = mock.method(process, 'exit', () => {
                throw new Error('process.exit');
            });

            process.env.CONFIG_PATH = `${__dirname}/fixtures`;
            cpSync(`${__dirname}/fixtures/sample.env`, `${__dirname}/fixtures/.env`);
            cpSync(`${__dirname}/fixtures/sample.env`, `${__dirname}/fixtures/.env.staging`);

            try {
                assert.throws(() => program.parse(['exec', '-e', 'staging', '--', 'echo', 'hello'], { from: 'user' }), { message: 'process.exit' });

                assert.ok(exitMock.mock.calls.length > 0, 'process.exit should have been called');
            } finally {
                exitMock.mock.restore();
                rmSync(`${__dirname}/fixtures/.env`);
                rmSync(`${__dirname}/fixtures/.env.staging`);
                delete process.env.CONFIG_PATH;
            }
        });

        it('should exit with error when no command is specified', async () => {
            const program = await getProgram();
            const exitMock = mock.method(process, 'exit', () => {
                throw new Error('process.exit');
            });
            const errorMock = mock.method(console, 'error', () => {});

            try {
                assert.throws(() => program.parse(['exec'], { from: 'user' }), { message: 'process.exit' });

                assert.ok(
                    errorMock.mock.calls.some(call => call.arguments[0] === 'No command specified'),
                    'should log "No command specified"'
                );
            } finally {
                exitMock.mock.restore();
            }
        });

        it('should pass through the exit code of the spawned process', async () => {
            const program = await getProgram();
            const exitCodes: number[] = [];
            const exitMock = mock.method(process, 'exit', (code: number) => {
                exitCodes.push(code);
                throw new Error('process.exit');
            });

            process.env.CONFIG_PATH = `${__dirname}/fixtures`;
            cpSync(`${__dirname}/fixtures/sample.env`, `${__dirname}/fixtures/.env`);

            try {
                assert.throws(() => program.parse(['exec', '--', 'node', '-e', 'process.exit(0)'], { from: 'user' }), { message: 'process.exit' });

                assert.strictEqual(exitCodes[0], 0, 'should exit with code 0');
            } finally {
                exitMock.mock.restore();
                rmSync(`${__dirname}/fixtures/.env`);
                delete process.env.CONFIG_PATH;
            }
        });

        it('should decrypt env vars when a key is provided', async () => {
            const program = await getProgram();
            const exitMock = mock.method(process, 'exit', () => {
                throw new Error('process.exit');
            });

            const { privateKey, publicKey } = generateConfigKeyPair();

            process.env.CONFIG_PATH = `${__dirname}/fixtures`;
            cpSync(`${__dirname}/fixtures/sample.env`, `${__dirname}/fixtures/.env`);

            // Encrypt the .env file first
            program.parse(['encrypt', `${__dirname}/fixtures/.env`, '-k', publicKey], { from: 'user' });

            try {
                // exec with decryption key - should run and call process.exit
                assert.throws(() => program.parse(['exec', '-k', privateKey, '--', 'node', '-e', 'process.exit(0)'], { from: 'user' }), {
                    message: 'process.exit'
                });

                assert.ok(exitMock.mock.calls.length > 0, 'process.exit should have been called');
            } finally {
                exitMock.mock.restore();
                rmSync(`${__dirname}/fixtures/.env`);
                delete process.env.CONFIG_PATH;
            }
        });
    });

    describe('concat', () => {
        it('should merge files with later files winning on duplicate keys', async () => {
            const program = await getProgram();
            const a = `${__dirname}/fixtures/concat.a.test`;
            const b = `${__dirname}/fixtures/concat.b.test`;
            writeFileSync(a, 'SHARED=from_a\nONLY_A=1\n');
            writeFileSync(b, 'SHARED=from_b\nONLY_B=2\n');

            const logMock = mock.method(console, 'log', () => {});
            try {
                program.parse(['concat', a, b], { from: 'user' });
                const output = logMock.mock.calls.map(call => call.arguments[0]).join('\n');
                assert.match(output, /^SHARED=from_b$/m);
                assert.match(output, /^ONLY_A=1$/m);
                assert.match(output, /^ONLY_B=2$/m);
                assert.doesNotMatch(output, /from_a/);
            } finally {
                rmSync(a, { force: true });
                rmSync(b, { force: true });
            }
        });

        it('should keep encrypted values verbatim without a decryption key', async () => {
            const program = await getProgram();
            const f = `${__dirname}/fixtures/concat.enc.test`;
            writeFileSync(f, 'PLAIN=hello\nTOKEN_SECRET=$$[ZW5jcnlwdGVk]\n');

            const logMock = mock.method(console, 'log', () => {});
            try {
                program.parse(['concat', f], { from: 'user' });
                const output = logMock.mock.calls.map(call => call.arguments[0]).join('\n');
                assert.match(output, /^TOKEN_SECRET=\$\$\[ZW5jcnlwdGVk\]$/m);
                assert.match(output, /^PLAIN=hello$/m);
            } finally {
                rmSync(f, { force: true });
            }
        });

        it('should exclude keys matching --exclude patterns', async () => {
            const program = await getProgram();
            const f = `${__dirname}/fixtures/concat.exclude.test`;
            writeFileSync(f, 'VITE_PUBLIC=x\nBACKEND=y\n');

            const logMock = mock.method(console, 'log', () => {});
            try {
                program.parse(['concat', f, '-x', '^VITE_'], { from: 'user' });
                const output = logMock.mock.calls.map(call => call.arguments[0]).join('\n');
                assert.match(output, /^BACKEND=y$/m);
                assert.doesNotMatch(output, /VITE_PUBLIC/);
            } finally {
                rmSync(f, { force: true });
            }
        });

        it('should resolve env files with -e and exclude .local by default', async () => {
            const program = await getProgram();
            process.env.CONFIG_PATH = `${__dirname}/fixtures`;
            writeFileSync(`${__dirname}/fixtures/.env`, 'BASE=base\nSHARED=base\n');
            writeFileSync(`${__dirname}/fixtures/.env.staging`, 'SHARED=staging\nSTG=1\n');
            writeFileSync(`${__dirname}/fixtures/.env.staging.local`, 'LOCAL_ONLY=secret\n');

            const logMock = mock.method(console, 'log', () => {});
            try {
                program.parse(['concat', '-e', 'staging'], { from: 'user' });
                const output = logMock.mock.calls.map(call => call.arguments[0]).join('\n');
                assert.match(output, /^BASE=base$/m);
                assert.match(output, /^SHARED=staging$/m);
                assert.match(output, /^STG=1$/m);
                assert.doesNotMatch(output, /LOCAL_ONLY/);
            } finally {
                rmSync(`${__dirname}/fixtures/.env`, { force: true });
                rmSync(`${__dirname}/fixtures/.env.staging`, { force: true });
                rmSync(`${__dirname}/fixtures/.env.staging.local`, { force: true });
                delete process.env.CONFIG_PATH;
            }
        });

        it('should include .local files with --local', async () => {
            const program = await getProgram();
            process.env.CONFIG_PATH = `${__dirname}/fixtures`;
            writeFileSync(`${__dirname}/fixtures/.env`, 'BASE=base\n');
            writeFileSync(`${__dirname}/fixtures/.env.staging.local`, 'LOCAL_ONLY=secret\n');

            const logMock = mock.method(console, 'log', () => {});
            try {
                program.parse(['concat', '-e', 'staging', '--local'], { from: 'user' });
                const output = logMock.mock.calls.map(call => call.arguments[0]).join('\n');
                assert.match(output, /^LOCAL_ONLY=secret$/m);
            } finally {
                rmSync(`${__dirname}/fixtures/.env`, { force: true });
                rmSync(`${__dirname}/fixtures/.env.staging.local`, { force: true });
                delete process.env.CONFIG_PATH;
            }
        });
    });
});
