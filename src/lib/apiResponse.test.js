import { describe, expect, it } from 'vitest';
import { validateApiResponse } from './apiResponse';

describe('API deployment response validation', () => {
  it('rejects a static-site fallback masquerading as healthy API', () => {
    expect(() => validateApiResponse({ headers: { 'content-type': 'text/html' }, data: '<!doctype html>', config: { url: '/health' } })).toThrow('web page instead of the API');
  });
  it.each(['login', 'register'])('rejects an empty successful %s response', flow => {
    expect(() => validateApiResponse({ headers: {}, data: '', config: { url: '/auth/' + flow } })).toThrow('empty or invalid response');
  });
  it('preserves valid API payloads and non-auth empty responses', () => {
    const response = { headers: {}, data: { ok: true }, config: { url: '/auth/login' } };
    expect(validateApiResponse(response)).toBe(response);
    expect(validateApiResponse({ headers: {}, data: '', config: { url: '/resource' } }).data).toBe('');
  });
});
