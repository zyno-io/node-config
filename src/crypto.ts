import {
    constants,
    createCipheriv,
    createDecipheriv,
    createPrivateKey,
    createPublicKey,
    diffieHellman,
    generateKeyPairSync,
    hkdfSync,
    KeyObject,
    privateDecrypt,
    publicEncrypt,
    randomBytes
} from 'crypto';

const VERSION_RSA_AES_CBC = 1;
const VERSION_X25519_AES_GCM = 2;
const RSA_2048_ENCRYPTED_KEY_LENGTH = 256;
const AES_CBC_IV_LENGTH = 16;
const X25519_PUBLIC_KEY_DER_LENGTH = 44;
const AES_GCM_IV_LENGTH = 12;
const AES_GCM_AUTH_TAG_LENGTH = 16;
const X25519_HKDF_INFO = Buffer.from('node-config:v2:x25519-aes-256-gcm');

export class Encryptor {
    private publicKey: KeyObject;

    constructor(publicKey: string) {
        this.publicKey = createPublicKey({
            key: Buffer.from(publicKey, 'base64'),
            format: 'der',
            type: 'spki'
        });
    }

    encryptValue(value: string) {
        if (this.publicKey.asymmetricKeyType === 'rsa') {
            return this.encryptValueV1(value);
        }

        if (this.publicKey.asymmetricKeyType === 'x25519') {
            return this.encryptValueV2(value);
        }

        throw new Error(`Unsupported encryption key type: ${this.publicKey.asymmetricKeyType}`);
    }

    private encryptValueV1(value: string) {
        const key = randomBytes(32);
        const encryptedKey = publicEncrypt(
            {
                key: this.publicKey,
                padding: constants.RSA_PKCS1_OAEP_PADDING
            },
            key
        );

        const iv = randomBytes(16);
        const cipher = createCipheriv('aes-256-cbc', key, iv);
        const encryptedValue = Buffer.concat([cipher.update(value), cipher.final()]);

        const outputBuffer = Buffer.alloc(1 + encryptedKey.length + iv.length + encryptedValue.length);
        outputBuffer.writeUInt8(VERSION_RSA_AES_CBC, 0);
        encryptedKey.copy(outputBuffer, 1);
        iv.copy(outputBuffer, 1 + encryptedKey.length);
        encryptedValue.copy(outputBuffer, 1 + iv.length + encryptedKey.length);
        const encryptedText = outputBuffer.toString('base64').replace(/=+$/, '');

        return `$$[${encryptedText}]`;
    }

    private encryptValueV2(value: string) {
        const { privateKey: ephemeralPrivateKey, publicKey: ephemeralPublicKey } = generateKeyPairSync('x25519');
        const ephemeralPublicKeyDer = ephemeralPublicKey.export({
            format: 'der',
            type: 'spki'
        }) as Buffer;

        const sharedSecret = diffieHellman({
            privateKey: ephemeralPrivateKey,
            publicKey: this.publicKey
        });
        const iv = randomBytes(AES_GCM_IV_LENGTH);
        const key = deriveX25519Key(sharedSecret, iv);

        const cipher = createCipheriv('aes-256-gcm', key, iv);
        cipher.setAAD(getX25519AssociatedData(ephemeralPublicKeyDer));
        const encryptedValue = Buffer.concat([cipher.update(value), cipher.final()]);
        const authTag = cipher.getAuthTag();

        const outputBuffer = Buffer.concat([Buffer.from([VERSION_X25519_AES_GCM]), ephemeralPublicKeyDer, iv, authTag, encryptedValue]);
        const encryptedText = outputBuffer.toString('base64').replace(/=+$/, '');

        return `$$[${encryptedText}]`;
    }

    encryptValueIfNotEncrypted(value: string) {
        if (value.length === 0) return value;
        if (value.startsWith('$$[') && value.endsWith(']')) {
            return value;
        }
        return this.encryptValue(value);
    }
}

export class Decryptor {
    private privateKey?: KeyObject;

    constructor(privateKey?: string) {
        if (privateKey) {
            this.privateKey = createPrivateKey({
                key: Buffer.from(privateKey, 'base64'),
                format: 'der',
                type: 'pkcs8'
            });
        }
    }

