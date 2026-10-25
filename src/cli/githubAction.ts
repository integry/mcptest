import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CLIENT_COMPATIBILITY, CLIENT_COMPATIBILITY_IDS } from '../data/clientCompatibility';
import { getClientHostProfile } from '../compatibility';
import { classifyBreakingChanges, explanationPathForRule, toolSurfaceFromInterfaceSnapshot, type BreakingChangeReport } from '../utils/breakingChanges';
import { interfaceSnapshotFromReport } from '../utils/interfaceSnapshot';
import { parsePublicReportJson, redactReportString, serializePublicReportJson, type PublicReport } from '../utils/reportArtifact';
import { fetchPublishedReport, fetchPublishedReportIndex, publishReport } from '../utils/publishedReports';
import { normalizePublishedEndpoint } from '../utils/publishedReportIdentity';
import { parseReleaseGateArgs, runCli } from './runCli';

type Environment = Record<string, string | undefined>;
export type ActionDecision = 'ready' | 'review' | 'blocked' | 'unknown' | 'authorization-required';
export interface ActionTarget {
  report: PublicReport;
  decision: ActionDecision;
  changes?: BreakingChangeReport;
  comparison?: 'complete' | 'partial' | 'unavailable';
  url?: string;
}
const MARKER = '<!-- mcptest-release-gate -->';
const rank: Record<ActionDecision, number> = { ready: 0, review: 1, unknown: 2, 'authorization-required': 3, blocked: 4 };
const worst = (a: ActionDecision, b: ActionDecision): ActionDecision => rank[a] >= rank[b] ? a : b;
const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  if (value !== 'true' && value !== 'false') throw new Error('Boolean inputs must be true or false.');
  return value === 'true';
};

export const parseActionInputs = (env: Environment) => {
  const value = (key: string) => env[`MCPTEST_ACTION_${key}`]?.trim() || '';
  const failOn = value('FAIL_ON') || 'blocked';
  if (!['blocked', 'review'].includes(failOn)) throw new Error('fail-on must be blocked or review.');
  const clients = [...new Set(value('CLIENTS').split(/[,\s]+/).filter(Boolean))];
  for (const id of clients) {
    const client = CLIENT_COMPATIBILITY.clients.find(client => client.id === id);
    if (!CLIENT_COMPATIBILITY_IDS.includes(id) || !client || !getClientHostProfile(client)) {
      throw new Error('clients must contain supported ids from clientCompatibility.json.');
    }
  }
  const argv = ['--quiet', '--client-compatibility', '--endpoints-env', 'MCPTEST_ACTION_ENDPOINTS',
    '--fail-on-result', failOn === 'review' ? 'blocked,unknown,review' : 'blocked,unknown', '--fail-on-severity', 'none'];
  if (value('BEARER')) argv.push('--bearer-token-env', value('BEARER'));
  if (value('API_KEY')) argv.push('--api-key-env', value('API_KEY'));
  if (bool(value('SESSION'), false)) argv.push('--session-resilience');
  // Reuse CLI URL, credential-reference, and same-origin credential validation before any I/O.
  parseReleaseGateArgs(argv, env);
  return { argv, clients, failOn, baseline: value('BASELINE') || 'none',
    comment: bool(value('COMMENT'), true), publish: bool(value('PUBLISH'), false) };
};

export const classifyActionTarget = (report: PublicReport, baseline: PublicReport | undefined, clients: string[]): ActionTarget => {
  let decision: ActionDecision = report.releaseDecision?.status || 'unknown';
  for (const id of clients) {
    const status = report.compatibility?.assessments[id]?.status || 'unknown';
    decision = worst(decision, status === 'incompatible' ? 'blocked' : status === 'unknown' ? 'unknown'
      : status === 'compatible-with-caveats' ? 'review' : 'ready');
  }
  let changes: BreakingChangeReport | undefined;
  let comparison: ActionTarget['comparison'];
  if (baseline) {
    const identity = (endpoint: string) => normalizePublishedEndpoint(endpoint) || new URL(endpoint).toString();
    if (identity(baseline.target.testedEndpoint) !== identity(report.target.testedEndpoint)) {
      throw new Error('Baseline endpoint does not match the evaluated endpoint.');
    }
    // Redaction can hide schema values while preserving the entire tool-name
    // inventory. That still proves removals, but cannot prove schema compatibility.
    const schemasComplete = baseline.toolSurfaceAnalysis?.toolDefinitions.status === 'complete'
      && report.toolSurfaceAnalysis?.toolDefinitions.status === 'complete';
    const surface = (value: PublicReport) => {
      if (schemasComplete) return toolSurfaceFromInterfaceSnapshot(interfaceSnapshotFromReport(value));
      const definitions = value.toolSurfaceAnalysis?.toolDefinitions;
      return definitions && (definitions.status === 'complete' || definitions.namesComplete === true)
        ? { tools: definitions.tools.map(tool => ({ name: tool.name })), outputSchemasObserved: false,
          annotationsObserved: false, titlesObserved: false, promptArgumentsObserved: false }
        : undefined;
    };
    const before = surface(baseline);
    const after = surface(report);
    comparison = !before || !after ? 'unavailable'
      : schemasComplete ? 'complete' : 'partial';
    if (comparison !== 'complete') decision = worst(decision, 'unknown');
    if (before && after) {
      changes = classifyBreakingChanges(before, after);
      if (changes.counts.breaking) decision = 'blocked';
      else if (changes.counts.risky) decision = worst(decision, 'review');
    }
  }
  return { report, decision, changes, comparison };
};

