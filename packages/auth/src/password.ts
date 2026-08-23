import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

export const DEFAULT_ARGON2ID_PARAMETERS = Object.freeze({
  memoryKiB: 65_536,
  parallelism: 1,
  passes: 3,
});

export type Argon2idParameters = Readonly<{
  memoryKiB: number;
  parallelism: number;
  passes: number;
}>;

export class PasswordValidationError extends Error {
  constructor(message: string) {
    super(`Invalid password: ${message}`);
    this.name = 'PasswordValidationError';
  }
}

type ParsedPasswordHash = Readonly<{
  derivedKey: Buffer;
  parameters: Argon2idParameters;
  salt: Buffer;
}>;

const passwordHashPattern =
  /^argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/u;
const minimumPasswordLength = 12;
const maximumPasswordLength = 1_024;
const maximumPasswordBytes = 4_096;
const derivedKeyLength = 32;
const saltLength = 16;
const maximumMemoryKiB = 1_048_576;
const maximumPasses = 10;
const maximumParallelism = 16;

function validateArgon2idParameters(parameters: Argon2idParameters) {
  if (
    !Number.isSafeInteger(parameters.parallelism) ||
    parameters.parallelism < 1 ||
    parameters.parallelism > maximumParallelism
  ) {
    throw new PasswordValidationError(`parallelism must be between 1 and ${maximumParallelism}`);
  }
  if (
    !Number.isSafeInteger(parameters.memoryKiB) ||
    parameters.memoryKiB < 8 * parameters.parallelism ||
    parameters.memoryKiB > maximumMemoryKiB
  ) {
    throw new PasswordValidationError(
      `memory must be between ${8 * parameters.parallelism} and ${maximumMemoryKiB} KiB`,
    );
  }
  if (
    !Number.isSafeInteger(parameters.passes) ||
    parameters.passes < 1 ||
    parameters.passes > maximumPasses
  ) {
    throw new PasswordValidationError(`passes must be between 1 and ${maximumPasses}`);
  }
}

export function validatePassword(password: string) {
  if (
    password.length < minimumPasswordLength ||
    password.length > maximumPasswordLength ||
    Buffer.byteLength(password, 'utf8') > maximumPasswordBytes
  ) {
    throw new PasswordValidationError(
      `must be between ${minimumPasswordLength} and ${maximumPasswordLength} characters`,
    );
  }
}

function deriveArgon2id(
  password: string,
  salt: Buffer,
  parameters: Argon2idParameters,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        memory: parameters.memoryKiB,
        message: Buffer.from(password, 'utf8'),
        nonce: salt,
        parallelism: parameters.parallelism,
        passes: parameters.passes,
        tagLength: derivedKeyLength,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

function parsePasswordHash(passwordHash: string): ParsedPasswordHash | undefined {
  const match = passwordHashPattern.exec(passwordHash);
  if (!match) {
    return undefined;
  }
  const [, memoryKiB, passes, parallelism, salt, derivedKey] = match;
  if (!memoryKiB || !passes || !parallelism || !salt || !derivedKey) {
    return undefined;
  }
  const parameters = {
    memoryKiB: Number(memoryKiB),
    parallelism: Number(parallelism),
    passes: Number(passes),
  };
  try {
    validateArgon2idParameters(parameters);
  } catch {
    return undefined;
  }
  const decodedSalt = Buffer.from(salt, 'base64url');
  const decodedDerivedKey = Buffer.from(derivedKey, 'base64url');
  if (decodedSalt.length !== saltLength || decodedDerivedKey.length !== derivedKeyLength) {
    return undefined;
  }
  return { derivedKey: decodedDerivedKey, parameters, salt: decodedSalt };
}

export async function hashPassword(
  password: string,
  parameters: Argon2idParameters = DEFAULT_ARGON2ID_PARAMETERS,
) {
  validatePassword(password);
  validateArgon2idParameters(parameters);
  const salt = randomBytes(saltLength);
  const derivedKey = await deriveArgon2id(password, salt, parameters);
  return `argon2id$v=19$m=${parameters.memoryKiB},t=${parameters.passes},p=${parameters.parallelism}$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  const parsed = parsePasswordHash(passwordHash);
  if (!parsed) {
    return false;
  }
  try {
    const derivedKey = await deriveArgon2id(password, parsed.salt, parsed.parameters);
    return timingSafeEqual(derivedKey, parsed.derivedKey);
  } catch {
    return false;
  }
}

export function passwordHashNeedsRehash(
  passwordHash: string,
  parameters: Argon2idParameters = DEFAULT_ARGON2ID_PARAMETERS,
) {
  const parsed = parsePasswordHash(passwordHash);
  return (
    !parsed ||
    parsed.parameters.memoryKiB !== parameters.memoryKiB ||
    parsed.parameters.parallelism !== parameters.parallelism ||
    parsed.parameters.passes !== parameters.passes
  );
}
