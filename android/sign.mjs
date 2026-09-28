// Signs an APK (v1 + v2 + v3) with android/levelup.pem.
// Keep this key: Android only accepts updates signed with the same key.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('./.tools/', import.meta.url));
const { ApkSigner, SigningKey } = await import(require.resolve('apk_sign_ts'));

const [inp, out] = process.argv.slice(2);
const dir = new URL('.', import.meta.url);
const key = readFileSync(new URL('levelup.key.pem', dir), 'utf8');
const cert = readFileSync(new URL('levelup.cert.pem', dir), 'utf8');
const signer = new ApkSigner({ signingKey: SigningKey.fromPEM(key, cert) });
const { signedApk } = await signer.sign(new Uint8Array(readFileSync(inp)));
writeFileSync(out, signedApk);
