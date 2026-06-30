import { parse } from 'dotenv';

import { Decryptor, Encryptor } from './crypto';
import { decryptProcessEnvSecrets, fileExists, getDecryptionKeyFromEnv } from './helpers';
import { readContentFromFile, transformContent } from './reader';
import { ConfigData, DefaultLoadOptions, LoadOptions } from './types';

export function encryptConfigData(encryptorOrKey: Encryptor | string, data: ConfigData): ConfigData {
    const encryptor = encryptorOrKey instanceof Encryptor ? encryptorOrKey : new Encryptor(encryptorOrKey);
    const encrypted: ConfigData = {};
    for (const [key, value] of Object.entries(data)) {
        encrypted[key] = encryptor.encryptValueIfNotEncrypted(value);
    }
    return encrypted;
}

export function decryptConfigData(decryptorOrKey: Decryptor | string, data: ConfigData): ConfigData {
    const decryptor = decryptorOrKey instanceof Decryptor ? decryptorOrKey : new Decryptor(decryptorOrKey);
    const decrypted: ConfigData = {};
    for (const [key, value] of Object.entries(data)) {
        decrypted[key] = decryptor.decryptValueIfEncrypted(value);
    }
    return decrypted;
}

export function parseEnvContent<T extends ConfigData>(content: string, decryptorOrKey?: Decryptor | string): T {
    const decryptor = decryptorOrKey instanceof Decryptor ? decryptorOrKey : new Decryptor(decryptorOrKey);
    const decryptedContent = transformContent(content, data => decryptConfigData(decryptor, data));
    const config = parse(decryptedContent);
    return config as T;
}

export function loadConfig<T extends ConfigData>(options?: LoadOptions): T {
    options = { ...DefaultLoadOptions, key: getDecryptionKeyFromEnv(), ...options };

    delete process.env.CONFIG_DECRYPTION_SECRET;
    delete process.env.CONFIG_DECRYPTION_KEY;

    if (!options.file) {
        const envFiles = options.env ? [`.env.${options.env}`, `.env.${options.env}.local`] : [];
        options.file = ['.env', '.env.local', ...envFiles];
    }

    const files = Array.isArray(options.file) ? options.file : ([options.file] as string[]);

    const decryptor = new Decryptor(options.key);

    const config: ConfigData = {};
    for (const file of files) {
        if (fileExists(file)) {
            const encryptedContent = readContentFromFile(file);
            const fileConfig = parseEnvContent(encryptedContent, decryptor);
            Object.assign(config, fileConfig);
        }
    }

    if (options.mergeProcessEnv !== false) {
        Object.assign(config, decryptProcessEnvSecrets(process.env, decryptor));
    }

    return config as T;
}

export function loadConfigIntoEnv(options?: LoadOptions): void {
    const resolved = loadConfig(options);
    Object.assign(process.env, resolved);
}

export { Decryptor, Encryptor };
