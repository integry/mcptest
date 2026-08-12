import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isOAuthSensitiveKey } from '../utils/transportDetection';
import { redactReportString } from '../utils/reportArtifact';
import {
  DEFAULT_RELEASE_GATE_POLICY,
  RELEASE_GATE_EXIT_CODES,
  credentialedEndpointConfigurationError,
  runReleaseGate,
  type ReleaseGateExitCode,
  type ReleaseGatePolicy,
  type ReleaseGateSeverityThreshold,
} from './releaseGate';

type ArtifactFormat = 'json' | 'markdown' | 'both';

interface ParsedReleaseGateArgs {
  endpoints: string[];
  outputDir: string;
  format: ArtifactFormat;
  headers?: Headers;
  policy: ReleaseGatePolicy;
  quiet: boolean;
  help: boolean;
  consumedSecretEnvironmentVariables: string[];
}

export class ReleaseGateConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseGateConfigurationError';
  }
}

const HELP = `mcptest headless release gate

Usage:
  npm run mcptest -- [options] <endpoint...>

Endpoint options:
  --endpoints-env <name>       Read newline-delimited endpoints from an environment variable
  --bearer-token-env <name>    Read a bearer token from an environment variable
  --api-key-env <name>         Read an API key from an environment variable (sent as X-API-Key)

Artifact options:
  --output-dir <path>          Artifact directory (default: mcptest-reports)
  --format <value>             json, markdown, or both (default: both)

Gate options:
  --fail-on-result <list>      Comma-separated ready, review, blocked, unknown; or none
                               (default: blocked,unknown)
  --fail-on-severity <value>   critical, high, medium, unknown, or none (default: high)
  --quiet                      Hide evaluator progress
  -h, --help                   Show this help

Exit codes:
  0 pass                       1 configured threshold failed
  2 browser authorization required
  3 invalid configuration      4 infrastructure or artifact-write failure

Credentials are accepted only by environment-variable reference so they are not
placed in command arguments. Browser OAuth is intentionally non-interactive and
returns exit code 2 with an authorization-required report.
`;

const requireValue = (argv: readonly string[], index: number, option: string): string => {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new ReleaseGateConfigurationError(`${option} requires a value.`);
  }
  return value;
};

const environmentName = (value: string, option: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new ReleaseGateConfigurationError(`${option} must name a valid environment variable.`);
  }
  return value;
};

const normalizeEndpoint = (value: string): string => {
  let endpoint: URL;
  try {
    const hasExplicitScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
    endpoint = new URL(hasExplicitScheme ? value : `https://${value}`);
  } catch {
    throw new ReleaseGateConfigurationError('Every endpoint must be a valid HTTP or HTTPS URL.');
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new ReleaseGateConfigurationError('Every endpoint must use HTTP or HTTPS.');
  }
  if (endpoint.username || endpoint.password) {
    throw new ReleaseGateConfigurationError(
      'Endpoint userinfo is not allowed; supply credentials through an environment variable.'
    );
  }
  if (endpoint.hash) {
    throw new ReleaseGateConfigurationError(
      'Endpoint URL fragments are not allowed; supply credentials through an environment variable.'
    );
  }
  if ([...endpoint.searchParams.keys()].some(isOAuthSensitiveKey)) {
    throw new ReleaseGateConfigurationError(
      'Credential-like endpoint query parameters are not allowed; supply credentials through an environment variable.'
    );
  }
  return endpoint.toString();
};

const parseResultThreshold = (value: string): ReadonlySet<ReleaseGatePolicy['failOnResults'] extends ReadonlySet<infer T> ? T : never> => {
  if (value === 'none') return new Set();
  const statuses = value.split(',').map((item) => item.trim()).filter(Boolean);
  const allowed = new Set(['ready', 'review', 'blocked', 'unknown']);
  if (statuses.length === 0 || statuses.some((status) => !allowed.has(status))) {
    throw new ReleaseGateConfigurationError(
      '--fail-on-result must be a comma-separated subset of ready, review, blocked, unknown; or none.'
    );
  }
  return new Set(statuses) as ReleaseGatePolicy['failOnResults'];
};

