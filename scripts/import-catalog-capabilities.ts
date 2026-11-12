#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { PublicReportSchema } from '../src/utils/reportArtifact';
import { validateCapabilityInventory } from '../src/utils/capabilityInventory';
import type { CatalogServerSeed, CatalogValidationResult } from '../src/types/catalog';
import type { CapabilityInventoryV1 } from '../src/types/capabilityInventory';

const projectRoot = path.join(__dirname, '..');
const catalogPath = path.join(projectRoot, 'src', 'data', 'serverCatalog.json');
const validationPath = path.join(projectRoot, 'src', 'data', 'catalogValidation.json');
const capabilitiesPath = path.join(projectRoot, 'src', 'data', 'catalogCapabilities.json');

const option = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const endpointIdentity = (value: string): string => {
  const url = new URL(value);
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
};

const fail = (message: string): never => {
  throw new Error(message);
};

const writeCapabilities = (snapshots: Record<string, CapabilityInventoryV1>): void => {
  const next = Object.fromEntries(Object.entries(snapshots)
    .sort(([left], [right]) => left.localeCompare(right)));
  fs.writeFileSync(capabilitiesPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
};

// Scheduled revalidation mode: re-checks every stored snapshot (including imported
// authenticated inventories) and drops snapshots for servers no longer in the catalog.
const refreshAll = (): void => {
  const seeds = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as CatalogServerSeed[];
  const catalogIds = new Set(seeds.map(({ id }) => id));
  const current = JSON.parse(
    fs.readFileSync(capabilitiesPath, 'utf8')
  ) as Record<string, CapabilityInventoryV1>;
  const retained = Object.entries(current).filter(([serverId]) => catalogIds.has(serverId));
  const next = Object.fromEntries(retained.map(([serverId, inventory]) => {
    try {
      return [serverId, validateCapabilityInventory(inventory)];
    } catch (error) {
      return fail(`Stored capability inventory for ${serverId} is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`);
    }
  }));
  writeCapabilities(next);
  const dropped = Object.keys(current).length - retained.length;
  console.log(`Verified ${retained.length} capability snapshots${dropped > 0 ? `; dropped ${dropped} for removed servers` : ''}.`);
};

const main = (): void => {
  if (process.argv.includes('--all')) {
    refreshAll();
    return;
  }
  const serverId = option('--server');
  const reportPath = option('--report');
  if (!serverId || !reportPath) {
    fail('Usage: npm run import-catalog-capabilities -- --server <catalog-id> --report <public-report.json>\n'
      + '   or: npm run import-catalog-capabilities -- --all');
  }

  const seeds = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as CatalogServerSeed[];
  const seed = seeds.find(({ id }) => id === serverId);
  if (!seed) fail(`Unknown catalog server id: ${serverId}`);
  const validations = JSON.parse(fs.readFileSync(validationPath, 'utf8')) as CatalogValidationResult[];
  const validation = validations.find(({ serverId: id }) => id === serverId);
  const parsedReport = PublicReportSchema.safeParse(JSON.parse(
    fs.readFileSync(path.resolve(reportPath), 'utf8')
  ));
  if (!parsedReport.success) fail(`Public report is invalid: ${parsedReport.error.message}`);
  if (!parsedReport.data.capabilityInventory) fail('Public report has no capability inventory.');

  const inventory = validateCapabilityInventory(parsedReport.data.capabilityInventory);
  if (endpointIdentity(parsedReport.data.target.testedEndpoint)
      !== endpointIdentity(inventory.provenance.testedEndpoint)) {
    fail('Report target and capability inventory provenance do not match.');
  }

  const knownEndpoints = [seed.url, seed.browserUrl, validation?.validatedUrl]
    .filter((value): value is string => Boolean(value))
    .map(endpointIdentity);
  const importedEndpoint = endpointIdentity(inventory.provenance.testedEndpoint);
  const seedOrigin = new URL(seed.url).origin;
  if (new URL(importedEndpoint).origin !== seedOrigin) {
    fail(`Report origin does not match catalog server ${serverId}.`);
  }
  if (!knownEndpoints.includes(importedEndpoint)) {
    fail(`Report endpoint is not a known endpoint for catalog server ${serverId}.`);
  }

  const current = JSON.parse(
    fs.readFileSync(capabilitiesPath, 'utf8')
  ) as Record<string, CapabilityInventoryV1>;
  writeCapabilities({ ...current, [serverId]: inventory });
  console.log(`Imported capability inventory for ${serverId} observed at ${inventory.observedAt}.`);
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
