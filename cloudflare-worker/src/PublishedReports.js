// Durable Object holding the published report snapshots of one endpoint, or the
// sliding-window rate-limit counter of one publisher scope.
//
// Instance names:
//   - "endpoint:<endpointKey>" keeps up to PUBLISHED_REPORT_RETENTION snapshots ordered
//     by latest publication (a republished identical run moves to the front), each
//     addressed by its content hash so identical runs share one entry.
//   - "rate:<scope>:<value>" keeps the timestamps of recent publishes for one IP or host.
//   - "watch:registry" lists the endpoints opted into the weekly watch (one key per
//     endpoint), so the cron run finds due endpoints without visiting every instance.
//
// An endpoint instance also keeps its weekly watch (see ./weeklyWatch.js): the opt-in,
// the latest drift state, and up to PUBLISHED_REPORT_RETENTION tools/list snapshots,
// each stored only when the listing changed, with its classified changes. They live
// beside the report snapshots under their own keys, so no migration is needed.
//
// Artifacts are stored as JSON text split into chunks so a snapshot never exceeds
// the per-value storage limit. Removal tokens are stored only as SHA-256 hashes.
import { PUBLISHED_REPORT_RETENTION } from '../../src/utils/publishedReportIdentity.ts';

import { validateAlertDestination, newAlertSecret, renderAlert, deliverAlert } from './watchAlerts.js';

const ALERT_KEY = 'watch:alert-destination';
const ALERT_RATE_KEY = 'watch:alert-rate';
const CHUNK_SIZE = 96 * 1024;
const INDEX_KEY = 'index';
const RATE_KEY = 'hits';
const WATCH_CONFIG_KEY = 'watch:config';
const WATCH_STATE_KEY = 'watch:state';
const WATCH_INDEX_KEY = 'watch:index';
const REGISTRY_PREFIX = 'registry:';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const chunkKey = (id, index) => `artifact:${id}:${index}`;
const watchChunkKey = (id, index) => `watch:snapshot:${id}:${index}`;

export class PublishedReports {
  constructor(state) {
    this.storage = state.storage;
    this.state = state;
    this.alertQueue = Promise.resolve();
  }

  async readIndex() {
    const index = await this.storage.get(INDEX_KEY);
    return Array.isArray(index) ? index : [];
  }

  writeArtifact(id, artifactJson) {
    return this.writeChunks(chunkKey, id, artifactJson);
  }

  readArtifact(entry) {
    return this.readChunks(chunkKey, entry);
  }

  async deleteArtifact(entry) {
    await this.storage.delete(Array.from({ length: entry.chunkCount }, (_, index) => chunkKey(entry.id, index)));
  }

  async writeChunks(keyFor, id, json) {
    const chunkCount = Math.max(1, Math.ceil(json.length / CHUNK_SIZE));
    const entries = {};
    for (let index = 0; index < chunkCount; index += 1) {
      entries[keyFor(id, index)] = json.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
    }
    await this.storage.put(entries);
    return chunkCount;
  }

  async readChunks(keyFor, entry) {
    const keys = Array.from({ length: entry.chunkCount }, (_, index) => keyFor(entry.id, index));
    const chunks = await this.storage.get(keys);
    const parts = keys.map((key) => chunks.get(key));
    if (parts.some((part) => typeof part !== 'string')) return undefined;
    return parts.join('');
  }

  // --- Weekly watch (endpoint instances) ---

  async readWatch() {
    const [config, state, index] = await Promise.all([
      this.storage.get(WATCH_CONFIG_KEY),
      this.storage.get(WATCH_STATE_KEY),
      this.storage.get(WATCH_INDEX_KEY),
    ]);
    return {
      config: config || { enabled: false },
      state: state || null,
      entries: Array.isArray(index) ? index : [],
    };
  }

  publicWatchEntry(entry) {
    const { chunkCount: _chunkCount, ...rest } = entry;
    return rest;
  }

  /** The watch as the routes and the badge read it; never includes snapshot bodies. */
  async watchSummary() {
    const { config, state, entries } = await this.readWatch();
    const lastChange = entries.find((entry) => !entry.baseline);
    return {
      config,
      state,
      lastChange: lastChange ? this.publicWatchEntry(lastChange) : null,
      snapshotCount: entries.length,
    };
  }

