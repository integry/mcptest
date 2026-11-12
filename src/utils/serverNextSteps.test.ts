import { describe, expect, it } from 'vitest';
import { getCatalogServers } from './catalogUtils';
import { selectSimilarServers, selectServerGuides, renderServerNextSteps, serverActionPaths } from './serverNextSteps';
import { parseServerUrl } from './urlUtils';
const catalog = getCatalogServers();
describe('server landing next steps', () => {
  it('excludes self and sorts validated online first without changing catalog order within a status', () => {
    const server = catalog[0];
    const items = [
      { ...server, id: 'a', status: 'unknown' as const },
      { ...server, id: 'b', status: 'online' as const, checkedAt: '2026-10-01' },
      { ...server, id: 'c', status: 'online' as const, checkedAt: '2026-10-01' },
      { ...server, id: 'd', category: 'Other', authType: server.authType },
    ];
    expect(selectSimilarServers(server, [server, ...items]).map(s => s.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(items.map(s => s.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('selects two to four distinct fact-based guides and valid canonical paths for every catalog server', () => {
    for (const server of catalog) {
      const guides = selectServerGuides(server);
      expect(guides.length).toBeGreaterThanOrEqual(2);
      expect(guides.length).toBeLessThanOrEqual(4);
      expect(new Set(guides.map(g => g.path)).size).toBe(guides.length);
      const path = new URL(serverActionPaths(server).test, 'https://mcptest.io');
      expect(parseServerUrl(path.pathname, path.search, path.hash)).not.toBeNull();
      expect(renderServerNextSteps(server, catalog)).not.toContain('<script');
    }
  });
  it('prioritizes OAuth and legacy SSE evidence', () => {
    const guides = selectServerGuides({ ...catalog[0], authType: 'oauth', transport: 'legacy-sse' });
    expect(guides.map(g => g.path)).toContain('/learn/oauth-for-mcp-explained');
    expect(guides.map(g => g.path)).toContain('/learn/mcp-transport-diagnostics-reference');
  });
});
