import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractHeadings } from './outline';

const article = readFileSync(resolve('src/content/articles/mcp-session-not-found-after-deploy.md'), 'utf8')
  .replace(/^---[\s\S]*?\n---\n/, '');
const section = (start: string, end: string) => article.slice(article.indexOf(start), article.indexOf(end));

describe('Session not found article', () => {
  it('keeps every heading anchor the page has published', () => {
    const ids = extractHeadings(article).map(heading => heading.id);
    expect(ids).toEqual(expect.arrayContaining([
      'error-failed-to-get-tools-connection-closed-calling-toolslist-client-is-closing-sending-subscriptionslisten-failed-to-connect-session-id-session-not-found',
      'why-a-deploy-loses-the-session',
      'why-multiple-replicas-make-failures-intermittent',
      'choose-where-the-state-lives',
      'what-clients-do-today',
      'test-the-wire-behavior-before-release',
    ]));
  });

  it('keeps the replica explanation under its anchor', () => {
    expect(section('### Why multiple replicas make failures intermittent', '## How to confirm the cause'))
      .toMatch(/replica B[\s\S]*alternate between success and 404/);
  });

  it('classifies a server as stateless only after initialization and a sessionless ping succeed', () => {
    const confirm = section('## How to confirm the cause', '## Fix for client users');
    const blocks = [...confirm.matchAll(/```bash\n([\s\S]*?)```/g)].map(match => match[1]);
    const initialize = blocks.find(block => block.includes('"method":"initialize"'));

    // The initialize probe keeps the status and body instead of filtering them away, and shows where credentials go.
    expect(initialize).toBeDefined();
    expect(initialize).not.toMatch(/\|\s*grep/);
    expect(initialize).toContain('-i ');
    expect(initialize).toContain('Authorization: Bearer');

    // A failed initialize is not evidence of statelessness.
    expect(confirm).toMatch(/Not 200, or a body with `"error"`[\s\S]*does not mean the server is stateless/);
    expect(confirm).toMatch(/401 or 403, add or fix the credentials/);

    // The stateless verdict follows a successful sessionless ping, not a missing header.
    const sessionless = blocks.find(block => block.includes('"method":"ping"') && !block.includes('Mcp-Session-Id'));
    expect(sessionless).toBeDefined();
    const verdict = confirm.indexOf('means the server is stateless');
    expect(verdict).toBeGreaterThan(confirm.indexOf(sessionless!));
    expect(confirm.slice(0, verdict)).toMatch(/A 200 with `"result":\{\}` $/);
    expect(confirm).not.toMatch(/No `Mcp-Session-Id` header means the server is stateless/);
  });
});