  async setWatch(body) {
    const { enabled, endpoint, plan, now } = body;
    // The watch is controlled with a snapshot's removal token, so it runs only while
    // the endpoint has a published snapshot; checked here so an opt-in cannot land
    // after the last snapshot was removed.
    if (enabled && (await this.readIndex()).length === 0) return json({ error: 'no_published_snapshot' }, 409);
    const current = (await this.storage.get(WATCH_CONFIG_KEY)) || {};
    const config = enabled
      ? { ...current, enabled: true, endpoint, plan, optedInAt: current.enabled ? current.optedInAt : now, updatedAt: now }
      : { ...current, enabled: false, updatedAt: now };
    await this.storage.put(WATCH_CONFIG_KEY, config);
    return json({ config });
  }

  async latestWatchSnapshot() {
    const { config, entries } = await this.readWatch();
    const latest = entries[0];
    if (!latest) return json({ config, entry: null, snapshotJson: null });
    const snapshotJson = await this.readChunks(watchChunkKey, latest);
    return json({ config, entry: this.publicWatchEntry(latest), snapshotJson: snapshotJson ?? null });
  }

  async recordWatchState(body) {
    await this.storage.put(WATCH_STATE_KEY, body.state);
    return json({ state: body.state });
  }

  /** Stores a changed listing and its classification, keeping the newest PUBLISHED_REPORT_RETENTION. */
  async recordWatchSnapshot(body) {
    const { entry, snapshotJson, state } = body;
    const { entries } = await this.readWatch();
    if (entries[0]?.contentHash === entry.contentHash) {
      await this.storage.put(WATCH_STATE_KEY, state);
      return json({ created: false, entry: this.publicWatchEntry(entries[0]) });
    }
    const chunkCount = await this.writeChunks(watchChunkKey, entry.id, snapshotJson);
    const stored = { ...entry, chunkCount };
    const retained = [stored, ...entries].slice(0, PUBLISHED_REPORT_RETENTION);
    for (const old of entries.slice(PUBLISHED_REPORT_RETENTION - 1)) {
      await this.storage.delete(Array.from({ length: old.chunkCount }, (_, index) => watchChunkKey(old.id, index)));
    }
    await this.storage.put({ [WATCH_INDEX_KEY]: retained, [WATCH_STATE_KEY]: state });
    return json({ created: true, entry: this.publicWatchEntry(stored), count: retained.length }, 201);
  }

  // One destination today; plan and separate delivery/rate state leave room for paid plans.
  alertSummary(destination) {
    if (!destination) return null;
    const { kind, host, enabled, failures, lastDelivery } = destination;
    return { kind, host, enabled, failures, lastDelivery: lastDelivery || null };
  }

  async ownerAlerts(request, body) {
    // Recheck within the serialized operation: removed snapshots cannot authorize changes.
    const index = await this.readIndex();
    if (!index.some((entry) => entry.id === body.id && body.removalTokenHash && entry.removalTokenHash === body.removalTokenHash)) return json({ error: 'invalid_removal_token' }, 403);
    const current = await this.storage.get(ALERT_KEY);
    if (request.method === 'GET') return json({ alert: this.alertSummary(current) });
    if (request.method === 'DELETE') {
      await this.storage.delete(ALERT_KEY);
      return json({ alert: null });
    }
    if (body.test) {
      if (!(await this.storage.get(WATCH_CONFIG_KEY))?.enabled) return json({ error: 'watch_required' }, 409);
      if (!current?.enabled) return json({ error: 'no_enabled_destination' }, 409);
      const now = Date.now();
      const rate = (await this.storage.get(ALERT_RATE_KEY)) || {};
      if (rate.testAt && now - rate.testAt < 60_000) return json({ error: 'test_rate_limited' }, 429);
      await this.storage.put(ALERT_RATE_KEY, { ...rate, testAt: now });
      await this.sendAlert({ test: true, now, entry: { observedAt: new Date(now).toISOString(), summary: 'Your weekly watch alerts are connected.' } });
      return json({ alert: this.alertSummary(await this.storage.get(ALERT_KEY)) });
    }
    if (!(await this.storage.get(WATCH_CONFIG_KEY))?.enabled) return json({ error: 'watch_required' }, 409);
    const validated = validateAlertDestination(body.url);
    if (!validated) return json({ error: 'invalid_destination' }, 400);
    const destination = { ...validated, plan: 'free', enabled: true, failures: 0, secret: newAlertSecret() };
    await this.storage.put(ALERT_KEY, destination);
    return json({ alert: this.alertSummary(destination), ...(destination.kind === 'webhook' ? { signingSecret: destination.secret } : {}) });
  }