const escape = (value: string): string => redactReportString(value).replace(/[\\`*_{}[\]()<>|!#]/g, '\\$&').replace(/[\r\n]+/g, ' ');
const reference = (url?: string): string | undefined => {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'https://mcptest.io' && parsed.pathname.startsWith('/learn/')
      ? parsed.href.replace(/[()]/g, c => encodeURIComponent(c)) : undefined;
  } catch { return undefined; }
};
export const renderActionSummary = (targets: ActionTarget[], decision: ActionDecision, failed = false): string => {
  const lines = [MARKER, `## mcptest: ${decision}${failed ? ' — gate failed' : ''}`, '',
    '[Remote MCP release gate](https://mcptest.io/ci)', ''];
  if (decision === 'unknown' && !targets.length) lines.push('Comparison could not run; breaking count is unknown.', '');
  for (const target of targets) {
    lines.push(`### ${escape(target.report.target.testedEndpoint)}`, '', `Decision: **${target.decision}**`, '');
    if (target.url) lines.push(`[Full report](${target.url})`, '');
    lines.push('| Client | Compatibility |', '| --- | --- |');
    for (const [id, assessment] of Object.entries(target.report.compatibility?.assessments || {})) {
      lines.push(`| ${escape(id)} | ${escape(assessment.status)} |`);
    }
    lines.push('', 'Browser CORS and interactive OAuth remain unverified in headless CI; these are evidence-based verdicts, not client application launches.', '');
    if (target.decision === 'unknown') {
      lines.push('Comparison could not run reliably because evaluation or baseline evidence is incomplete; breaking count is unknown.', '');
    }
    if (target.comparison === 'partial') {
      lines.push('Only tool names could be compared. Schema comparison could not run because stored schemas are incomplete or redacted.', '');
    }
    if (target.changes) {
      lines.push(`Changes: ${target.changes.summary}`, '');
      for (const group of target.changes.groups.slice(0, 30)) {
        lines.push(`- **${escape(group.subject)}** (${group.severity})`);
        for (const finding of group.findings.slice(0, 8)) {
          lines.push(`  - [${escape(finding.title)}](https://mcptest.io${explanationPathForRule(finding.rule)}) — ${finding.severity}`);
        }
      }
      lines.push('', ...target.changes.limitations.map(item => `- ${escape(item)}`), '');
    } else lines.push('Baseline comparison unavailable or disabled; no claim of backward compatibility.', '');
    for (const finding of (target.report.releaseDecision?.priorities || []).slice(0, 5)) {
      const url = reference(finding.referenceUrl) || 'https://mcptest.io/learn/test-mcp-server-before-deploying#how-to-read-the-release-decision';
      lines.push(`- ${finding.severity}: ${url ? `[${escape(finding.title)}](${url})` : escape(finding.title)}`);
    }
    lines.push('');
  }
  // Leave ample room below GitHub's 65,536 character comment limit.
  return lines.join('\n').slice(0, 60000) + '\n';
};

