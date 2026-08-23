import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const recoveryCodeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const secretByteLength = 20;
const totpDigits = 6;
const totpPeriodSeconds = 30;
const totpVersion = 'v1';

export class TotpValidationError extends Error {
  constructor(message: string) {
    super(`Invalid TOTP data: ${message}`);
    this.name = 'TotpValidationError';
  }
}

export class TotpEncryptionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(`TOTP encryption failed: ${message}`, { cause });
    this.name = 'TotpEncryptionError';
  }
}

function normalizedBase32(value: string) {
  const normalized = value.replace(/[\s-]/gu, '').toUpperCase();
  if (!/^[A-Z2-7]+$/u.test(normalized)) {
    throw new TotpValidationError('secret must use unpadded base32 characters');
  }
  return normalized;
}

function decodeBase32(value: string) {
  const normalized = normalizedBase32(value);
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const index = base32Alphabet.indexOf(character);
    buffer = (buffer << 5) | index;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function encodeBase32(value: Buffer) {
  let bits = 0;
  let buffer = 0;
  let encoded = '';
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += base32Alphabet[(buffer >> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    encoded += base32Alphabet[(buffer << (5 - bits)) & 0x1f];
  }
  return encoded;
}

function counterBuffer(timeStep: number) {
  if (!Number.isSafeInteger(timeStep) || timeStep < 0) {
    throw new TotpValidationError('time step is invalid');
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(timeStep));
  return counter;
}

function matchingCode(expected: string, received: string) {
  const expectedBuffer = Buffer.from(expected, 'ascii');
  const receivedBuffer = Buffer.from(received, 'ascii');
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

function encryptionKey(kek: string, purpose: string) {
  if (kek.length === 0) {
    throw new TotpEncryptionError('the configured key is empty');
  }
  return createHmac('sha256', Buffer.from(kek, 'utf8'))
    .update(`pagepulse:totp:${totpVersion}:${purpose}`, 'utf8')
    .digest();
}

function encryptionAad(userId: string) {
  if (userId.length === 0) {
    throw new TotpValidationError('user ID is required');
  }
  return Buffer.from(`pagepulse:totp:${totpVersion}:${userId}`, 'utf8');
}

export function createTotpSecret() {
  return encodeBase32(randomBytes(secretByteLength));
}

export function createTotpCode(secret: string, timeStep: number) {
  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBuffer(timeStep)).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const truncated =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(truncated % 10 ** totpDigits).padStart(totpDigits, '0');
}

export function currentTotpTimeStep(now: Date = new Date()) {
  const seconds = Math.floor(now.getTime() / 1_000);
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new TotpValidationError('clock value is invalid');
  }
  return Math.floor(seconds / totpPeriodSeconds);
}

export function verifyTotpCode(secret: string, code: string, now: Date = new Date()) {
  if (!/^\d{6}$/u.test(code)) {
    return undefined;
  }
  const currentStep = currentTotpTimeStep(now);
  for (const candidateStep of [currentStep, currentStep - 1]) {
    if (candidateStep >= 0 && matchingCode(createTotpCode(secret, candidateStep), code)) {
      return candidateStep;
    }
  }
  return undefined;
}

export function createTotpProvisioningUri(issuer: string, accountName: string, secret: string) {
  if (issuer.trim().length === 0 || accountName.trim().length === 0) {
    throw new TotpValidationError('issuer and account name are required');
  }
  const normalizedSecret = normalizedBase32(secret);
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const parameters = new URLSearchParams({
    algorithm: 'SHA1',
    digits: String(totpDigits),
    issuer,
    period: String(totpPeriodSeconds),
    secret: normalizedSecret,
  });
  return `otpauth://totp/${label}?${parameters.toString()}`;
}

export function encryptTotpSecret(secret: string, kek: string, userId: string) {
  const initializationVector = randomBytes(12);
  try {
    const cipher = createCipheriv(
      'aes-256-gcm',
      encryptionKey(kek, 'secret'),
      initializationVector,
    );
    cipher.setAAD(encryptionAad(userId));
    const ciphertext = Buffer.concat([
      cipher.update(normalizedBase32(secret), 'utf8'),
      cipher.final(),
    ]);
    return [
      totpVersion,
      initializationVector.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  } catch (error) {
    if (error instanceof TotpEncryptionError || error instanceof TotpValidationError) {
      throw error;
    }
    throw new TotpEncryptionError('could not encrypt the secret', error);
  }
}

export function decryptTotpSecret(ciphertext: string, kek: string, userId: string) {
  const [version, iv, tag, payload, ...extra] = ciphertext.split('.');
  if (version !== totpVersion || !iv || !tag || !payload || extra.length > 0) {
    throw new TotpEncryptionError('ciphertext format is invalid');
  }
  const initializationVector = Buffer.from(iv, 'base64url');
  const authenticationTag = Buffer.from(tag, 'base64url');
  const encrypted = Buffer.from(payload, 'base64url');
  if (
    initializationVector.length !== 12 ||
    authenticationTag.length !== 16 ||
    encrypted.length === 0
  ) {
    throw new TotpEncryptionError('ciphertext fields are invalid');
  }
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(kek, 'secret'),
      initializationVector,
    );
    decipher.setAAD(encryptionAad(userId));
    decipher.setAuthTag(authenticationTag);
    const secret = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    return normalizedBase32(secret);
  } catch (error) {
    if (error instanceof TotpEncryptionError || error instanceof TotpValidationError) {
      throw error;
    }
    throw new TotpEncryptionError('could not decrypt the secret', error);
  }
}

export function createRecoveryCodes(count = 10) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 20) {
    throw new TotpValidationError('recovery code count is invalid');
  }
  const codes = new Set<string>();
  while (codes.size < count) {
    const value = randomBytes(12);
    const characters = [...value].map((byte) => recoveryCodeAlphabet[byte & 0x1f]);
    codes.add(
      `${characters.slice(0, 4).join('')}-${characters.slice(4, 8).join('')}-${characters.slice(8).join('')}`,
    );
  }
  return [...codes];
}

export function normalizeRecoveryCode(code: string) {
  const normalized = code.replace(/[\s-]/gu, '').toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{12}$/u.test(normalized)) {
    throw new TotpValidationError('recovery code is invalid');
  }
  return normalized;
}

export function hashRecoveryCode(code: string, kek: string, userId: string) {
  return createHmac('sha256', encryptionKey(kek, 'recovery-code'))
    .update(`${userId}:${normalizeRecoveryCode(code)}`, 'utf8')
    .digest('hex');
}