  async sendAlert({ entry, now = Date.now(), test = false, feedUrl }) {
    const destination = await this.storage.get(ALERT_KEY);
    const config = await this.storage.get(WATCH_CONFIG_KEY);
    if (!destination?.enabled || !config?.enabled) return;
    if (!test) {
      if (!['breaking', 'risky'].includes(entry.severity)) return;
      const rate = (await this.storage.get(ALERT_RATE_KEY)) || {};
      if (rate.runAt === now || (rate.sentAt != null && now - rate.sentAt < 86400000 && rate.classification === entry.severity)) return;
      // Reserve before network I/O, including failed deliveries.
      await this.storage.put(ALERT_RATE_KEY, { ...rate, runAt: now, sentAt: now, classification: entry.severity });
    }
    const payload = renderAlert(destination.kind, { endpoint: config.endpoint, entry, test,
      feedUrl: feedUrl || `https://mcptest.io/r/${encodeURIComponent(config.endpoint)}/changes.xml` });
    const lastDelivery = await deliverAlert(destination, payload, { now });
    const failures = lastDelivery.status === 'ok' ? 0 : destination.failures + 1;
    await this.storage.put(ALERT_KEY, { ...destination, lastDelivery, failures, enabled: failures < 5 });
  }

  queueAlert(operation) {
    const result = this.alertQueue.then(operation);
    this.alertQueue = result.catch(() => {});
    return result;
  }

  // --- Watch registry (the "watch:registry" instance) ---

  async readRegistry() {
    const listed = await this.storage.list({ prefix: REGISTRY_PREFIX });
    return [...listed.values()];
  }

  async registryAdd(body) {
    const { endpointKey, endpoint, plan, now, max } = body;
    const key = `${REGISTRY_PREFIX}${endpointKey}`;
    const existing = await this.storage.get(key);
    if (existing) {
      const updated = { ...existing, endpoint, plan };
      await this.storage.put(key, updated);
      return json({ added: false, watching: true, entry: updated });
    }
    const count = (await this.readRegistry()).length;
    if (count >= max) return json({ added: false, watching: false, full: true, count });
    // A new endpoint is due on the next run, which records its baseline.
    const entry = { endpointKey, endpoint, plan, optedInAt: now, lastCheckedAt: null, lastOutcome: null };
    await this.storage.put(key, entry);
    return json({ added: true, watching: true, entry, count: count + 1 });
  }

  async registryRemove(body) {
    await this.storage.delete(`${REGISTRY_PREFIX}${body.endpointKey}`);
    return json({ removed: true });
  }

  /** Endpoints whose plan interval has elapsed, least recently checked first. */
  async registryDue(body) {
    const { now, limit, intervals } = body;
    const due = (await this.readRegistry())
      .filter((entry) => {
        const interval = intervals[entry.plan] ?? intervals.free;
        return !entry.lastCheckedAt || now - Date.parse(entry.lastCheckedAt) >= interval;
      })
      .sort((left, right) => (Date.parse(left.lastCheckedAt || 0) || 0) - (Date.parse(right.lastCheckedAt || 0) || 0))
      .slice(0, limit);
    return json({ entries: due });
  }

  async registryChecked(body) {
    const key = `${REGISTRY_PREFIX}${body.endpointKey}`;
    const existing = await this.storage.get(key);
    if (!existing) return json({ updated: false });
    await this.storage.put(key, { ...existing, lastCheckedAt: body.checkedAt, lastOutcome: body.outcome });
    return json({ updated: true });
  }

  publicEntry(entry) {
    const { removalTokenHash: _removalTokenHash, chunkCount: _chunkCount, ...rest } = entry;
    return rest;
  }

  async publish(body) {
    const { id, endpoint, contentHash, artifactJson, removalTokenHash, summary, now } = body;
    const index = await this.readIndex();
    const existing = index.find((entry) => entry.contentHash === contentHash);
    if (existing) {
      // The index is ordered by latest publication, so a republished snapshot moves
      // to the front (badge and "latest run" read element zero) and keeps its
      // artifact, permalink and removal-token hash.
      const republished = { ...existing, lastPublishedAt: now };
      const reordered = [republished, ...index.filter((entry) => entry !== existing)];
      await this.storage.put(INDEX_KEY, reordered);
      return json({ created: false, entry: this.publicEntry(republished), count: reordered.length });
    }
    const chunkCount = await this.writeArtifact(id, artifactJson);
    const entry = {
      id,
      endpoint,
      createdAt: now,
      lastPublishedAt: now,
      contentHash,
      summary,
      removalTokenHash,
      chunkCount,
    };
    const retained = [entry, ...index].slice(0, PUBLISHED_REPORT_RETENTION);
    const evicted = index.slice(PUBLISHED_REPORT_RETENTION - 1);
    for (const old of evicted) await this.deleteArtifact(old);
    await this.storage.put(INDEX_KEY, retained);
    return json({ created: true, entry: this.publicEntry(entry), count: retained.length }, 201);
  }

