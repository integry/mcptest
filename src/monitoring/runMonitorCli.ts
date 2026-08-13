import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isOAuthSensitiveKey } from '../utils/transportDetection';
import { redactReportString } from '../utils/reportArtifact';
import { FileMonitoringStore } from './fileStore';
import { MonitoringRunner } from './monitoring';
import { createWebhookNotificationAdapter } from './notifications';
import type {
  MonitoringNotificationAdapter,
  MonitoringRetentionPolicy,
  MonitoringRetryPolicy,
  MonitoringTarget,
} from './types';

interface MonitorTargetConfiguration {
  id: string;
  endpoint: string;
  reportBaseUrl?: string;
  bearerTokenEnv?: string;
  apiKeyEnv?: string;
}

interface WebhookConfiguration {
  name?: string;
  urlEnv: string;
  bearerTokenEnv?: string;
}

interface MonitorConfiguration {
  targets: MonitorTargetConfiguration[];
  stateFile?: string;
  reportDirectory?: string;
  concurrency?: number;
  timeoutMs?: number;
  retry?: Partial<MonitoringRetryPolicy>;
  retention?: Partial<MonitoringRetentionPolicy>;
  webhooks?: WebhookConfiguration[];
}

const HELP = `mcptest scheduled monitor

Usage:
  npm run monitor -- --config <path> [--json]

Options:
  --config <path>  JSON configuration file
  --json           Print the redacted aggregate result as JSON
  -h, --help       Show this help

Target and webhook credentials must be referenced by environment-variable name.
Run this command from cron or another scheduler; state and bounded report snapshots
are persisted between invocations.
`;

class MonitorConfigurationError extends Error {}

const requiredEnvironment = (
  environment: Record<string, string | undefined>,
  name: string,
  purpose: string
): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new MonitorConfigurationError(`${purpose} must name a valid environment variable.`);
  }
  const value = environment[name];
  if (!value) throw new MonitorConfigurationError(`Environment variable ${name} is empty or missing.`);
  return value;
};

const checkedEndpoint = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MonitorConfigurationError('Every monitoring endpoint must be a valid URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new MonitorConfigurationError('Every monitoring endpoint must use HTTP or HTTPS.');
  }
  if (url.username || url.password || url.hash
      || [...url.searchParams.keys()].some(isOAuthSensitiveKey)) {
    throw new MonitorConfigurationError(
      'Monitoring endpoint credentials, fragments, and secret-like query parameters are not allowed.'
    );
  }
  return url.toString();
};

const readConfiguration = async (path: string): Promise<MonitorConfiguration> => {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(resolve(path), 'utf8'));
  } catch (error) {
    throw new MonitorConfigurationError(`Could not read monitor configuration: ${
      error instanceof Error ? error.message : String(error)
    }`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Array.isArray((value as MonitorConfiguration).targets)) {
    throw new MonitorConfigurationError('Monitor configuration must contain a targets array.');
  }
  return value as MonitorConfiguration;
};

const parseArguments = (argv: readonly string[]): { config?: string; json: boolean; help: boolean } => {
  let config: string | undefined;
  let json = false;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '-h' || argument === '--help') help = true;
    else if (argument === '--json') json = true;
    else if (argument === '--config') {
      config = argv[index + 1];
      if (!config || config.startsWith('-')) {
        throw new MonitorConfigurationError('--config requires a path.');
      }
      index += 1;
    } else {
      throw new MonitorConfigurationError(`Unknown option ${argument}.`);
    }
  }
  if (!help && !config) throw new MonitorConfigurationError('--config is required.');
  return { config, json, help };
};

const runtimeTargets = (
  config: MonitorConfiguration,
  environment: Record<string, string | undefined>
): MonitoringTarget[] => config.targets.map((target) => {
  if (!target || typeof target.id !== 'string' || typeof target.endpoint !== 'string') {
    throw new MonitorConfigurationError('Every target requires string id and endpoint fields.');
  }
  if (target.bearerTokenEnv && target.apiKeyEnv) {
    throw new MonitorConfigurationError(`Target ${target.id} cannot use both bearerTokenEnv and apiKeyEnv.`);
  }
  let headers: Headers | undefined;
  if (target.bearerTokenEnv) {
    headers = new Headers({ Authorization: `Bearer ${requiredEnvironment(
      environment, target.bearerTokenEnv, `Target ${target.id} bearerTokenEnv`
    )}` });
  } else if (target.apiKeyEnv) {
    headers = new Headers({ 'X-API-Key': requiredEnvironment(
      environment, target.apiKeyEnv, `Target ${target.id} apiKeyEnv`
    ) });
  }
  return {
    id: target.id,
    endpoint: checkedEndpoint(target.endpoint),
    ...(target.reportBaseUrl ? { reportBaseUrl: target.reportBaseUrl } : {}),
    ...(headers ? { headers } : {}),
  };
});

const notificationAdapters = (
  config: MonitorConfiguration,
  environment: Record<string, string | undefined>
): MonitoringNotificationAdapter[] => (config.webhooks || []).map((webhook) => {
  if (!webhook || typeof webhook.urlEnv !== 'string') {
    throw new MonitorConfigurationError('Every webhook requires a urlEnv field.');
  }
  const url = requiredEnvironment(environment, webhook.urlEnv, 'Webhook urlEnv');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MonitorConfigurationError(`Environment variable ${webhook.urlEnv} must contain a URL.`);
  }
  if (parsed.protocol !== 'https:') throw new MonitorConfigurationError('Webhook URLs must use HTTPS.');
  const headers = webhook.bearerTokenEnv ? {
    Authorization: `Bearer ${requiredEnvironment(
      environment, webhook.bearerTokenEnv, 'Webhook bearerTokenEnv'
    )}`,
  } : undefined;
  return createWebhookNotificationAdapter({ url, headers, name: webhook.name });
});

export const runMonitorCli = async (
  argv: readonly string[] = process.argv.slice(2),
  environment: Record<string, string | undefined> = process.env
): Promise<number> => {
  try {
    const args = parseArguments(argv);
    if (args.help) {
      process.stdout.write(HELP);
      return 0;
    }
    const config = await readConfiguration(args.config!);
    const runner = new MonitoringRunner({
      targets: runtimeTargets(config, environment),
      store: new FileMonitoringStore({
        stateFile: config.stateFile,
        reportDirectory: config.reportDirectory,
      }),
      notifications: notificationAdapters(config, environment),
      concurrency: config.concurrency,
      timeoutMs: config.timeoutMs,
      retry: config.retry,
      retention: config.retention,
    });
    const result = await runner.runOnce();
    if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      for (const target of result.targets) {
        process.stdout.write(`${target.serverId}: ${target.snapshot?.status || 'skipped'}\n`);
      }
      process.stdout.write(`aggregate: ${result.aggregate.status}\n`);
    }
    return result.targets.some((target) => target.snapshot?.status === 'checker-failure') ? 4 : 0;
  } catch (error) {
    process.stderr.write(`mcptest monitor: ${redactReportString(
      error instanceof Error ? error.message : String(error)
    )}\n`);
    return 3;
  }
};

export const monitorHelp = HELP;
