const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export class EmailValidationError extends Error {
  constructor() {
    super('Email must be a valid address of at most 320 characters');
    this.name = 'EmailValidationError';
  }
}

export function normalizeEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 320 || !emailPattern.test(normalized)) {
    throw new EmailValidationError();
  }
  return normalized;
}
