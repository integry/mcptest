#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const REQUEST_TIMEOUT_MS = 15000;
const CONCURRENCY = 4;
const CLIENT_NAME = 'mcptest-catalog-validator';
const PROTOCOL_VERSION = '2025-06-18';

const catalogPath = path.join(__dirname, '..', 'src', 'data', 'serverCatalog.json');
const outputPath = path.join(__dirname, '..', 'src', 'data', 'catalogValidation.json');

function requireFetch() {
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') {
    console.error('Catalog validation requires Node 18+ for global fetch and AbortController.');
    process.exitCode = 1;
    return false;
  }

  return true;
}

function uniq(values) {
  return [...new Set(values)];
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function withTrailingSlash(value) {
  return `${stripTrailingSlash(value)}/`;
}

function toUrl(value) {
  try {
    return new URL(value);
  } catch (error) {
    return null;
  }
}

function endpointRoot(seedUrl) {
  const url = toUrl(seedUrl);
  if (!url) {
    return null;
  }

  const pathWithoutSlash = stripTrailingSlash(url.pathname);
  if (pathWithoutSlash.endsWith('/mcp') || pathWithoutSlash.endsWith('/sse')) {
    url.pathname = pathWithoutSlash.replace(/\/(mcp|sse)$/, '') || '/';
    url.search = '';
    url.hash = '';
    return stripTrailingSlash(url.toString());
  }

  url.search = '';
  url.hash = '';
  return stripTrailingSlash(url.toString());
}

function endpointVariants(seedUrl) {
  const root = endpointRoot(seedUrl);
  const seedWithoutSlash = stripTrailingSlash(seedUrl);
  const endpoints = [];

  if (root) {
    endpoints.push(
      { url: `${root}/mcp`, transport: 'streamable-http', method: 'POST' },
      { url: `${root}/sse`, transport: 'legacy-sse', method: 'GET' }
    );
  }

  endpoints.push(
    { url: seedWithoutSlash, transport: 'streamable-http', method: 'POST' },
    { url: seedWithoutSlash, transport: 'legacy-sse', method: 'GET' }
  );

  return uniq(endpoints.flatMap((endpoint) => [
    { ...endpoint, url: stripTrailingSlash(endpoint.url) },
    { ...endpoint, url: withTrailingSlash(endpoint.url) },
  ]).map((endpoint) => JSON.stringify(endpoint))).map((endpoint) => JSON.parse(endpoint));
}

function originFromUrl(seedUrl) {
  const url = toUrl(seedUrl);
  return url ? url.origin : null;
}

function isAuthStatus(status) {
  return status === 401 || status === 403;
}

function isAliveStatus(status) {
  return status === 200 || isAuthStatus(status);
}

function abortErrorCode(error) {
  if (error && error.name === 'AbortError') {
    return 'timeout';
  }

  return 'network_error';
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (response.body && typeof response.body.cancel === 'function') {
      response.body.cancel().catch(() => {});
    }

    return { ok: true, response };
  } catch (error) {
    return {
      ok: false,
      errorCode: abortErrorCode(error),
      message: error && error.message ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeEndpoint(endpoint) {
  const headers = endpoint.method === 'POST'
    ? {
        'accept': 'application/json, text/event-stream',
        'content-type': 'application/json',
      }
    : {
        'accept': 'text/event-stream',
      };

  const body = endpoint.method === 'POST'
    ? JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: {
            name: CLIENT_NAME,
            version: '1.0.0',
          },
        },
      })
    : undefined;

  const result = await fetchWithTimeout(endpoint.url, {
    method: endpoint.method,
    headers,
    body,
  });

  if (!result.ok) {
    return {
      ...endpoint,
      reachable: false,
      alive: false,
      requiresOAuth: false,
      errorCode: result.errorCode,
      message: result.message,
    };
  }

  const { response } = result;

  return {
    ...endpoint,
    reachable: true,
    alive: isAliveStatus(response.status),
    requiresOAuth: isAuthStatus(response.status),
    statusCode: response.status,
    message: `${endpoint.method} ${endpoint.url} returned ${response.status}`,
  };
}

