import { describe, expect, it } from 'vitest';
import { MonitorRuleValidationError, normalizeMonitorRuleConfiguration } from './index.js';

describe('normalizeMonitorRuleConfiguration', () => {
  it('normalizes bounded keyword rules and independent text/list rules', () => {
    expect(
      normalizeMonitorRuleConfiguration({
        keyword: { phrases: ['  Open role ', 'Hiring freeze'], transition: 'appears' },
        newItem: true,
        textChange: false,
      }),
    ).toEqual({
      keyword: { phrases: ['Open role', 'Hiring freeze'], transition: 'appears' },
      newItem: true,
      textChange: false,
    });
  });

  it('rejects empty configurations and case-insensitive duplicate keywords', () => {
    expect(() => normalizeMonitorRuleConfiguration({})).toThrow(MonitorRuleValidationError);
    expect(() =>
      normalizeMonitorRuleConfiguration({
        keyword: { phrases: ['Opening', 'opening'], transition: 'appears' },
      }),
    ).toThrow('keyword phrases must be unique');
  });
});
