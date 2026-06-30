import { spawnSync } from 'child_process';
import { Command } from 'commander';
import { writeFileSync } from 'fs';

import { Decryptor, Encryptor } from './crypto';
import { decryptProcessEnvSecrets, fileExists, generateConfigKeyPair, getDecryptionKeyFromEnv } from './helpers';
import { keyMatches, readContentFromFile, transformContent } from './reader';
import { ConfigData } from './types';

type ConcatOutputFormat = 'dotenv' | 'json' | 'yaml';
type FormattedConfigData = { [key: string]: string | FormattedConfigData };

export const program = new Command();
program.enablePositionalOptions();

const decryptionKeyOptionDescription =
    'The decryption key (defaults to the value of the CONFIG_DECRYPTION_SECRET environment variable, falling back to CONFIG_DECRYPTION_KEY)';

program
    .command('sh [files...]')
    .description('Output export statements to set variables from the specified .env files')
    .option('-k, --key <key>', decryptionKeyOptionDescription)
    .action((files, options) => {
        files = files.length ? files : ['.env'];
        files = verifyFiles(files);

        const key = options.key ?? getDecryptionKeyFromEnv();
        exportFiles(files, key);
    });

program
    .command('shenv [environment]')
    .description('Output export statements to set variables from the specified environment')
    .option('-k, --key <key>', decryptionKeyOptionDescription)
    .action((env, options) => {
        const files = ['.env', '.env.local', `.env.${env}`, `.env.${env}.local`];
        const key = options.key ?? getDecryptionKeyFromEnv();
        exportFiles(files, key);
    });

program
    .command('encrypt [files...]')
    .description('Encrypts the specified .env files')
    .option('-k, --key <key>', 'The encryption key (defaults to the value of the CONFIG_ENCRYPTION_KEY environment variable)')
    .option('-e, --encrypt-keys <keys...>', 'The keys to encrypt (defaults to keys ending in _SECRET)')
    .action((files, options) => {
        files = files.length ? files : ['.env'];
        files = verifyFiles(files);

        const key = options.key ?? process.env.CONFIG_ENCRYPTION_KEY;
        const encryptKeys = options.encryptKeys ?? [/_SECRET$/];

        for (const file of files) {
            transformFile(file, data => {
                const fileKey = key ?? data.CONFIG_ENCRYPTION_KEY ?? data.__CONFIG_ENCRYPTION_KEY__;
                if (!fileKey) {
                    throw new Error(`No encryption key specified for ${file}`);
                }

                const encryptor = new Encryptor(fileKey);
                for (const key of Object.keys(data)) {
                    if (keyMatches(key, encryptKeys)) {
                        if (data[key].length) {
                            data[key] = encryptor.encryptValueIfNotEncrypted(data[key]);
                        }
                    }
                }
                return data;
            });
        }
    });

program
    .command('decrypt [files...]')
    .description('Decrypts the specified .env files')
    .option('-k, --key <key>', decryptionKeyOptionDescription)
    .option('--stdout', 'Print decrypted content to stdout instead of writing files in place')
    .action((files, options) => {
        files = files.length ? files : ['.env'];
        files = verifyFiles(files);

        const key = options.key ?? getDecryptionKeyFromEnv();
        if (!key) {
            throw new Error('No decryption key specified');
        }

        const decryptor = new Decryptor(key);
        files.forEach((file: string, index: number) => {
            const decryptedContent = decryptFileContent(file, decryptor);

            if (options.stdout) {
                process.stdout.write(decryptedContent);
                if (index < files.length - 1 && !decryptedContent.endsWith('\n')) {
                    process.stdout.write('\n');
                }
                return;
            }

            writeFileSync(file, decryptedContent);
        });
    });

program
    .command('generate-keys')
    .description('Generate a public/private key pair for encryption')
    .action(() => {
        const { privateKey, publicKey } = generateConfigKeyPair();
        console.log(`CONFIG_ENCRYPTION_KEY=${publicKey}`);
        console.log(`CONFIG_DECRYPTION_SECRET=${privateKey}`);
    });