async function hasOAuthMetadata(origin) {
  if (!origin) {
    return false;
  }

  const metadataUrls = [
    `${origin}/.well-known/oauth-protected-resource`,
    `${origin}/.well-known/oauth-authorization-server`,
  ];

  const results = await Promise.all(metadataUrls.map((url) => fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      'accept': 'application/json',
    },
  })));

  return results.some((result) => result.ok && result.response.status === 200);
}

function detectedTransport(probes) {
  const hasStreamableHttp = probes.some((probe) => probe.transport === 'streamable-http' && probe.alive);
  const hasLegacySse = probes.some((probe) => probe.transport === 'legacy-sse' && probe.alive);

  if (hasStreamableHttp && hasLegacySse) {
    return 'both';
  }

  if (hasStreamableHttp) {
    return 'streamable-http';
  }

  if (hasLegacySse) {
    return 'legacy-sse';
  }

  return 'unknown';
}

function detectedStatus(probes) {
  if (probes.some((probe) => probe.alive)) {
    return 'online';
  }

  if (probes.some((probe) => probe.reachable)) {
    return 'unknown';
  }

  return 'offline';
}

function resultMessage(status, transport, probes) {
  const successfulProbe = probes.find((probe) => probe.alive);
  if (successfulProbe) {
    return `${successfulProbe.message}; detected transport ${transport}`;
  }

  const reachableProbe = probes.find((probe) => probe.reachable);
  if (reachableProbe) {
    return `${reachableProbe.message}; response was reachable but unexpected`;
  }

  const failedProbe = probes[0];
  return failedProbe
    ? `All transport probes failed; first failure: ${failedProbe.errorCode || 'network_error'} (${failedProbe.message || 'request failed'})`
    : 'No transport probes were attempted';
}

function errorCodeForStatus(status, probes) {
  if (status === 'online') {
    return undefined;
  }

  if (status === 'unknown') {
    return 'unexpected_response';
  }

  const timedOut = probes.some((probe) => probe.errorCode === 'timeout');
  return timedOut ? 'timeout' : 'network_error';
}

async function validateSeed(seed) {
  const probes = [];

  for (const endpoint of endpointVariants(seed.url)) {
    probes.push(await probeEndpoint(endpoint));
  }

  const status = detectedStatus(probes);
  const transport = detectedTransport(probes);
  const oauthMetadataPresent = await hasOAuthMetadata(originFromUrl(seed.url));
  const requiresOAuth = seed.requiresOAuth || probes.some((probe) => probe.requiresOAuth) || oauthMetadataPresent;
  const errorCode = errorCodeForStatus(status, probes);

  const result = {
    serverId: seed.id,
    status,
    transport,
    requiresOAuth,
    checkedAt: new Date().toISOString(),
    message: resultMessage(status, transport, probes),
  };

  if (errorCode) {
    result.errorCode = errorCode;
  }

  return result;
}

async function mapWithConcurrency(values, concurrency, worker) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        results[currentIndex] = await worker(values[currentIndex], currentIndex);
      } catch (error) {
        results[currentIndex] = {
          serverId: values[currentIndex].id,
          status: 'offline',
          transport: 'unknown',
          requiresOAuth: values[currentIndex].requiresOAuth === true,
          checkedAt: new Date().toISOString(),
          errorCode: 'validator_error',
          message: error && error.message ? error.message : String(error),
        };
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => runWorker()
  ));

  return results;
}

function writeResults(results) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`, 'utf-8');
}

async function main() {
  if (!requireFetch()) {
    return;
  }

  const seeds = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  console.log(`Validating ${seeds.length} catalog servers with concurrency ${CONCURRENCY}...`);

  const results = await mapWithConcurrency(seeds, CONCURRENCY, async (seed) => {
    const result = await validateSeed(seed);
    const oauthLabel = result.requiresOAuth ? 'oauth' : 'no-oauth';
    console.log(`${seed.id}: ${result.status}, ${result.transport}, ${oauthLabel} - ${result.message}`);
    return result;
  });

  writeResults(results);
  console.log(`Catalog validation results written to ${path.relative(process.cwd(), outputPath)}`);
}

main().catch((error) => {
  console.error('Catalog validation failed:', error && error.message ? error.message : error);
  process.exitCode = 1;
});
