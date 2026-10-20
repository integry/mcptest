// Durable Object holding the published report snapshots of one endpoint, or the
// sliding-window rate-limit counter of one publisher scope.
//
// Instance names:
//   - "endpoint:<endpointKey>" keeps up to PUBLISHED_REPORT_RETENTION snapshots, newest
//     first, each addressed by its content hash so identical runs share one entry.
//   - "rate:<scope>:<value>" keeps the timestamps of recent publishes for one IP or host.
//
// Artifacts are stored as JSON text split into chunks so a snapshot never exceeds
// the per-value storage limit. Removal tokens are stored only as SHA-256 hashes.
import { PUBLISHED_REPORT_RETENTION } from '../../src/utils/publishedReportIdentity.ts';

const CHUNK_SIZE = 96 * 1024;
const INDEX_KEY = 'index';
const RATE_KEY = 'hits';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const chunkKey = (id, index) => `artifact:${id}:${index}`;

export class PublishedReports {
  constructor(state) {
    this.storage = state.storage;
  }

  async readIndex() {
    const index = await this.storage.get(INDEX_KEY);
    return Array.isArray(index) ? index : [];
  }

  async writeArtifact(id, artifactJson) {
    const chunkCount = Math.max(1, Math.ceil(artifactJson.length / CHUNK_SIZE));
    const entries = {};
    for (let index = 0; index < chunkCount; index += 1) {
      entries[chunkKey(id, index)] = artifactJson.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
    }
    await this.storage.put(entries);
    return chunkCount;
  }

  async readArtifact(entry) {
    const keys = Array.from({ length: entry.chunkCount }, (_, index) => chunkKey(entry.id, index));
    const chunks = await this.storage.get(keys);
    const parts = keys.map((key) => chunks.get(key));
    if (parts.some((part) => typeof part !== 'string')) return undefined;
    return parts.join('');
  }

  async deleteArtifact(entry) {
    await this.storage.delete(Array.from({ length: entry.chunkCount }, (_, index) => chunkKey(entry.id, index)));
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
      existing.lastPublishedAt = now;
      await this.storage.put(INDEX_KEY, index);
      return json({ created: false, entry: this.publicEntry(existing), count: index.length });
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
      if (request.method === 'POST' && path === '/publish') return await this.publish(await request.json());
      if (request.method === 'POST' && path === '/rate-limit') return await this.rateLimit(await request.json());
      if (request.method === 'GET' && path === '/snapshots') {
        const index = await this.readIndex();
        return json({ entries: index.map((entry) => this.publicEntry(entry)) });
      }
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
        if (request.method === 'DELETE') {
          const { removalTokenHash } = await request.json();
          if (!removalTokenHash || removalTokenHash !== entry.removalTokenHash) {
            return json({ error: 'forbidden' }, 403);
          }
          await this.deleteArtifact(entry);
          await this.storage.put(INDEX_KEY, index.filter((candidate) => candidate.id !== id));
          return json({ deleted: true });
        }
      }
      return json({ error: 'not_found' }, 404);
    } catch (error) {
      return json({ error: `storage_failure: ${error.message}` }, 500);
    }
  }
}