program
    .command('verify [files...]')
    .description('Verifies that all secrets are encrypted correctly in a given .env file')
    .option('-k, --key <key>', decryptionKeyOptionDescription)
    .action((files, options) => {
        files = files.length ? files : ['.env'];
        files = verifyFiles(files);

        let numTotalErrors = 0;

        const key = options.key ?? getDecryptionKeyFromEnv();
        const decryptor = key ? new Decryptor(key) : null;

        if (!decryptor) {
            console.warn(`⚠️  will not check for encryption errors because no decryption key was provided\n`);
        }

        for (const file of files) {
            let numFileErrors = 0;

            transformFile(file, data => {
                for (const key of Object.keys(data)) {
                    if (!Decryptor.isValueEncrypted(data[key])) {
                        if (key.endsWith('_SECRET')) {
                            console.error(`${file}: ${key} is not encrypted`);
                            numFileErrors++;
                        }

                        continue;
                    }

                    if (!decryptor) {
                        continue;
                    }

                    const err = decryptor.tryDecryptValue(data[key]);
                    if (err) {
                        console.error(`${file}: ${key} is encrypted but cannot be decrypted`);
                        numFileErrors++;
                    }
                }

                return data;
            });

            if (numFileErrors === 0) {
                console.log(`✅ ${file}`);
            } else {
                console.error(`❌ ${file}: ${numFileErrors} errors found`);
                numTotalErrors += numFileErrors;
            }
        }

        if (numTotalErrors > 0) {
            process.exit(1);
        }
    });

program
    .command('exec')
    .description('Execute a command with environment variables loaded from .env files')
    .option('-e, --env <environment>', 'The environment to load (defaults to APP_ENV)')
    .option('-k, --key <key>', decryptionKeyOptionDescription)
    .allowExcessArguments()
    .passThroughOptions()
    .action((options, command) => {
        const args = command.args;
        if (!args.length) {
            console.error('No command specified');
            process.exit(1);
        }

        const environment = options.env ?? process.env.APP_ENV;
        const files = environment ? ['.env', '.env.local', `.env.${environment}`, `.env.${environment}.local`] : ['.env', '.env.local'];

        const key = options.key ?? getDecryptionKeyFromEnv();
        const env = loadEnvFromFiles(files, key);
        const inheritedEnv = decryptProcessEnvSecrets(process.env, new Decryptor(key));

        const result = spawnSync(args[0], args.slice(1), {
            stdio: 'inherit',
            env: { ...env, ...inheritedEnv }
        });

        if (result.error) {
            console.error(result.error.message);
            process.exit(1);
        }

        if (result.signal) {
            process.exit(128 + (result.status ?? 1));
        }

        process.exit(result.status ?? 1);
    });

program
    .command('concat [files...]')
    .description(
        'Merge .env files into a single output (later files win on duplicate keys), keeping values verbatim so encrypted secrets stay encrypted'
    )
    .option('-e, --env <environment>', 'Compose the file list from an environment name (.env + .env.<environment>) instead of listing files')
    .option('--local', 'Also include .local files (developer overrides; excluded by default)')
    .option('-f, --format <format>', 'Output format: dotenv, json, or yaml', 'dotenv')
    .option('-p, --prefix <prefix>', 'Prefix output keys')
    .option(
        '-x, --exclude <pattern>',
        'Exclude keys matching this regular expression (repeatable, e.g. -x ^VITE_)',
        (value: string, previous: string[]) => previous.concat(value),
        [] as string[]
    )
    .action((files, options) => {
        let resolved: string[];
        if (options.env) {
            resolved = options.local ? ['.env', '.env.local', `.env.${options.env}`, `.env.${options.env}.local`] : ['.env', `.env.${options.env}`];
        } else {
            resolved = verifyFiles(files.length ? files : ['.env']);
        }

        const exclude = (options.exclude as string[]).map(pattern => new RegExp(pattern));
        const format = getConcatOutputFormat(options.format);
        console.log(formatConfigData(concatEnvFiles(resolved, exclude), format, options.prefix));
    });

// helpers