const parseSeverityThreshold = (value: string): ReleaseGateSeverityThreshold => {
  if (!['critical', 'high', 'medium', 'unknown', 'none'].includes(value)) {
    throw new ReleaseGateConfigurationError(
      '--fail-on-severity must be critical, high, medium, unknown, or none.'
    );
  }
  return value as ReleaseGateSeverityThreshold;
};

export const parseReleaseGateArgs = (
  argv: readonly string[],
  environment: Record<string, string | undefined>
): ParsedReleaseGateArgs => {
  const positionalEndpoints: string[] = [];
  let endpointsEnvironment: string | undefined;
  let bearerEnvironment: string | undefined;
  let apiKeyEnvironment: string | undefined;
  let outputDir = 'mcptest-reports';
  let format: ArtifactFormat = 'both';
  let failOnResults = DEFAULT_RELEASE_GATE_POLICY.failOnResults;
  let failOnSeverity = DEFAULT_RELEASE_GATE_POLICY.failOnSeverity;
  let quiet = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '-h' || argument === '--help') {
      help = true;
    } else if (argument === '--quiet') {
      quiet = true;
    } else if (argument === '--endpoints-env') {
      endpointsEnvironment = environmentName(requireValue(argv, index, argument), argument);
      index += 1;
    } else if (argument === '--bearer-token-env') {
      bearerEnvironment = environmentName(requireValue(argv, index, argument), argument);
      index += 1;
    } else if (argument === '--api-key-env') {
      apiKeyEnvironment = environmentName(requireValue(argv, index, argument), argument);
      index += 1;
    } else if (argument === '--output-dir') {
      outputDir = requireValue(argv, index, argument);
      index += 1;
    } else if (argument === '--format') {
      const value = requireValue(argv, index, argument);
      if (!['json', 'markdown', 'both'].includes(value)) {
        throw new ReleaseGateConfigurationError('--format must be json, markdown, or both.');
      }
      format = value as ArtifactFormat;
      index += 1;
    } else if (argument === '--fail-on-result') {
      failOnResults = parseResultThreshold(requireValue(argv, index, argument));
      index += 1;
    } else if (argument === '--fail-on-severity') {
      failOnSeverity = parseSeverityThreshold(requireValue(argv, index, argument));
      index += 1;
    } else if (argument.startsWith('-')) {
      throw new ReleaseGateConfigurationError(`Unknown option ${argument}.`);
    } else {
      positionalEndpoints.push(argument);
    }
  }

  if (help) {
    return {
      endpoints: [], outputDir, format, policy: { failOnResults, failOnSeverity }, quiet,
      help, consumedSecretEnvironmentVariables: [],
    };
  }
  if (bearerEnvironment && apiKeyEnvironment) {
    throw new ReleaseGateConfigurationError(
      '--bearer-token-env and --api-key-env are mutually exclusive.'
    );
  }

  const environmentEndpoints = endpointsEnvironment
    ? (environment[endpointsEnvironment] || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    : [];
  const endpoints = [...positionalEndpoints, ...environmentEndpoints].map(normalizeEndpoint);
  if (endpoints.length === 0) {
    throw new ReleaseGateConfigurationError(
      endpointsEnvironment
        ? `Environment variable ${endpointsEnvironment} must contain at least one endpoint.`
        : 'Provide at least one endpoint or use --endpoints-env.'
    );
  }

  const consumedSecretEnvironmentVariables: string[] = [];
  let headers: Headers | undefined;
  if (bearerEnvironment || apiKeyEnvironment) {
    const name = bearerEnvironment || apiKeyEnvironment as string;
    const credential = environment[name];
    if (!credential || credential.trim().length === 0) {
      throw new ReleaseGateConfigurationError(`Environment variable ${name} is empty or missing.`);
    }
    try {
      headers = new Headers(bearerEnvironment
        ? { Authorization: `Bearer ${credential}` }
        : { 'X-API-Key': credential });
    } catch {
      throw new ReleaseGateConfigurationError(
        `Environment variable ${name} contains an invalid HTTP credential.`
      );
    }
    consumedSecretEnvironmentVariables.push(name);
  }

  const credentialConfigurationError = credentialedEndpointConfigurationError(endpoints, headers);
  if (credentialConfigurationError) {
    throw new ReleaseGateConfigurationError(credentialConfigurationError);
  }

  return {
    endpoints,
    outputDir,
    format,
    headers,
    policy: { failOnResults, failOnSeverity },
    quiet,
    help,
    consumedSecretEnvironmentVariables,
  };
};

