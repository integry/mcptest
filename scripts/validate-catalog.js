#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  Client,
  StreamableHTTPClientTransport,
  discoverOAuthProtectedResourceMetadata,
  extractWWWAuthenticateParams,
} = require('@modelcontextprotocol/client');

const REQUEST_TIMEOUT_MS = 12_000;
const CONCURRENCY = 4;
const CLIENT_NAME = 'mcptest-catalog-validator';

const catalogPath = path.join(__dirname, '..', 'src', 'data', 'serverCatalog.json');
const outputPath = path.join(__dirname, '..', 'src', 'data', 'catalogValidation.json');

function requireRuntime() {
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') {
    console.error('Catalog validation requires Node 20+ for fetch and AbortController.');
    process.exitCode = 1;
    return false;
  }

  return true;
}

function toUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function slashVariants(value) {
  const url = toUrl(value);
  if (!url) return [];

  const withoutSlash = new URL(url);
  withoutSlash.pathname = withoutSlash.pathname.replace(/\/+$/, '') || '/';
  const withSlash = new URL(withoutSlash);
  withSlash.pathname = `${withoutSlash.pathname.replace(/\/+$/, '')}/`;

  return [...new Set([withoutSlash.toString(), withSlash.toString()])];
}

function siblingEndpoint(value, fromSegment, toSegment) {
  const url = toUrl(value);
  if (!url) return null;

  const pathWithoutSlash = url.pathname.replace(/\/+$/, '');
  if (!pathWithoutSlash.endsWith(`/${fromSegment}`)) return null;

  url.pathname = `${pathWithoutSlash.slice(0, -(fromSegment.length + 1))}/${toSegment}`;
  return url.toString();
}

/**
 * Preserve a catalog's exact endpoint first. Only synthesize conventional
 * /mcp and /sse candidates for origin roots or known terminal transport paths.
 */
