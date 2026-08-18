import { createHash } from 'node:crypto';

export function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

export function contentHash(value: string): string {
  return createHash('sha256').update(normalizeText(value)).digest('hex');
}

export function hasTextChanged(previous: string, current: string): boolean {
  return contentHash(previous) !== contentHash(current);
}