const withSuppressedLibraryConsole = async <T>(action: () => Promise<T>): Promise<T> => {
  const original = {
    log: console.log,
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  console.log = () => {};
  console.debug = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await action();
  } finally {
    Object.assign(console, original);
  }
};

export const runCli = async (
  argv: readonly string[] = process.argv.slice(2),
  environment: Record<string, string | undefined> = process.env
): Promise<ReleaseGateExitCode> => {
  let configuration: ParsedReleaseGateArgs;
  try {
    configuration = parseReleaseGateArgs(argv, environment);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`mcptest: ${redactReportString(message)}\nUse --help for usage.\n`);
    return RELEASE_GATE_EXIT_CODES.invalidConfiguration;
  }

  if (configuration.help) {
    process.stdout.write(HELP);
    return RELEASE_GATE_EXIT_CODES.pass;
  }

  for (const name of configuration.consumedSecretEnvironmentVariables) {
    if (environment === process.env) delete process.env[name];
  }

  const result = await withSuppressedLibraryConsole(() => runReleaseGate({
    endpoints: configuration.endpoints,
    headers: configuration.headers,
    policy: configuration.policy,
    generatedAt: new Date(),
    ...(!configuration.quiet ? {
      onProgress: ({ index, total, endpoint, message }) => {
        process.stderr.write(`[${index + 1}/${total}] ${endpoint}: ${message}\n`);
      },
    } : {}),
  }));

  let writeFailed = false;
  const outputDir = resolve(configuration.outputDir);
  try {
    await mkdir(outputDir, { recursive: true });
  } catch (error) {
    process.stderr.write(`mcptest: could not create the artifact directory: ${redactReportString(
      error instanceof Error ? error.message : String(error)
    )}\n`);
    return RELEASE_GATE_EXIT_CODES.infrastructureFailure;
  }

  for (const target of result.targets) {
    const written: string[] = [];
    try {
      if (target.json && (configuration.format === 'json' || configuration.format === 'both')) {
        const path = resolve(outputDir, `${target.filenameBase}.json`);
        await writeFile(path, target.json, { encoding: 'utf8', mode: 0o600 });
        written.push(path);
      }
      if (target.markdown && (configuration.format === 'markdown' || configuration.format === 'both')) {
        const path = resolve(outputDir, `${target.filenameBase}.md`);
        await writeFile(path, target.markdown, { encoding: 'utf8', mode: 0o600 });
        written.push(path);
      }
    } catch (error) {
      writeFailed = true;
      process.stderr.write(`mcptest: artifact write failed for ${target.endpoint}: ${redactReportString(
        error instanceof Error ? error.message : String(error)
      )}\n`);
    }

    const decision = target.releaseDecision?.status || target.status;
    process.stdout.write(`${target.endpoint}: ${decision}\n`);
    for (const reason of target.thresholdReasons) process.stdout.write(`  threshold: ${reason}\n`);
    if (target.error) process.stderr.write(`  infrastructure: ${target.error}\n`);
    for (const path of written) process.stdout.write(`  artifact: ${path}\n`);
  }

  return writeFailed ? RELEASE_GATE_EXIT_CODES.infrastructureFailure : result.exitCode;
};

export const releaseGateHelp = HELP;