function endpointVariants(seed) {
  const seedUrl = toUrl(seed.url);
  if (!seedUrl) return [];

  const candidates = [];
  const seen = new Set();
  const add = (url, transport) => {
    for (const candidateUrl of slashVariants(url)) {
      const key = `${transport}:${candidateUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ url: candidateUrl, transport });
    }
  };

  add(seedUrl.toString(), seed.transport);

  const normalizedPath = seedUrl.pathname.replace(/\/+$/, '');
  if (!normalizedPath) {
    const httpUrl = new URL(seedUrl);
    httpUrl.pathname = '/mcp';
    add(httpUrl.toString(), 'streamable-http');

    const sseUrl = new URL(seedUrl);
    sseUrl.pathname = '/sse';
    add(sseUrl.toString(), 'legacy-sse');
  } else if (normalizedPath.endsWith('/mcp')) {
    if (seed.transport === 'legacy-sse') add(seedUrl.toString(), 'streamable-http');
    const sseUrl = siblingEndpoint(seedUrl.toString(), 'mcp', 'sse');
    if (sseUrl) add(sseUrl, 'legacy-sse');
  } else if (normalizedPath.endsWith('/sse')) {
    if (seed.transport === 'streamable-http') add(seedUrl.toString(), 'legacy-sse');
    const httpUrl = siblingEndpoint(seedUrl.toString(), 'sse', 'mcp');
    if (httpUrl) add(httpUrl, 'streamable-http');
  } else {
    add(seedUrl.toString(), seed.transport === 'legacy-sse' ? 'streamable-http' : 'legacy-sse');
  }

  return candidates;
}

function abortErrorCode(error) {
  return error && (error.name === 'AbortError' || error.code === 'REQUEST_TIMEOUT')
    ? 'timeout'
    : 'network_error';
}

async function fetchWithTimeout(url, options = {}, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signals = [controller.signal, options.signal].filter(Boolean);
  const signal = signals.length > 1 && typeof AbortSignal.any === 'function'
    ? AbortSignal.any(signals)
    : controller.signal;

  try {
    const response = await fetchImpl(url, { ...options, signal });
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

function isAuthStatus(status) {
  return status === 401 || status === 403;
}

async function probeStreamableEndpoint(
  endpoint,
  { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}
) {
  const responses = [];
  let resourceMetadataUrl;
  const observingFetch = async (input, init) => {
    const response = await fetchImpl(input, init);
    responses.push({
      status: response.status,
      contentType: response.headers.get('content-type') || '',
    });

    if (isAuthStatus(response.status)) {
      resourceMetadataUrl = extractWWWAuthenticateParams(response).resourceMetadataUrl?.toString();
    }

    return response;
  };
  const client = new Client(
    { name: CLIENT_NAME, version: '2.0.0' },
    {
      versionNegotiation: {
        mode: 'auto',
        probe: { timeoutMs },
      },
    }
  );
  const transport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
    fetch: observingFetch,
  });

  try {
    await client.connect(transport, { timeout: timeoutMs });
    const era = client.getProtocolEra();
    const protocolVersion = client.getNegotiatedProtocolVersion();

    return {
      ...endpoint,
      reachable: true,
      alive: true,
      authChallenge: false,
      protocolEra: era === 'modern' ? 'stateless' : 'stateful',
      protocolVersion,
      statusCode: responses.find(({ status }) => status >= 200 && status < 300)?.status,
      message: `Negotiated ${era === 'modern' ? 'stateless' : 'stateful'} MCP${protocolVersion ? ` ${protocolVersion}` : ''} at ${endpoint.url}`,
    };
  } catch (error) {
    const authResponse = responses.find(({ status }) => isAuthStatus(status));
    const lastResponse = responses.at(-1);

    if (authResponse) {
      return {
        ...endpoint,
        reachable: true,
        alive: true,
        authChallenge: true,
        protocolEra: 'unknown',
        statusCode: authResponse.status,
        resourceMetadataUrl,
        message: `Authentication challenge at ${endpoint.url} returned HTTP ${authResponse.status}`,
      };
    }

    return {
      ...endpoint,
      reachable: Boolean(lastResponse),
      alive: false,
      authChallenge: false,
      protocolEra: 'unknown',
      statusCode: lastResponse?.status,
      errorCode: lastResponse ? 'protocol_error' : abortErrorCode(error),
      message: error && error.message ? error.message : String(error),
    };
  } finally {
    await client.close().catch(() => {});
  }
}

async function probeSseEndpoint(
  endpoint,
  { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}
) {
  const result = await fetchWithTimeout(
    endpoint.url,
    { method: 'GET', headers: { Accept: 'text/event-stream' } },
    fetchImpl,
    timeoutMs
  );

  if (!result.ok) {
    return {
      ...endpoint,
      reachable: false,
      alive: false,
      authChallenge: false,
      protocolEra: 'unknown',
      errorCode: result.errorCode,
      message: result.message,
    };
  }

  const { response } = result;
  const resourceMetadataUrl = isAuthStatus(response.status)
    ? extractWWWAuthenticateParams(response).resourceMetadataUrl?.toString()
    : undefined;
  const isEventStream = (response.headers.get('content-type') || '')
    .toLowerCase()
    .includes('text/event-stream');
  const authChallenge = isAuthStatus(response.status);
  await response.body?.cancel().catch(() => {});

  return {
    ...endpoint,
    reachable: true,
    alive: authChallenge || (response.ok && isEventStream),
    authChallenge,
    protocolEra: response.ok && isEventStream ? 'legacy' : 'unknown',
    statusCode: response.status,
    resourceMetadataUrl,
    errorCode: authChallenge || (response.ok && isEventStream) ? undefined : 'protocol_error',
    message: authChallenge
      ? `Authentication challenge at ${endpoint.url} returned HTTP ${response.status}`
      : `SSE probe at ${endpoint.url} returned HTTP ${response.status} (${response.headers.get('content-type') || 'no content type'})`,
  };
}

async function probeEndpoint(endpoint, options) {
  return endpoint.transport === 'legacy-sse'
    ? probeSseEndpoint(endpoint, options)
    : probeStreamableEndpoint(endpoint, options);
}

async function discoverAuthorizationEvidence(
  serverUrl,
  { protocolVersion, resourceMetadataUrl, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}
) {
  const metadataFetch = async (input, init) => {
    const result = await fetchWithTimeout(input, init, fetchImpl, timeoutMs);
    if (!result.ok) {
      const error = new Error(result.message);
      error.code = result.errorCode;
      throw error;
    }
    return result.response;
  };

  try {
    const metadata = await discoverOAuthProtectedResourceMetadata(
      serverUrl,
      { protocolVersion, resourceMetadataUrl },
      metadataFetch
    );
    const authorizationServers = Array.isArray(metadata?.authorization_servers)
      ? metadata.authorization_servers
      : [];

    return {
      oauthMetadata: Boolean(metadata && authorizationServers.length > 0),
      authorizationServers,
    };
  } catch {
    return { oauthMetadata: false, authorizationServers: [] };
  }
}

function detectedTransport(probes) {
  const hasStreamableHttp = probes.some(
    (probe) => probe.transport === 'streamable-http' && probe.alive && !probe.authChallenge
  );
  const hasLegacySse = probes.some(
    (probe) => probe.transport === 'legacy-sse' && probe.alive && !probe.authChallenge
  );

  if (hasStreamableHttp && hasLegacySse) return 'both';
  if (hasStreamableHttp) return 'streamable-http';
  if (hasLegacySse) return 'legacy-sse';
  return 'unknown';
}

function detectedStatus(probes) {
  if (probes.some((probe) => probe.alive)) return 'online';
  if (probes.some((probe) => probe.reachable)) return 'unknown';
  return 'offline';
}

function declaredAuthType(seed) {
  if (seed.authType) return seed.authType;
  return seed.requiresOAuth ? 'oauth' : 'none';
}

function detectedAuthType(seed, probes, authorizationEvidence) {
  const declared = declaredAuthType(seed);
  if (declared === 'api-key' || declared === 'bearer-token') return declared;
  if (probes.some((probe) => probe.alive && !probe.authChallenge)) return declared;
  if (authorizationEvidence.oauthMetadata) return 'oauth';
  if (probes.some((probe) => probe.authChallenge)) {
    return declared === 'none' ? 'bearer-token' : declared;
  }
  return declared;
}

function selectProtocolProbe(probes) {
  return probes.find(
    (probe) => probe.alive && probe.transport === 'streamable-http' && probe.protocolEra !== 'unknown'
  ) || probes.find((probe) => probe.alive && probe.protocolEra !== 'unknown');
}

function resultMessage(status, transport, probes, authType) {
  const successfulProbe = probes.find((probe) => probe.alive);
  if (successfulProbe) {
    return `${successfulProbe.message}; detected transport ${transport}; authentication ${authType}`;
  }

  const reachableProbe = probes.find((probe) => probe.reachable);
  if (reachableProbe) {
    return `${reachableProbe.message}; endpoint was reachable but did not complete an MCP probe`;
  }

  const failedProbe = probes[0];
  return failedProbe
    ? `All transport probes failed; first failure: ${failedProbe.errorCode || 'network_error'} (${failedProbe.message || 'request failed'})`
    : 'No transport probes were attempted';
}

function errorCodeForStatus(status, probes) {
  if (status === 'online') return undefined;
  if (status === 'unknown') return 'unexpected_response';
  return probes.some((probe) => probe.errorCode === 'timeout') ? 'timeout' : 'network_error';
}

async function validateSeed(
  seed,
  { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}
) {
  const probes = [];
  const validatedTransports = new Set();

  for (const endpoint of endpointVariants(seed)) {
    if (validatedTransports.has(endpoint.transport)) continue;
    const probe = await probeEndpoint(endpoint, { fetchImpl, timeoutMs });
    probes.push(probe);
    if (probe.alive) validatedTransports.add(endpoint.transport);
  }

  const status = detectedStatus(probes);
  const transport = detectedTransport(probes);
  const protocolProbe = selectProtocolProbe(probes);
  const successfulProbe = probes.find((probe) => probe.alive);
  const authProbe = probes.find((probe) => probe.resourceMetadataUrl);
  const authorizationEvidence = await discoverAuthorizationEvidence(
    successfulProbe?.url || seed.url,
    {
      protocolVersion: protocolProbe?.protocolVersion,
      resourceMetadataUrl: authProbe?.resourceMetadataUrl,
      fetchImpl,
      timeoutMs,
    }
  );
  const authType = detectedAuthType(seed, probes, authorizationEvidence);
  const errorCode = errorCodeForStatus(status, probes);
  const result = {
    serverId: seed.id,
    status,
    transport,
    authType,
    requiresOAuth: authType === 'oauth',
    protocolEra: protocolProbe?.protocolEra || 'unknown',
    checkedAt: new Date().toISOString(),
    message: resultMessage(status, transport, probes, authType),
  };

  if (successfulProbe?.url) result.validatedUrl = successfulProbe.url;
  if (protocolProbe?.protocolVersion) result.protocolVersion = protocolProbe.protocolVersion;
  if (authorizationEvidence.authorizationServers.length > 0) {
    result.authorizationServers = authorizationEvidence.authorizationServers;
  }
  if (errorCode) result.errorCode = errorCode;

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
        const authType = declaredAuthType(values[currentIndex]);
        results[currentIndex] = {
          serverId: values[currentIndex].id,
          status: 'offline',
          transport: 'unknown',
          authType,
          requiresOAuth: authType === 'oauth',
          protocolEra: 'unknown',
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
  fs.writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`, 'utf-8');
}

async function main() {
  if (!requireRuntime()) return;

  const seeds = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  console.log(`Validating ${seeds.length} catalog servers with concurrency ${CONCURRENCY}...`);

  const results = await mapWithConcurrency(seeds, CONCURRENCY, async (seed) => {
    const result = await validateSeed(seed);
    console.log(
      `${seed.id}: ${result.status}, ${result.transport}, ${result.protocolEra}, ${result.authType} - ${result.message}`
    );
    return result;
  });

  writeResults(results);
  console.log(`Catalog validation results written to ${path.relative(process.cwd(), outputPath)}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Catalog validation failed:', error && error.message ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  declaredAuthType,
  detectedAuthType,
  discoverAuthorizationEvidence,
  endpointVariants,
  probeSseEndpoint,
  probeStreamableEndpoint,
  validateSeed,
};
