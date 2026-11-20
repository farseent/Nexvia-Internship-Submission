#!/usr/bin/env node
// Generates the Ed25519 key pair that signs and verifies collaboration tokens (D22).
//
//   node scripts/generate-collab-keys.mjs            print the two variables
//   node scripts/generate-collab-keys.mjs --write    add them to .env when they are missing
//
// The private key belongs to the API only; the collaboration server gets the public key.
// Both are single-line JSON so they fit in a .env file. Never commit a real key.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function generateCollabKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const kid = `k${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(3).toString('hex')}`;
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  return {
    COLLAB_JWT_PRIVATE_KEY: JSON.stringify({
      kty: priv.kty,
      crv: priv.crv,
      x: priv.x,
      d: priv.d,
      kid,
    }),
    COLLAB_JWT_PUBLIC_KEYS: JSON.stringify([{ kty: pub.kty, crv: pub.crv, x: pub.x, kid }]),
  };
}

function main() {
  const write = process.argv.includes('--write');
  const keys = generateCollabKeyPair();
  if (!write) {
    for (const [name, value] of Object.entries(keys)) console.log(`${name}='${value}'`);
    return;
  }
  const envPath = fileURLToPath(new URL('../.env', import.meta.url));
  const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const hasValue = (name) => new RegExp(`^${name}=.+`, 'm').test(current);
  // Never replace a key that is already set: that would invalidate running sessions' tokens
  // and, worse, hide a private key the owner placed there on purpose.
  if (hasValue('COLLAB_JWT_PRIVATE_KEY') || hasValue('COLLAB_JWT_PUBLIC_KEYS')) {
    console.log('Collaboration keys already present in .env; nothing changed.');
    return;
  }
  const lines = Object.entries(keys).map(([name, value]) => `${name}='${value}'`);
  const withoutEmpty = current.replace(/^COLLAB_JWT_(PRIVATE_KEY|PUBLIC_KEYS)=\s*$\n?/gm, '');
  const separator = withoutEmpty === '' || withoutEmpty.endsWith('\n') ? '' : '\n';
  writeFileSync(envPath, `${withoutEmpty}${separator}${lines.join('\n')}\n`);
  console.log('Wrote COLLAB_JWT_PRIVATE_KEY and COLLAB_JWT_PUBLIC_KEYS to .env');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
