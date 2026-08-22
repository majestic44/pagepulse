export type DependencyHealthStatus = 'ok' | 'unavailable';
export type HealthStatus = 'ok' | 'degraded';

export type HealthDiagnostics = Readonly<{
  dependencies: Readonly<{
    database: DependencyHealthStatus;
    redis: DependencyHealthStatus;
  }>;
  status: HealthStatus;
}>;

export type HealthService = Readonly<{
  collectDiagnostics: () => Promise<HealthDiagnostics>;
}>;

type DependencyProbes = Readonly<{
  database: () => Promise<unknown>;
  redis: () => Promise<unknown>;
}>;

function dependencyStatus(result: PromiseSettledResult<unknown>): DependencyHealthStatus {
  return result.status === 'fulfilled' ? 'ok' : 'unavailable';
}

export function createHealthService(probes: DependencyProbes): HealthService {
  return {
    async collectDiagnostics() {
      const [database, redis] = await Promise.allSettled([probes.database(), probes.redis()]);
      const dependencies = {
        database: dependencyStatus(database),
        redis: dependencyStatus(redis),
      };

      return {
        dependencies,
        status: dependencies.database === 'ok' && dependencies.redis === 'ok' ? 'ok' : 'degraded',
      };
    },
  };
}
