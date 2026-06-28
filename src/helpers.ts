import { generateKeyPairSync } from 'crypto';
import { existsSync } from 'fs';

export function generateConfigKeyPair() {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
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
