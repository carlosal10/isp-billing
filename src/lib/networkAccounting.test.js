import { expect, test } from 'vitest';
import { sessionState, counterBytes } from './networkAccounting';
test('stopped sessions remain stopped regardless of age', () => {
  expect(sessionState({ status: 'stopped', lastEventAt: '2020-01-01' })).toBe('stopped');
  expect(sessionState({ status: 'active', lastEventAt: '2020-01-01' })).toBe('stale');
  expect(sessionState({ status: 'active', lastEventAt: 'invalid' })).toBe('stale');
  expect(sessionState({ status: 'active', lastEventAt: new Date().toISOString() })).toBe('active');
});
test('byte counters preserve precision and survive invalid snapshots', () => {
  expect(counterBytes('18446744073709551615')).toBe(18446744073709551615n);
  expect(counterBytes('garbled')).toBe(0n);
  expect(counterBytes('-5')).toBe(0n);
});
