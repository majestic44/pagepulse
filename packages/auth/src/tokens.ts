import { createHash, randomBytes } from 'node:crypto';

export function createOpaqueToken() {
  return randomBytes(32).toString('base64url');
}

export function hashOpaqueToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
