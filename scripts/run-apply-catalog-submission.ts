import fs from 'node:fs';
import {
  applySubmission,
  parseSubmissionPayload,
  reconcileWithValidation,
  renderPullRequest,
} from './apply-catalog-submission';

// Usage (see .github/workflows/catalog-submission.yml):
//   apply  --payload <client_payload.json> --state <state.json>
//   report --payload <client_payload.json> --state <state.json> --output <pr-body.md>
//          [--validation-outcome success|failure] [--validation-log <file>]
//          [--assets-outcome success|failure] [--assets-log <file>] [--run-url <url>]
// Step outputs go to $GITHUB_OUTPUT when it is set.

const [command, ...rest] = process.argv.slice(2);
const options = new Map<string, string>();
for (let index = 0; index < rest.length; index += 2) {
  if (!rest[index].startsWith('--') || rest[index + 1] === undefined) {
    throw new Error(`Unexpected argument ${rest[index]}`);
  }
  options.set(rest[index].slice(2), rest[index + 1]);
}

const required = (name: string): string => {
  const value = options.get(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
};

const setOutput = (name: string, value: string) => {
  const line = `${name}=${value.replace(/[\r\n]+/g, ' ')}\n`;
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, line);
  else process.stdout.write(line);
};

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

const run = async () => {
  if (command === 'apply') {
    const result = await applySubmission(readJson(required('payload')));
    fs.writeFileSync(required('state'), JSON.stringify({
      id: result.id,
      ...(result.logo.fallbackReason ? { logoFallbackReason: result.logo.fallbackReason } : {}),
    }));
    console.error(`Added ${result.id} (${result.entry.url}) with a ${result.entry.logoSourceKind} logo.`);
    if (result.logo.fallbackReason) console.error(result.logo.fallbackReason);
    setOutput('id', result.id);
    setOutput('branch', result.branch);
    return;
  }

  if (command === 'report') {
    const payload = parseSubmissionPayload(readJson(required('payload')));
    const state = readJson(required('state')) as { id: string; logoFallbackReason?: string };
    const validation = reconcileWithValidation(state.id);
    const report = renderPullRequest({
      payload,
      id: state.id,
      validation,
      validationOutcome: options.get('validation-outcome') || 'failure',
      validationLog: options.get('validation-log'),
      assetsOutcome: options.get('assets-outcome') || 'failure',
      assetsLog: options.get('assets-log'),
      logoFallbackReason: state.logoFallbackReason,
      runUrl: options.get('run-url'),
    });
    fs.writeFileSync(required('output'), report.body, 'utf8');
    setOutput('title', report.title);
    setOutput('draft', String(report.draft));
    return;
  }

  throw new Error('Usage: run-apply-catalog-submission.ts apply|report --payload <file> ...');
};

run().catch((error: unknown) => {
  console.error('Catalog submission failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
