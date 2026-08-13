import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { redactReportValue } from '../utils/reportArtifact';
import type {
  MonitoringSnapshotV1,
  MonitoringStateV1,
  MonitoringStore,
} from './types';

/** Reversible, collision-free encoding for one filesystem path component. */
export const monitoringArtifactPathPart = (value: string): string => {
  const encoded = encodeURIComponent(value);
  if (encoded === '.') return '%2E';
  if (encoded === '..') return '%2E%2E';
  return encoded || '%00';
};

export const monitoringSnapshotArtifactPath = (
  serverId: string,
  snapshotId: string
): string => `${monitoringArtifactPathPart(serverId)}/${monitoringArtifactPathPart(snapshotId)}.json`;

const relativeLinkBase = (value: string): string => value
  .replace(/\\/g, '/')
  .split('/')
  .map((part) => (part === '.' || part === '..' ? part : encodeURIComponent(part)))
  .join('/')
  .replace(/\/$/, '');

const writePrivateJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(redactReportValue(value), null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, path);
};

export interface FileMonitoringStoreOptions {
  stateFile?: string;
  reportDirectory?: string;
}

/** Filesystem persistence for cron, CI, and other headless schedulers. */
export class FileMonitoringStore implements MonitoringStore {
  readonly stateFile: string;
  readonly reportDirectory: string;
  private readonly configuredReportDirectory: string;

  constructor(options: FileMonitoringStoreOptions = {}) {
    const configuredStateFile = options.stateFile || 'mcptest-monitor/state.json';
    this.stateFile = resolve(configuredStateFile);
    this.configuredReportDirectory = options.reportDirectory
      || `${dirname(configuredStateFile)}/reports`;
    this.reportDirectory = resolve(this.configuredReportDirectory);
  }

  async load(): Promise<MonitoringStateV1 | undefined> {
    try {
      return JSON.parse(await readFile(this.stateFile, 'utf8')) as MonitoringStateV1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async save(state: MonitoringStateV1): Promise<void> {
    await writePrivateJson(this.stateFile, state);
  }

  async saveSnapshot(snapshot: MonitoringSnapshotV1): Promise<void> {
    const path = resolve(this.reportDirectory, monitoringSnapshotArtifactPath(
      snapshot.serverId,
      snapshot.id
    ));
    await writePrivateJson(path, {
      artifactType: 'mcptest.monitor-snapshot',
      schemaVersion: '1.0.0',
      ...snapshot,
    });
  }

  snapshotReportUrl(serverId: string, snapshotId: string): string {
    const artifactPath = monitoringSnapshotArtifactPath(serverId, snapshotId);
    if (isAbsolute(this.configuredReportDirectory)) {
      return pathToFileURL(resolve(this.configuredReportDirectory, artifactPath)).href;
    }
    const encodedArtifactPath = artifactPath.split('/').map(encodeURIComponent).join('/');
    return `${relativeLinkBase(this.configuredReportDirectory)}/${encodedArtifactPath}`;
  }

  async pruneSnapshots(state: MonitoringStateV1): Promise<void> {
    const retained = new Set(Object.values(state.servers).flatMap((server) => (
      server.snapshots.map((snapshot) => monitoringSnapshotArtifactPath(
        snapshot.serverId,
        snapshot.id
      ))
    )));
    let directories;
    try {
      directories = await readdir(this.reportDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const directory of directories) {
      if (!directory.isDirectory()) continue;
      const directoryPath = resolve(this.reportDirectory, directory.name);
      for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const relative = `${directory.name}/${entry.name}`;
        if (retained.has(relative)) continue;
        const path = resolve(directoryPath, entry.name);
        try {
          const candidate = JSON.parse(await readFile(path, 'utf8')) as {
            artifactType?: unknown;
            id?: unknown;
          };
          if (candidate.artifactType === 'mcptest.monitor-snapshot'
              && typeof candidate.id === 'string') await unlink(path);
        } catch (error) {
          // Leave unrelated, malformed, or concurrently removed files untouched.
          if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
            continue;
          }
          throw error;
        }
      }
    }
  }
}
