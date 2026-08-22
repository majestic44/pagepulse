import type { Connection } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('mysql2/promise', () => ({ createConnection: vi.fn() }));

import { createConnection } from 'mysql2/promise';
import { probeDatabase } from './health.js';

const databaseUrl = 'mysql://pagepulse:pagepulse@mariadb:3306/pagepulse';
const createConnectionMock = vi.mocked(createConnection);

function createProbeConnection(ping: () => Promise<void>) {
  const destroy = vi.fn();
  return { connection: { destroy, ping } as unknown as Connection, destroy };
}

describe('probeDatabase', () => {
  beforeEach(() => vi.resetAllMocks());

  it('uses a bounded connection and ping probe', async () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    const { connection, destroy } = createProbeConnection(ping);
    createConnectionMock.mockResolvedValue(connection);

    await probeDatabase(databaseUrl, 25);

    expect(createConnectionMock).toHaveBeenCalledWith({ uri: databaseUrl, connectTimeout: 25 });
    expect(ping).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('rejects promptly when a ping stalls and tears down the connection', async () => {
    const { connection, destroy } = createProbeConnection(() => new Promise(() => undefined));
    createConnectionMock.mockResolvedValue(connection);

    await expect(probeDatabase(databaseUrl, 10)).rejects.toThrow('Database health check timed out');

    expect(destroy).toHaveBeenCalledOnce();
  });
});
