import { describe, expect, it } from 'vitest';
import { hasTextChanged, normalizeText } from './index.js';

describe('normalizeText', () => {
  it('ignores whitespace-only changes', () => {
    expect(normalizeText('New\n\t job')).toBe('New job');
    expect(hasTextChanged('New  job', 'New\njob')).toBe(false);
  });
  it('detects meaningful text changes', () =>
    expect(hasTextChanged('Role A', 'Role B')).toBe(true));
});