/** Permission denial is an expected outcome for fork PRs. Never send the MCP credential here. */
export const updatePullRequestComment = async (body: string, env: Environment, fetchImpl: typeof fetch = fetch): Promise<'updated' | 'skipped'> => {
  const token = env.MCPTEST_ACTION_GITHUB_TOKEN;
  if (!token || !env.GITHUB_EVENT_PATH || !env.GITHUB_REPOSITORY || !['pull_request', 'pull_request_target'].includes(env.GITHUB_EVENT_NAME || '')) return 'skipped';
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const number = event.pull_request?.number;
  if (!Number.isSafeInteger(number)) return 'skipped';
  const base = env.GITHUB_API_URL || 'https://api.github.com';
  const path = `/repos/${env.GITHUB_REPOSITORY}`;
  const request = async (suffix: string, method = 'GET', payload?: unknown) => {
    const response = await fetchImpl(`${base}${path}${suffix}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    if ([401, 403, 404].includes(response.status)) return undefined;
    if (!response.ok) throw new Error('GitHub comment request failed.');
    return response.json();
  };
  for (let page = 1; ; page++) {
    const comments = await request(`/issues/${number}/comments?per_page=100&page=${page}`);
    if (!comments) return 'skipped';
    const existing = comments.find((item: { body?: string; user?: { login?: string }; id: number }) =>
      item.user?.login === 'github-actions[bot]' && item.body?.startsWith(MARKER));
    if (existing) return await request(`/issues/comments/${existing.id}`, 'PATCH', { body }) ? 'updated' : 'skipped';
    if (comments.length < 100) break;
  }
  return await request(`/issues/${number}/comments`, 'POST', { body }) ? 'updated' : 'skipped';
};

export const runGitHubAction = async (env: Environment = process.env): Promise<number> => {
  let outputDir: string | undefined;
  try {
    const inputs = parseActionInputs(env);
    const secrets = [env[env.MCPTEST_ACTION_BEARER || ''], env[env.MCPTEST_ACTION_API_KEY || ''], env.MCPTEST_ACTION_GITHUB_TOKEN].filter(Boolean) as string[];
    const scrub = (text: string) => secrets.reduce((result, secret) => result.split(secret).join('[REDACTED]'), text);
    // mkdtemp prevents a second invocation from reading stale reports from the first.
    const { mkdtemp } = await import('node:fs/promises');
    const workspace = env.GITHUB_WORKSPACE || process.cwd();
    await mkdir(resolve(workspace, 'mcptest-reports'), { recursive: true });
    outputDir = await mkdtemp(resolve(workspace, 'mcptest-reports', 'run-'));
    const baselinePath = inputs.baseline !== 'none' && inputs.baseline !== 'published'
      ? parsePublicReportJson(await readFile(resolve(workspace, inputs.baseline), 'utf8')) : undefined;
    const exitCode = await runCli([...inputs.argv, '--output-dir', outputDir], env);
    const reports: PublicReport[] = [];
    for (const filename of (await readdir(outputDir)).filter(file => file.endsWith('.json')).sort()) {
      reports.push(parsePublicReportJson(await readFile(resolve(outputDir, filename), 'utf8')));
    }
    const targets: ActionTarget[] = [];
    const apiOptions = { apiBase: 'https://mcptest.io', fetchImpl: ((url, options) => fetch(url, {
      ...options, redirect: 'error', signal: AbortSignal.timeout(20000),
    })) as typeof fetch };
    for (const report of reports) {
      let baseline = baselinePath;
      if (inputs.baseline === 'published') {
        const index = await fetchPublishedReportIndex(report.target.testedEndpoint, { ...apiOptions, fresh: true });
        const latest = index?.snapshots[0];
        if (!latest) throw new Error('No published baseline exists; use baseline: none for the first release.');
        baseline = await fetchPublishedReport(latest.id, apiOptions);
      }
      const target = classifyActionTarget(report, baseline, inputs.clients);
      // Read the baseline before publishing, so this run cannot compare against itself.
      if (inputs.publish) {
        const published = await publishReport(scrub(serializePublicReportJson(report)), apiOptions);
        if (!/^https:\/\/mcptest\.io\/r\/[a-zA-Z0-9_-]+$/.test(published.url)) throw new Error('Invalid published report URL.');
        target.url = published.url;
      }
      targets.push(target);
    }
    let decision = targets.reduce((result, target) => worst(result, target.decision), 'ready' as ActionDecision);
    if (exitCode >= 2 || !targets.length) decision = worst(decision, 'unknown');
    const failed = exitCode !== 0 || !['ready', 'review'].includes(decision) || (inputs.failOn === 'review' && decision === 'review');
    const comparisonUnavailable = exitCode >= 2 || !targets.length
      || targets.some(target => target.decision === 'unknown' || target.comparison === 'unavailable');
    const breakingCount = comparisonUnavailable ? 'unknown'
      : targets.reduce((sum, target) => sum + (target.changes?.counts.breaking || 0), 0);
    const summary = scrub(renderActionSummary(targets, decision, failed));
    await writeFile(resolve(outputDir, 'summary.md'), summary, { mode: 0o600 });
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary);
    if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `decision=${decision}\nbreaking-count=${breakingCount}\nreport-path=${outputDir}\nreport-url=${targets.find(target => target.url)?.url || ''}\n`);
    if (inputs.comment) {
      try {
        const outcome = await updatePullRequestComment(summary, env);
        if (outcome === 'skipped') process.stdout.write('mcptest: PR comment skipped (no writable PR token).\n');
      } catch { process.stdout.write('mcptest: PR comment unavailable; see the job summary.\n'); }
    }
    return failed ? 1 : 0;
  } catch {
    // Never print remote response bodies, baseline content, tokens or untrusted error messages.
    const summary = '## mcptest: unknown — gate failed\n\nConfiguration, baseline, publishing or evaluation failed. Check input names and service availability. Baseline comparison could not run; breaking count is unknown.\n';
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary);
    if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `decision=unknown\nbreaking-count=unknown\nreport-path=${outputDir || ''}\nreport-url=\n`);
    if (env.MCPTEST_ACTION_COMMENT !== 'false') {
      try { await updatePullRequestComment(`${MARKER}\n${summary}`, env); } catch { /* Summary remains available. */ }
    }
    process.stderr.write('mcptest: action failed; see the job summary.\n');
    return 1;
  }
};
