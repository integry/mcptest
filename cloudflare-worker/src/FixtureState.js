// One object per fixture and origin keeps registration, grant and session updates
// consistent across connections. Synchronous SQL updates commit together at yield.
import { handleFixtureRequest } from './fixtures.js';

export class FixtureState {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL, until INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS expiration ON records(until)');
  }

  get(key) {
    const [row] = this.sql.exec('SELECT value FROM records WHERE key = ? AND until > ?', key, Date.now());
    return row && JSON.parse(row.value);
  }

  set(key, value, until = Date.now() + 86_400_000) {
    this.sql.exec('INSERT OR REPLACE INTO records VALUES (?, ?, ?)', key, JSON.stringify(value), until);
  }

  delete(key) {
    this.sql.exec('DELETE FROM records WHERE key = ?', key);
  }

  fetch(request) {
    this.sql.exec('DELETE FROM records WHERE until <= ?', Date.now());
    return handleFixtureRequest(request, { store: this });
  }
}
