import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key() {
  const value = process.env.TOKEN_ENCRYPTION_KEY;
  if (!value) throw new Error('TOKEN_ENCRYPTION_KEY is required');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return decoded;
}

export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decrypt(value: string) {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(':');
  if (version !== 'v1' || !encodedIv || !encodedTag || !encodedCiphertext) throw new Error('Invalid encrypted token');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(encodedIv, 'base64url'));
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, 'base64url')), decipher.final()]).toString('utf8');
}