  async rateLimit(body) {
    const { limit, windowMs, now } = body;
    const hits = ((await this.storage.get(RATE_KEY)) || []).filter((timestamp) => now - timestamp < windowMs);
    if (hits.length >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
      await this.storage.put(RATE_KEY, hits);
      return json({ allowed: false, retryAfterSeconds, remaining: 0 });
    }
    hits.push(now);
    await this.storage.put(RATE_KEY, hits);
    return json({ allowed: true, remaining: limit - hits.length });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/alerts') {
        const body = await request.json();
        return await this.queueAlert(() => this.ownerAlerts({ method: body.method }, body));
      }
      if (request.method === 'POST' && path === '/watch/alert') {
        const body = await request.json();
        const delivery = this.queueAlert(() => this.sendAlert(body)).catch(() => {});
        if (this.state.waitUntil) this.state.waitUntil(delivery);
        else await delivery;
        return json({ accepted: true });
      }
      if (request.method === 'POST' && path === '/publish') return await this.publish(await request.json());
      if (request.method === 'POST' && path === '/rate-limit') return await this.rateLimit(await request.json());
      if (request.method === 'GET' && path === '/snapshots') {
        const index = await this.readIndex();
        return json({ entries: index.map((entry) => this.publicEntry(entry)), watch: await this.watchSummary() });
      }
      if (request.method === 'GET' && path === '/watch') {
        const { config, state, entries } = await this.readWatch();
        return json({ config, state, entries: entries.map((entry) => this.publicWatchEntry(entry)) });
      }
      if (request.method === 'GET' && path === '/watch/latest') return await this.latestWatchSnapshot();
      if (request.method === 'POST' && path === '/watch') return await this.setWatch(await request.json());
      if (request.method === 'POST' && path === '/watch/state') return await this.recordWatchState(await request.json());
      if (request.method === 'POST' && path === '/watch/snapshot') return await this.recordWatchSnapshot(await request.json());
      if (request.method === 'POST' && path === '/registry/add') return await this.registryAdd(await request.json());
      if (request.method === 'POST' && path === '/registry/remove') return await this.registryRemove(await request.json());
      if (request.method === 'POST' && path === '/registry/due') return await this.registryDue(await request.json());
      if (request.method === 'POST' && path === '/registry/checked') return await this.registryChecked(await request.json());
      if (path.startsWith('/snapshot/')) {
        const id = path.slice('/snapshot/'.length);
        const index = await this.readIndex();
        const entry = index.find((candidate) => candidate.id === id);
        if (!entry) return json({ error: 'not_found' }, 404);
        if (request.method === 'GET') {
          const artifactJson = await this.readArtifact(entry);
          if (artifactJson === undefined) return json({ error: 'not_found' }, 404);
          return json({ entry: this.publicEntry(entry), artifactJson });
        }
        if (request.method === 'POST') {
          const { removalTokenHash } = await request.json();
          return json({ valid: Boolean(removalTokenHash) && removalTokenHash === entry.removalTokenHash });
        }
        if (request.method === 'DELETE') {
          const body = await request.json();
          const { removalTokenHash } = body;
          if (!removalTokenHash || removalTokenHash !== entry.removalTokenHash) {
            return json({ error: 'forbidden' }, 403);
          }
          await this.deleteArtifact(entry);
          const remaining = index.filter((candidate) => candidate.id !== id);
          await this.storage.put(INDEX_KEY, remaining);
          // Removing the last snapshot removes the last token that could turn the
          // watch off, so the watch stops with it.
          const config = await this.storage.get(WATCH_CONFIG_KEY);
          const watchDisabled = remaining.length === 0 && Boolean(config?.enabled);
          if (remaining.length === 0) await this.queueAlert(() => this.storage.delete(ALERT_KEY));
          if (watchDisabled) await this.storage.put(WATCH_CONFIG_KEY, { ...config, enabled: false, updatedAt: body.now });
          return json({ deleted: true, remaining: remaining.length, watchDisabled });
        }
      }
      return json({ error: 'not_found' }, 404);
    } catch (error) {
      return json({ error: 'storage_failure' }, 500);
    }
  }
}
