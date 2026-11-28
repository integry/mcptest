// Slim projection of src/data/catalogCapabilities.json for the Cloudflare worker.
//
// The worker's /mcp/catalog index (cloudflare-worker/src/catalogIndex.js) reads only
// each inventory's observedAt, authentication, section counts and tool names. The
// full file (tool descriptions and input schemas) made up most of the deployed
// bundle and pushed it to ~10 MB, so the worker bundles this projection instead.
// The projection keeps the inventory shape for the fields it retains, so the
// worker produces the same summaries from either file.
//
// Regenerate with `npm run generate-worker-capabilities`; validate-catalog and
// import-catalog-capabilities rewrite it whenever they rewrite the full file, and
// cloudflare-worker/src/catalogIndex.test.js fails when the two drift apart.
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const capabilitiesPath = path.join(projectRoot, 'src', 'data', 'catalogCapabilities.json');
const workerCapabilitiesPath = path.join(projectRoot, 'src', 'data', 'workerCatalogCapabilities.json');

const COUNT_KEYS = ['observedCount', 'retainedCount'];

function projectSection(section) {
  if (!section || typeof section !== 'object') return undefined;
  const projected = {};
  for (const key of COUNT_KEYS) {
    if (section[key] !== undefined) projected[key] = section[key];
  }
  if (Array.isArray(section.items)) {
    projected.items = section.items.map((item) => (typeof item?.name === 'string' ? { name: item.name } : {}));
  }
  return projected;
}

function projectInventory(inventory) {
  if (!inventory || typeof inventory !== 'object') return inventory;
  const projected = {};
  if (inventory.observedAt !== undefined) projected.observedAt = inventory.observedAt;
  if (inventory.authentication !== undefined) projected.authentication = inventory.authentication;
  for (const key of ['tools', 'resources', 'prompts']) {
    const section = projectSection(inventory[key]);
    if (section !== undefined) projected[key] = section;
  }
  return projected;
}

function projectWorkerCapabilities(capabilities) {
  return Object.fromEntries(
    Object.entries(capabilities ?? {}).map(([serverId, inventory]) => [serverId, projectInventory(inventory)])
  );
}

function serializeWorkerCapabilities(capabilities) {
  return `${JSON.stringify(projectWorkerCapabilities(capabilities), null, 2)}\n`;
}

function writeWorkerCapabilities(capabilities, outputPath = workerCapabilitiesPath) {
  fs.writeFileSync(outputPath, serializeWorkerCapabilities(capabilities), 'utf8');
}

module.exports = {
  capabilitiesPath,
  workerCapabilitiesPath,
  projectWorkerCapabilities,
  serializeWorkerCapabilities,
  writeWorkerCapabilities,
};

if (require.main === module) {
  writeWorkerCapabilities(JSON.parse(fs.readFileSync(capabilitiesPath, 'utf8')));
  console.log(`Wrote ${path.relative(projectRoot, workerCapabilitiesPath)}`);
}
