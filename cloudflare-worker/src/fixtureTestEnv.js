// Exercise the production objects without relying on an object ID's name.
import { DatabaseSync } from 'node:sqlite';
import { FixtureState } from './FixtureState.js';
import { SubmissionRateLimiter } from './submissions.js';

function namespace(create) {
  const objects = new Map();
  return {
    idFromName: name => name,
    get(id) {
      if (!objects.has(id)) objects.set(id, create());
      return objects.get(id);
    },
  };
}

export function fixtureTestEnv() {
  return {
    FIXTURE_STATE: namespace(() => {
      const db = new DatabaseSync(':memory:');
      const sql = { exec: (query, ...args) => db.prepare(query).all(...args) };
      return new FixtureState({ storage: { sql } });
    }),
    SUBMISSION_RATE_LIMITER: namespace(() => {
      const data = new Map();
      let alarm = null;
      const limiter = new SubmissionRateLimiter({ storage: {
        get: key => data.get(key),
        put: (key, value) => data.set(key, value),
        getAlarm: () => alarm,
        setAlarm: time => { alarm = time; },
      } });
      return { fetch: (url, init) => limiter.fetch(new Request(url, init)) };
    }),
  };
}
