import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

let app: Awaited<ReturnType<typeof buildApp>> | undefined;
afterEach(async () => app?.close());

describe('health contract', () => {
  it('returns the service version without dependency details', async () => {
    const testApp = await buildApp();
    app = testApp;
    const response = await testApp.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'api' });
  });
});
