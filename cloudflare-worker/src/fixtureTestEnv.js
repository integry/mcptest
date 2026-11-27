// Exercise the production object's SQL and routing in Node integration tests.
import { DatabaseSync } from 'node:sqlite';
import { FixtureState } from './FixtureState.js';

export function fixtureTestEnv() {
  const objects = new Map();
  return { FIXTURE_STATE: {
    idFromName: name => name,
    get(name) {
      if (!objects.has(name)) {
        const db = new DatabaseSync(':memory:');
        const sql = { exec: (query, ...args) => db.prepare(query).all(...args) };
        objects.set(name, new FixtureState({ storage: { sql } }));
      }
      return objects.get(name);
    },
  } };
}
