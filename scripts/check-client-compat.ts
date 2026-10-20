/**
 * Fails when any cell in src/data/clientCompatibility.json was last verified
 * more than 90 days ago, or when the data is structurally invalid.
 *
 *   npm run check-client-compat
 *   npm run check-client-compat -- --today 2027-01-31
 */
import {
  CLIENT_COMPATIBILITY,
  CLIENT_COMPAT_MAX_AGE_DAYS,
  findStaleClientCompatibilityCells,
  validateClientCompatibility,
} from '../src/data/clientCompatibility';

const todayArg = process.argv.indexOf('--today');
const today = todayArg >= 0 ? process.argv[todayArg + 1] : new Date().toISOString().slice(0, 10);

if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? '')) {
  console.error('--today must be YYYY-MM-DD.');
  process.exit(1);
}

const problems = validateClientCompatibility(CLIENT_COMPATIBILITY);
const stale = findStaleClientCompatibilityCells(CLIENT_COMPATIBILITY, today);

for (const problem of problems) console.error(`invalid: ${problem}`);
for (const cell of stale) {
  console.error(`stale: ${cell.clientId}.${cell.path} verified ${cell.verifiedOn} (${cell.ageDays} days ago)`);
}

if (problems.length > 0 || stale.length > 0) {
  console.error(
    `\nClient compatibility check failed: ${problems.length} invalid, ${stale.length} older than ${CLIENT_COMPAT_MAX_AGE_DAYS} days.`
    + '\nRe-check each stale cell against its source and update value, source and verifiedOn (see docs/host-compatibility-engine.md).'
  );
  process.exit(1);
}

const sourceCount = CLIENT_COMPATIBILITY.clients.reduce((total, entry) => total + entry.sources.length, 0);
console.log(
  `Client compatibility data is current: ${CLIENT_COMPATIBILITY.clients.length} clients, ${sourceCount} sources, none older than ${CLIENT_COMPAT_MAX_AGE_DAYS} days on ${today}.`
);
