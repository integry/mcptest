import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { redactReportValue } from '../utils/reportArtifact';
import type {
  MonitoringSnapshotV1,
  MonitoringRunLease,
  MonitoringStateV1,
  MonitoringStore,
} from './types';

export const DEFAULT_MONITORING_LOCK_STALE_MS = 5 * 60_000;

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
  /** Primarily useful for tests; active leases refresh well before this interval. */
  lockStaleMs?: number;
}

/** Filesystem persistence for cron, CI, and other headless schedulers. */
export class FileMonitoringStore implements MonitoringStore {
  readonly stateFile: string;
  readonly reportDirectory: string;
  readonly runLockDirectory: string;
  private readonly configuredReportDirectory: string;
  private readonly lockStaleMs: number;

  constructor(options: FileMonitoringStoreOptions = {}) {
    const configuredStateFile = options.stateFile || 'mcptest-monitor/state.json';
    this.stateFile = resolve(configuredStateFile);
    this.configuredReportDirectory = options.reportDirectory
      || `${dirname(configuredStateFile)}/reports`;
    this.reportDirectory = resolve(this.configuredReportDirectory);
    this.runLockDirectory = `${this.stateFile}.lock`;
    this.lockStaleMs = options.lockStaleMs || DEFAULT_MONITORING_LOCK_STALE_MS;
    if (!Number.isFinite(this.lockStaleMs) || this.lockStaleMs <= 0) {
      throw new TypeError('lockStaleMs must be a positive number.');
    }
  }

  async acquireRunLease(): Promise<MonitoringRunLease | undefined> {
    await mkdir(dirname(this.stateFile), { recursive: true });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = `${process.pid}-${randomUUID()}`;
      const ownerFile = resolve(this.runLockDirectory, 'owner.json');
      try {
        await mkdir(this.runLockDirectory, { mode: 0o700 });
        await writeFile(ownerFile, `${JSON.stringify({ token, pid: process.pid })}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        });
        return this.lease(token, ownerFile);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          // Leave a partially initialized directory for stale recovery. Removing
          // the shared path here could delete a replacement lock after a race.
          throw error;
        }
      }

      let lockIdentity: { dev: bigint; ino: bigint; birthtimeNs: bigint };
      try {
        const lock = await stat(this.runLockDirectory, { bigint: true });
        lockIdentity = { dev: lock.dev, ino: lock.ino, birthtimeNs: lock.birthtimeNs };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }

      let modifiedAt: number;
      let observedOwner: string | undefined;
      try {
        const owner = await stat(ownerFile);
        modifiedAt = owner.mtimeMs;
        observedOwner = await readFile(ownerFile, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          try {
            modifiedAt = (await stat(this.runLockDirectory)).mtimeMs;
          } catch (statError) {
            if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue;
            throw statError;
          }
        } else {
          throw error;
        }
      }
      if (Date.now() - modifiedAt < this.lockStaleMs) return undefined;
      await this.onStaleLockObserved();

      // Claim this generation before moving it. A delayed contender may create
      // a claim in a replacement lock, but the owner comparison below prevents
      // it from moving or deleting that replacement.
      const takeoverFile = resolve(this.runLockDirectory, 'takeover.json');
      try {
        await writeFile(takeoverFile, `${token}\n`, {
          encoding: 'utf8',
          mode: 0o600,
          flag: 'wx',
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') continue;
        if (code === 'EEXIST') return undefined;
        throw error;
      }

      let currentIdentity: { dev: bigint; ino: bigint; birthtimeNs: bigint };
      try {
        const current = await stat(this.runLockDirectory, { bigint: true });
        currentIdentity = {
          dev: current.dev,
          ino: current.ino,
          birthtimeNs: current.birthtimeNs,
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      let currentOwner: string | undefined;
      try {
        currentOwner = await readFile(ownerFile, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (currentIdentity.dev !== lockIdentity.dev
          || currentIdentity.ino !== lockIdentity.ino
          || currentIdentity.birthtimeNs !== lockIdentity.birthtimeNs
          || currentOwner !== observedOwner) {
        await this.releaseTakeoverClaim(takeoverFile, token);
        continue;
      }
      try {
        const currentModifiedAt = currentOwner === undefined
          ? (await stat(this.runLockDirectory)).mtimeMs
          : (await stat(ownerFile)).mtimeMs;
        if (observedOwner !== undefined && Date.now() - currentModifiedAt < this.lockStaleMs) {
          await this.releaseTakeoverClaim(takeoverFile, token);
          return undefined;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }

      const quarantineDirectory = `${this.runLockDirectory}.stale-${token}`;
      try {
        await rename(this.runLockDirectory, quarantineDirectory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }

      const quarantined = await stat(quarantineDirectory, { bigint: true });
      let quarantinedOwner: string | undefined;
      let quarantinedClaim: string | undefined;
      try {
        quarantinedOwner = await readFile(resolve(quarantineDirectory, 'owner.json'), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      try {
        quarantinedClaim = await readFile(resolve(quarantineDirectory, 'takeover.json'), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (quarantined.dev !== lockIdentity.dev
          || quarantined.ino !== lockIdentity.ino
          || quarantined.birthtimeNs !== lockIdentity.birthtimeNs
          || quarantinedOwner !== observedOwner
          || quarantinedClaim !== `${token}\n`) {
        // The path changed between the identity check and rename. Put the live
        // directory back instead of deleting a lease this attempt did not inspect.
        await rename(quarantineDirectory, this.runLockDirectory);
        return undefined;
      }
      await rm(quarantineDirectory, { recursive: true });
    }
    return undefined;
  }

  /** Synchronization seam for deterministic stale-takeover tests. */
  protected async onStaleLockObserved(): Promise<void> {}

  private async releaseTakeoverClaim(path: string, token: string): Promise<void> {
    try {
      if (await readFile(path, 'utf8') === `${token}\n`) await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private lease(token: string, ownerFile: string): MonitoringRunLease {
    const heartbeatMs = Math.max(10, Math.min(30_000, Math.floor(this.lockStaleMs / 3)));
    const heartbeat = setInterval(() => {
      const at = new Date();
      void utimes(ownerFile, at, at).catch(() => {});
    }, heartbeatMs);
    heartbeat.unref();
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        clearInterval(heartbeat);
        try {
          const owner = JSON.parse(await readFile(ownerFile, 'utf8')) as { token?: unknown };
          if (owner.token === token) {
            await rm(this.runLockDirectory, { recursive: true, force: true });
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      },
    };
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
