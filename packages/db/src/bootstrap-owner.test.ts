import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { OwnerBootstrapInputError } from './owner-bootstrap.js';
import { isOwnerBootstrapEntrypoint, parseBootstrapOwnerCommand } from './bootstrap-owner.js';

describe('owner bootstrap CLI', () => {
  it('accepts exactly one owner email argument', () => {
    expect(parseBootstrapOwnerCommand(['--email', 'owner@example.test'])).toEqual({
      email: 'owner@example.test',
    });
    expect(() => parseBootstrapOwnerCommand([])).toThrow(OwnerBootstrapInputError);
    expect(() => parseBootstrapOwnerCommand(['owner@example.test'])).toThrow(
      OwnerBootstrapInputError,
    );
  });

  it('recognizes a relative owner bootstrap script path', () => {
    const moduleUrl = import.meta.url.replace(/\.test\.([cm]?[jt]s)$/, '.$1');
    const entrypoint = relative(process.cwd(), fileURLToPath(moduleUrl));

    expect(isOwnerBootstrapEntrypoint(entrypoint, moduleUrl)).toBe(true);
  });
});