    static isValueEncrypted(value: string) {
        return value.startsWith('$$[') && value.endsWith(']');
    }

    decryptValue(value: string) {
        if (!this.privateKey) {
            throw new Error('No decryption key was provided');
        }

        value = value.substring(3, value.length - 1);
        const buffer = Buffer.from(value, 'base64');

        const version = buffer.readUInt8(0);
        if (version === VERSION_RSA_AES_CBC) {
            return this.decryptValueV1(buffer, this.privateKey);
        }

        if (version === VERSION_X25519_AES_GCM) {
            return this.decryptValueV2(buffer, this.privateKey);
        }

        throw new Error(`Unsupported encryption version: ${version}`);
    }

    private decryptValueV1(buffer: Buffer, privateKey: KeyObject) {
        const encryptedKey = buffer.subarray(1, 1 + RSA_2048_ENCRYPTED_KEY_LENGTH);
        const iv = buffer.subarray(1 + RSA_2048_ENCRYPTED_KEY_LENGTH, 1 + RSA_2048_ENCRYPTED_KEY_LENGTH + AES_CBC_IV_LENGTH);
        const encryptedValue = buffer.subarray(1 + RSA_2048_ENCRYPTED_KEY_LENGTH + AES_CBC_IV_LENGTH);

        const decryptedKey = privateDecrypt(
            {
                key: privateKey,
                padding: constants.RSA_PKCS1_OAEP_PADDING
            },
            encryptedKey
        );
        const decipher = createDecipheriv('aes-256-cbc', decryptedKey, iv);
        const decryptedValue = Buffer.concat([decipher.update(encryptedValue), decipher.final()]);
        return decryptedValue.toString();
    }

    private decryptValueV2(buffer: Buffer, privateKey: KeyObject) {
        if (privateKey.asymmetricKeyType !== 'x25519') {
            throw new Error(`Unsupported decryption key type for version 2: ${privateKey.asymmetricKeyType}`);
        }

        const minimumLength = 1 + X25519_PUBLIC_KEY_DER_LENGTH + AES_GCM_IV_LENGTH + AES_GCM_AUTH_TAG_LENGTH;
        if (buffer.length < minimumLength) {
            throw new Error('Invalid encrypted value');
        }

        const publicKeyStart = 1;
        const ivStart = publicKeyStart + X25519_PUBLIC_KEY_DER_LENGTH;
        const authTagStart = ivStart + AES_GCM_IV_LENGTH;
        const encryptedValueStart = authTagStart + AES_GCM_AUTH_TAG_LENGTH;
        const ephemeralPublicKeyDer = buffer.subarray(publicKeyStart, ivStart);
        const iv = buffer.subarray(ivStart, authTagStart);
        const authTag = buffer.subarray(authTagStart, encryptedValueStart);
        const encryptedValue = buffer.subarray(encryptedValueStart);

        const ephemeralPublicKey = createPublicKey({
            key: ephemeralPublicKeyDer,
            format: 'der',
            type: 'spki'
        });
        const sharedSecret = diffieHellman({
            privateKey,
            publicKey: ephemeralPublicKey
        });
        const key = deriveX25519Key(sharedSecret, iv);

        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(getX25519AssociatedData(ephemeralPublicKeyDer));
        decipher.setAuthTag(authTag);
        const decryptedValue = Buffer.concat([decipher.update(encryptedValue), decipher.final()]);
        return decryptedValue.toString();
    }

    tryDecryptValue(value: string) {
        try {
            this.decryptValue(value);
        } catch (err) {
            return err;
        }

        return null;
    }

    decryptValueIfEncrypted(value: string) {
        if (Decryptor.isValueEncrypted(value)) {
            return this.decryptValue(value);
        }
        return value;
    }
}

function deriveX25519Key(sharedSecret: Buffer, salt: Buffer) {
    return Buffer.from(hkdfSync('sha256', sharedSecret, salt, X25519_HKDF_INFO, 32));
}

function getX25519AssociatedData(ephemeralPublicKeyDer: Buffer) {
    return Buffer.concat([Buffer.from([VERSION_X25519_AES_GCM]), ephemeralPublicKeyDer]);
}