function verifyFiles(files: string[]) {
    return files.filter(file => {
        if (!fileExists(file)) {
            process.stderr.write(`'${file}' does not exist\n`);
            return false;
        }
        return true;
    });
}

function transformFile(path: string, transform: (data: ConfigData) => ConfigData) {
    const originalContent = readContentFromFile(path);
    const updatedContent = transformContent(originalContent, transform);
    writeFileSync(path, updatedContent);
}

function decryptFileContent(file: string, decryptor: Decryptor) {
    const originalContent = readContentFromFile(file);
    return transformContent(originalContent, data => {
        for (const key of Object.keys(data)) {
            try {
                data[key] = decryptor.decryptValueIfEncrypted(data[key]);
            } catch (err) {
                console.error(`${file}: ${key} cannot be decrypted`);
                throw err;
            }
        }
        return data;
    });
}

function loadEnvFromFiles(files: string[], key: string): ConfigData {
    const result: ConfigData = {};
    const decryptor = new Decryptor(key);

    for (const file of files) {
        if (fileExists(file)) {
            const originalContent = readContentFromFile(file);
            transformContent(originalContent, data => {
                for (const [key, value] of Object.entries(data)) {
                    result[key] = decryptor.decryptValueIfEncrypted(value);
                }
                return data;
            });
        }
    }

    return result;
}

function exportFiles(files: string[], key: string) {
    const result = loadEnvFromFiles(files, key);

    for (const [key, value] of Object.entries(result)) {
        if (!process.env[key]) {
            console.log(`export ${key}="${value}"`);
        }
    }
}

function concatEnvFiles(files: string[], exclude: RegExp[]): ConfigData {
    const merged: ConfigData = {};

    for (const file of files) {
        if (!fileExists(file)) {
            continue;
        }

        const content = readContentFromFile(file);
        for (const line of content.split('\n')) {
            if (line.startsWith('#')) {
                continue;
            }

            const matches = line.match(/^([^=]+)=(.*)$/);
            if (!matches) {
                continue;
            }

            const [, key, value] = matches;
            if (exclude.length && keyMatches(key, exclude)) {
                continue;
            }

            merged[key] = value;
        }
    }

    return merged;
}

function getConcatOutputFormat(format: string): ConcatOutputFormat {
    if (format === 'dotenv' || format === 'json' || format === 'yaml') {
        return format;
    }

    throw new Error(`Unsupported concat output format: ${format}`);
}

function formatConfigData(data: ConfigData, format: ConcatOutputFormat, prefix = ''): string {
    const formatted = applyConcatPrefix(data, format, prefix);

    if (format === 'json') {
        return JSON.stringify(formatted, null, 4);
    }

    if (format === 'yaml') {
        return formatYamlData(formatted);
    }

    return Object.entries(formatted)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
}

function applyConcatPrefix(data: ConfigData, format: ConcatOutputFormat, prefix: string): FormattedConfigData {
    if (!prefix || Object.keys(data).length === 0) {
        return data;
    }

    if (format === 'dotenv' || !prefix.includes('.')) {
        return prefixConfigKeys(data, prefix);
    }

    const parts = prefix.split('.');
    const keyPrefix = parts.pop() ?? '';
    let formatted: FormattedConfigData = prefixConfigKeys(data, keyPrefix);

    for (const part of parts.reverse()) {
        formatted = { [part]: formatted };
    }

    return formatted;
}

function prefixConfigKeys(data: ConfigData, prefix: string): ConfigData {
    const prefixed: ConfigData = {};

    for (const [key, value] of Object.entries(data)) {
        prefixed[`${prefix}${key}`] = value;
    }

    return prefixed;
}

function formatYamlData(data: FormattedConfigData, indent = 0): string {
    return Object.entries(data)
        .map(([key, value]) => {
            const prefix = `${'  '.repeat(indent)}${formatYamlKey(key)}:`;
            if (typeof value === 'string') {
                return `${prefix} ${formatYamlString(value)}`;
            }

            return `${prefix}\n${formatYamlData(value, indent + 1)}`;
        })
        .join('\n');
}

function formatYamlKey(key: string): string {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        return key;
    }

    return formatYamlString(key);
}

function formatYamlString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}
