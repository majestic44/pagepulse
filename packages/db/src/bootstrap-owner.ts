import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvironment } from '@pagepulse/config';

import {
  OwnerBootstrapConfigurationError,
  OwnerBootstrapInputError,
  bootstrapOwner,
  createOwnerSetupUrl,
} from './owner-bootstrap.js';

type BootstrapOwnerCommand = Readonly<{
  email: string;
}>;

function usage() {
  return 'Usage: pnpm owner:bootstrap -- --email owner@example.com';
}

export function parseBootstrapOwnerCommand(arguments_: readonly string[]): BootstrapOwnerCommand {
  if (arguments_.length !== 2 || arguments_[0] !== '--email' || !arguments_[1]) {
    throw new OwnerBootstrapInputError(usage());
  }
  return { email: arguments_[1] };
}

export function isOwnerBootstrapEntrypoint(
  entrypoint: string | undefined,
  moduleUrl: string = import.meta.url,
) {
  return entrypoint !== undefined && fileURLToPath(moduleUrl) === resolve(entrypoint);
}

export async function runOwnerBootstrap(arguments_ = process.argv.slice(2)) {
  const command = parseBootstrapOwnerCommand(arguments_);
  const environment = loadEnvironment();
  if (!environment.APP_BASE_URL) {
    throw new OwnerBootstrapConfigurationError('APP_BASE_URL must be set');
  }

  const result = await bootstrapOwner(environment.DATABASE_URL, {
    email: command.email,
    tokenTtlMinutes: environment.OWNER_SETUP_TOKEN_TTL_MINUTES,
  });
  const setupUrl = createOwnerSetupUrl(environment.APP_BASE_URL, result.token);

  process.stdout.write(
    [
      'Owner setup URL (shown once; store it securely and do not place it in CI logs):',
      setupUrl,
      `Expires at: ${result.expiresAt.toISOString()}`,
      '',
    ].join('\n'),
  );
}

const entrypoint = process.argv[1];
if (isOwnerBootstrapEntrypoint(entrypoint)) {
  runOwnerBootstrap().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Owner bootstrap failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
