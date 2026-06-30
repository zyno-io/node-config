# @zyno-io/config

TypeScript package for encrypting & decrypting secrets in and loading config from .env files. Leverages asymmetric keys so that any developer with access can add & update secrets, but only those with the private key (typically admins and your infrastructure itself) can decrypt secrets.

## How does this work?

A pair of X25519 keys (one public, one private) are generated as your encryption keys. For each secret that needs to be encrypted:

- an ephemeral X25519 key pair is generated
- a shared secret is derived from the ephemeral private key and your public encryption key
- an AES-256-GCM key is derived from that shared secret
- the secret is encrypted with AES-256-GCM
- the version number (of the encryption scheme), the ephemeral public key, the AES-GCM IV, the authentication tag, and the encrypted secret are combined into a single payload
- the plaintext secret is replaced with the payload, base64-encoded (and a prefix/suffix to indicate that it's an encrypted value)

Existing RSA-2048 keys are still supported. Passing an RSA public key to the encrypt command keeps producing the legacy v1 format, and existing RSA-encrypted values continue to decrypt with their matching RSA private keys.

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
TWILIO_AUTH_TOKEN_SECRET=$$[AjAqMAUGAytlbgMhAOqV2hOeR9yxQunkkgtuX4IvrT7SfVzmmO7vX1rTJQUCITfehft1MhXIpk8gr4FmwbtERaKaqawiciDh9JyJN9+wTTdTwKvJ]
```

New values can be added or existing values updated, and then simply re-run the encrypt command to encrypt the new values.

## Decrypt & Load Config using API

```
import { loadConfig } from '@zyno-io/config';

const config = loadConfig();

// or

const config = loadConfig({
  // key?: string
  //   the decryption key. defaults to process.env.CONFIG_DECRYPTION_SECRET
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
  //   keys ending in _SECRET are decrypted if possible, and left unchanged if decryption fails
  //   defaults to true
});
```

For backwards compatibility, `CONFIG_DECRYPTION_KEY` is still supported as a fallback when `CONFIG_DECRYPTION_SECRET` is not set.

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

Be sure the decryption key is set as `CONFIG_DECRYPTION_SECRET` in your environment.

## Execute a command with config loaded

Run a subprocess with environment variables loaded from `.env` files. Use `--` to separate config-cli options from the child command:

```
npx config-cli exec -e production -- node app.js

# alternatively, use Docker
docker run --rm -it -v `pwd`:/src -w /src ghcr.io/zyno-io/node-config exec -e production -- node app.js
```

The environment is resolved from `-e` if provided, otherwise from the `APP_ENV` environment variable. With an environment set, loads `.env`, `.env.local`, `.env.<environment>`, and `.env.<environment>.local`. Without either, loads `.env` and `.env.local`.

The subprocess inherits the current environment. Values from `.env` files are merged in, but existing environment variables take precedence (matching the behavior of `sh`/`shenv`).
Inherited environment keys ending in `_SECRET` are decrypted if possible, and left unchanged if decryption fails.

Be sure the decryption key is set as `CONFIG_DECRYPTION_SECRET` in your environment (or pass `-k`).

## Concatenate config for an environment

Merge one or more `.env` files into a single output **without decrypting** — encrypted `$$[...]` values pass through verbatim, so no decryption key is required. This is useful for producing one encrypted blob to hand to infrastructure, e.g. a Kubernetes ConfigMap consumed by [config-controller](https://github.com/zyno-io/config-controller).

Later files win on duplicate keys (matching `loadConfig`).

```
# explicit files (later wins)
npx config-cli concat .env .env.production

# or compose from an environment name -> loads .env + .env.<environment>
npx config-cli concat -e production

# output as JSON or YAML
npx config-cli concat -e production --format json
npx config-cli concat -e production --format yaml

# prefix output keys
npx config-cli concat -e production --prefix pre_
npx config-cli concat -e production --format yaml --prefix top.
npx config-cli concat -e production --format json --prefix top.pre_
```

Unlike `exec`/`shenv`, the `-e` form excludes developer `.local` files (`.env.local`, `.env.<environment>.local`) by default since they should not reach a deploy; pass `--local` to include them.

The default output format is dotenv. `--format json` and `--format yaml` reformat the merged key/value data without decrypting or otherwise changing values.
Prefixes are literal for dotenv output. For JSON and YAML output, prefixes containing `.` create nested objects; the final segment prefixes the config keys, so `--prefix top.pre_` produces keys under `top` named `pre_<KEY>`.

Drop keys you don't want in the output with one or more `-x/--exclude` regular expressions — for example, to strip build-time front-end vars and the encryption key from a backend deploy blob:

```
npx config-cli concat -e production -x '^(VITE_|CONFIG_)' > .env.runtime

# alternatively, use Docker
docker run --rm -it -v `pwd`:/src -w /src ghcr.io/zyno-io/node-config concat -e production -x '^(VITE_|CONFIG_)'
```

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

Be sure the decryption key is set as `CONFIG_DECRYPTION_SECRET` in your environment.

## Decryption via CLI

By default, `decrypt` updates the specified files in place.

With `CONFIG_DECRYPTION_SECRET` in the environment:

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

To print decrypted content without modifying the file, pass `--stdout`:

```
npx config-cli decrypt --stdout .env
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
