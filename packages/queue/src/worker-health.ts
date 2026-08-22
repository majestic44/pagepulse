import { readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

export type ProcessSnapshot = Readonly<{
  command: ReadonlyArray<string>;
  pid: number;
}>;

function listLinuxProcesses(): ProcessSnapshot[] {
  return readdirSync('/proc', { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) {
      return [];
    }

    try {
      const command = readFileSync(`/proc/${entry.name}/cmdline`, 'utf8')
        .split('\0')
        .filter(Boolean);
      return [{ command, pid: Number(entry.name) }];
    } catch {
      return [];
    }
  });
}

export function hasExpectedWorkerProcess(
  processes: ReadonlyArray<ProcessSnapshot>,
  expectedEntrypoint: string,
  healthcheckProcessId: number,
) {
  return processes.some(
    (process) =>
      process.pid !== healthcheckProcessId &&
      basename(process.command[0] ?? '') === 'node' &&
      process.command.includes(expectedEntrypoint),
  );
}

export function isExpectedWorkerProcessRunning(expectedEntrypoint: string) {
  return hasExpectedWorkerProcess(listLinuxProcesses(), expectedEntrypoint, process.pid);
}
