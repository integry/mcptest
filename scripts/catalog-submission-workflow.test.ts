import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'catalog-submission.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

// actionlint is not a project dependency; set ACTIONLINT to its path or put it on PATH to run it.
const actionlint = process.env.ACTIONLINT
  || (spawnSync('actionlint', ['-version'], { stdio: 'ignore' }).status === 0 ? 'actionlint' : undefined);

/** `run:` scripts, including block scalars, so expressions inside them can be checked. */
const runScripts = (): string[] => {
  const lines = workflow.split('\n');
  const scripts: string[] = [];
  lines.forEach((line, index) => {
    const match = line.match(/^(\s*)(?:- )?run: ?(.*)$/);
    if (!match) return;
    if (match[2] !== '|' && match[2] !== '>') {
      scripts.push(match[2]);
      return;
    }
    const indent = match[1].length;
    const body: string[] = [];
    for (const next of lines.slice(index + 1)) {
      if (next.trim() && next.search(/\S/) <= indent) break;
      body.push(next);
    }
    scripts.push(body.join('\n'));
  });
  return scripts;
};

describe('catalog submission workflow', () => {
  it('runs only on the catalog-submission repository_dispatch event', () => {
    expect(workflow).toMatch(/^on:\n {2}repository_dispatch:\n {4}types: \[catalog-submission\]\n/m);
  });

  it('pins every action by commit SHA', () => {
    const uses = [...workflow.matchAll(/uses: (\S+)/g)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThanOrEqual(3);
    for (const reference of uses) expect(reference).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it('uses least-privilege permissions and one concurrency group per submission', () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(workflow).toMatch(/ {4}permissions:\n {6}contents: write\n {6}pull-requests: write\n/);
    expect(workflow).toContain('group: catalog-submission-${{ github.event.client_payload.submission_id }}');
    expect(workflow).toContain('persist-credentials: false');
  });

  it('installs on Node 22, validates the single server and the assets, and opens a labeled pull request', () => {
    expect(workflow).toContain('node-version: 22');
    expect(workflow).toContain('npm run validate-catalog -- --only "$SERVER_ID"');
    expect(workflow).toContain('npm run validate-catalog-assets');
    // The branch comes from the validated submission id, never from the derived catalog id.
    expect(workflow).toContain('branch: ${{ steps.apply.outputs.branch }}');
    expect(workflow).not.toContain('branch: submissions/${{ steps.apply.outputs.id }}');
    expect(workflow).toContain('labels: catalog-submission');
    expect(workflow).toContain('draft: ${{ steps.report.outputs.draft }}');
    // A failed runner check must still lead to a (draft) pull request.
    expect(workflow.match(/continue-on-error: true/g)).toHaveLength(2);
  });

  it('never interpolates the untrusted payload into a shell script', () => {
    const scripts = runScripts();
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(script).not.toContain('${{');
    expect(workflow).toContain('PAYLOAD: ${{ toJSON(github.event.client_payload) }}');
  });

  it.skipIf(!actionlint)('passes actionlint', () => {
    expect(() => execFileSync(actionlint!, [workflowPath], { encoding: 'utf8' })).not.toThrow();
  });
});
