import type { NormalizedMonitorContent } from './normalization.js';
import type { EvaluateMonitorRulesInput, MonitorRuleEvaluation } from './rule-engine.js';

const content = (text: string): NormalizedMonitorContent => ({
  canonical: { sourceType: 'html', text },
  hash: text,
});

export const ruleEngineFixtures: ReadonlyArray<
  Readonly<{ input: EvaluateMonitorRulesInput; name: string; output: MonitorRuleEvaluation }>
> = [
  {
    input: {
      current: content('Open roles: engineering'),
      rules: { keyword: null, newItem: false, textChange: true },
    },
    name: 'first successful source establishes a baseline without a match',
    output: { baseline: true, changed: false, matches: [] },
  },
  {
    input: {
      current: content('Open roles: engineering'),
      previous: content('Open roles: design'),
      rules: { keyword: null, newItem: false, textChange: true },
    },
    name: 'canonical hash differences trigger a text-change match',
    output: { baseline: false, changed: true, matches: [{ kind: 'text_change' }] },
  },
  {
    input: {
      current: content('Hiring is open'),
      previous: content('Hiring is paused'),
      rules: {
        keyword: { phrases: ['open'], transition: 'appears' },
        newItem: false,
        textChange: false,
      },
    },
    name: 'keyword appearance is literal and case-insensitive',
    output: {
      baseline: false,
      changed: true,
      matches: [{ kind: 'keyword', phrase: 'open', transition: 'appears' }],
    },
  },
  {
    input: {
      current: content('Two listings'),
      currentListings: [
        { contentHash: 'new-content', identity: 'new-listing', identityKind: 'url' },
      ],
      previous: content('One listing'),
      previousListings: [
        { contentHash: 'old-content', identity: 'old-listing', identityKind: 'url' },
      ],
      rules: { keyword: null, newItem: true, textChange: false },
    },
    name: 'listing additions compare stable identities rather than source order',
    output: {
      baseline: false,
      changed: true,
      matches: [{ identity: 'new-listing', kind: 'new_item' }],
    },
  },
];
