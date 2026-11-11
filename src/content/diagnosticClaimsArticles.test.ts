// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (slug: string) => readFileSync(resolve(`src/content/articles/${slug}.md`), 'utf8');

function sentences(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z`])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

describe('annotations article: Claude Code retry eligibility', () => {
  const article = read('mcp-tool-annotations-and-client-retries');
  const section = article.split('## How clients use them')[1]?.split('\n## ')[0] ?? '';

  it('does not say that omitting readOnlyHint alone prevents a Claude Code retry', () => {
    const summary = section.split('\n').find((line) => line.startsWith('So a read-only tool that omits'));
    expect(summary, 'summary paragraph after the client table').toBeDefined();
    const retryClaims = sentences(summary ?? '').filter((sentence) => /retr/i.test(sentence));
    expect(retryClaims.length).toBeGreaterThan(0);
    for (const claim of retryClaims) {
      expect(claim).toContain('idempotentHint');
    }
  });

  it('ties confirmation and parallelism effects to named clients', () => {
    const summary = section.split('\n').find((line) => line.startsWith('So a read-only tool that omits')) ?? '';
    for (const claim of sentences(summary).filter((sentence) => /confirm|prompt|parallel/i.test(sentence))) {
      expect(claim).toMatch(/Claude|Codex|VS Code|those same clients/);
    }
  });
});

describe('bot protection article: response provenance', () => {
  const article = read('mcp-bot-protection-blocking-clients');
  const generic = /`403`|`202`|`405`|`text\/html`|HTML body/;
  const attribution = /\b(is|comes from|means) the edge\b|\bthe edge (still )?answered\b|\bfrom the edge\b/i;
  const providerEvidence = /cf-mitigated|x-amzn-waf-action/;

  it('never attributes a response to the edge from generic statuses or HTML alone', () => {
    const offending = sentences(article).filter(
      (sentence) => generic.test(sentence) && attribution.test(sentence) && !/only if|only when|not necessarily/i.test(sentence),
    );
    expect(offending).toEqual([]);
  });

  it.each([
    ['Recognising a blocked request', '## Recognising a blocked request'],
    ['Confirming the fix', 'The metadata request should return'],
    ['final FAQ', '### My OAuth metadata URL returns 403'],
  ])('%s requires provider challenge evidence or correlated logs', (_label, marker) => {
    const start = article.indexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = article.slice(start + marker.length);
    const end = rest.search(/\n## |\n### |\nThen run the/);
    const passage = end === -1 ? rest : rest.slice(0, end);
    expect(passage).toMatch(providerEvidence);
    expect(passage).toMatch(/log/i);
  });
});
