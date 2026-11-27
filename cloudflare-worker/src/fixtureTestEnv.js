// Exercise the production object's SQL and routing in Node integration tests.
import { DatabaseSync } from 'node:sqlite';
import { SubmissionRateLimiter } from './submissions.js';

export function fixtureTestEnv() {
  const objects = new Map();
  return { SUBMISSION_RATE_LIMITER: {
    idFromName: name => name,
    get(name) {
      if (!objects.has(name)) {
        const db = new DatabaseSync(':memory:');
        const sql = { exec: (query, ...args) => db.prepare(query).all(...args) };
        objects.set(name, new SubmissionRateLimiter({ id: { name }, storage: { sql } }));
      }
      return objects.get(name);
    },
  } };
}
