# @zyno-io/config

TypeScript package for encrypting & decrypting secrets in and loading config from .env files. Leverages asymmetric keys so that any developer with access can add & update secrets, but only those with the private key (typically admins and your infrastructure itself) can decrypt secrets.

## How does this work?

A pair of RSA-2048 keys (one public, one private) are generated as your encryption keys. For each secret that needs to be encrypted:

- a random AES-256 key is generated
- the secret is encrypted with the AES-256 key
- the key is wrapped with the public RSA key
- the version number (of the encryption scheme), the encrypted/wrapped key, the AES IV, and the AES-encrypted secret are combined into a single payload
- the plaintext secret is replaced with the payload, base64-encoded (and a prefix/suffix to indicate that it's an encrypted value)

## Installation

```
yarn add @zyno-io/config
```

## Setup

Generate a key pair:

```
npx config-cli generate-keys

# alternatively, use Docker:
docker run --rm -it ghcr.io/zyno-io/node-config generate-keys
```

Create a .env file with typical `key=value` pairs, but suffix any secret key with `_SECRET`. For example:

```
CONFIG_ENCRYPTION_KEY=...copied from above...
TWILIO_ACCOUNT_SID=AC123456
TWILIO_AUTH_TOKEN_SECRET=SecretToken
```

Encrypt the secrets:

```
npx config-cli encrypt .env

# alternatively, use Docker
docker run --rm -it -v `pwd`:/src -w /src ghcr.io/zyno-io/node-config encrypt .env
```

Your .env file now contains encrypted values:

```
CONFIG_ENCRYPTION_KEY=...copied from above...
TWILIO_ACCOUNT_SID=AC123456
TWILIO_AUTH_TOKEN_SECRET=$$[AQJLlkLEOjifkSWRHozwOK78xJfym11/utjD7NZwbYXOUTMMXHg+Fa34wt/ytB4LRB2kiD6qXSYTQQLPYRmxN+1/VcvWCATWPUXJEN+pl8MiaO5boOGMYqcTT9JVUQ+dyEZelJkR+fuhzAeoANKyicPFwYa7DiLRwUlLxca/7lnEiROzrh1YNtvWPM0+J3yjjh/zbwbRUWCVFRcP/jmToE5EGifGYhpSjzY004LDWNfF8fKiotZiISMXq8vbDBBpmYugmkHy6Q+DXMIoVsRhg/jY1LSO8ycNaE8eAjgS05tjnXo35Nx9Wr+QSKAU99+M0yK3zfq7nSnIfVQ7IRQXNV4N2Dte02ZX+AkPwNg/mPeWXD+Acnxzu2KDi4R9nmb1Qnk6VJ+BlejbtO+KhGexkDF9a2pvZyN+LDQM3c1OfL/WpqdIZkSsg7fhDWHYnTGUlr1tOxPndptc6im65Kq05/0ynB/e04HMopDz1EmkSXVV]
```

New values can be added or existing values updated, and then simply re-run the encrypt command to encrypt the new values.

## Decrypt & Load Config using API

```
import { loadConfig } from '@zyno-io/config';

const config = loadConfig();

// or

const config = loadConfig({
  // key?: string
  //   the decryption key. defaults to process.env.CONFIG_DECRYPTION_KEY
  key: '...long key...'

  // file?: string | string[]
  //   files to load config from
  //   default: ['.env', '.env.local']
  //   note: in the case of overlapping keys, values loaded later will take priority
  //   note: .env.*.local should be added to .gitignore
  file: '.env.example',
  // or
  file: ['.env.example-a', '.env.example-b'],

  // env?: string
  //   an alternative to specifying files. automatically composes file list.
  //   resulting files list: ['.env', '.env.local', '.env.YOURENV', '.env.YOURENV.local']
  env: 'production',

  // mergeProcessEnv?: boolean
  //   automatically merge process.env values into the resulting config object
  //   defaults to true
});
```

## Decrypt & Load Config into process.env using API

```
import { loadConfigIntoEnv } from '@zyno-io/config';

loadConfigIntoEnv({
    // same options as above
});
```

## Decrypt & Load Config using Node 'require'

```
node -r @zyno-io/config/load your-app.js
```

This invocation will load, decrypt, and parse the `.env` and `.env.local` files (in addition to environment-specific files; see below) into `process.env`.

The `env` key above will be set to `APP_ENV` environment variable, if set.

Be sure the decryption key is set as `CONFIG_DECRYPTION_KEY` in your environment.

## Decrypt & Load Config into other environments

Using specific files:

```
eval $(npx config-cli sh .env .env.local .env.staging)

# alternatively, use Docker
eval $(docker run --rm -it -v `pwd`:/src -w /src ghcr.io/zyno-io/node-config sh .env .env.local .env.staging)
```

Or, using an automatic file list based on environment name:

```
eval $(npx config-cli shenv staging)

# alternatively, use Docker
eval $(docker run --rm -it -v `pwd`:/src -w /src ghcr.io/zyno-io/node-config shenv staging)
```

Be sure the decryption key is set as `CONFIG_DECRYPTION_KEY` in your environment.

## Decryption via CLI

With `CONFIG_DECRYPTION_KEY` in the environment:

```
npx config-cli decrypt .env

# alternatively, use Docker
docker run --rm -it -v `pwd`:/src -w /src ghcr.io/zyno-io/node-config decrypt .env
```

Or, specified as a parameter:

```
npx config-cli decrypt -k "LONG_DECRYPTION_KEY" .env

# alternatively, use Docker
docker run --rm -it -v `pwd`:/src -w /src ghcr.io/zyno-io/node-config decrypt -k "LONG_DECRYPTION_KEY" .env
```

## Verify encrypted secrets on pre-commit

Setup a pre-commit hook to ensure that you don't commit secrets:

```
npx config-cli verify .env
```

## Other APIs

- `parseEnvContent(rawDotenvContent: string, decryptionKey?: string): Record<string, string>`
    - Parses string content (in dotenv format), decrypts (if a key is provided), and returns an object of keys and values.
- `encryptConfigData(key: string, data: Record<string, string>): Record<string, string>`
    - Returns an object of keys and values where the value of any key suffixed with `_SECRET` is encrypted.
- `decryptConfigData(key: string, data: Record<string, string>): Record<string, string>`
    - Returns an object of keys and values, decrypting any value that is encrypted.
