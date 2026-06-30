import { generateKeyPairSync } from 'crypto';
import { existsSync } from 'fs';

import type { ConfigData } from './types';

import { Decryptor } from './crypto';

export function generateConfigKeyPair() {
    const { privateKey, publicKey } = generateKeyPairSync('x25519', {
        publicKeyEncoding: {
            type: 'spki',
            format: 'der'
        },
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'der'
        }
    });

    return {
        privateKey: privateKey.toString('base64').replace(/=+$/, ''),
        publicKey: publicKey.toString('base64').replace(/=+$/, '')
    };
}

export function getDecryptionKeyFromEnv() {
    return process.env.CONFIG_DECRYPTION_SECRET ?? process.env.CONFIG_DECRYPTION_KEY;
}

export function getPath(path: string) {
    if (process.env.CONFIG_PATH) {
        return `${process.env.CONFIG_PATH}/${path}`;
    }
    return path;
}

export function fileExists(path: string) {
    return existsSync(getPath(path));
}

export function decryptProcessEnvSecrets(env: NodeJS.ProcessEnv, decryptor: Decryptor): ConfigData {
    const result: ConfigData = {};

    for (const [key, value] of Object.entries(env)) {
        if (value === undefined) {
            continue;
        }

        if (!key.endsWith('_SECRET')) {
            result[key] = value;
            continue;
        }

        try {
            result[key] = decryptor.decryptValueIfEncrypted(value);
        } catch {
            result[key] = value;
        }
    }

    return result;
}
