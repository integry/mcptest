// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  forbiddenInitialModules,
  lazyChunks,
  modulesByChunk,
  staticClosure,
} from './bundle/route-graph.mjs';

const distDir = path.join(__dirname, '..', 'dist');
const manifestPath = path.join(distDir, '.vite', 'manifest.json');
const statsPath = path.join(distDir, '.vite', 'bundle-stats.json');
const articlesDir = path.join(__dirname, '..', 'src', 'content', 'articles');

/**
 * Modules that belong to the inspector, not to a guide, catalog or server
 * page. The content routes render from the initial graph alone, so none of
 * these may be reachable from the entry through static imports (issue #401).
 */
const INSPECTOR_ONLY = [
  /\/node_modules\/@modelcontextprotocol\//,
  /\/node_modules\/zod\//,
  /\/node_modules\/@firebase\/|\/node_modules\/firebase\//,
  /\/node_modules\/highlight\.js\//,
  /\/node_modules\/react-markdown\/|\/node_modules\/remark-|\/node_modules\/micromark/,
  /\/node_modules\/bootstrap\/dist\/js\//,
  /\/node_modules\/ajv\/|\/node_modules\/@cfworker\//,
  /\/src\/utils\/evaluation\.ts$/,
  /\/src\/utils\/oauthFlow\.ts$/,
  /\/src\/utils\/transportDetection\.ts$/,
  /\/src\/utils\/deterministicTests\.ts$/,
  /\/src\/utils\/reportArtifact\.ts$/,
  /\/src\/components\/TabContent\.tsx$/,
  /\/src\/components\/UnifiedPanel\.tsx$/,
  /\/src\/components\/ReportView\.tsx$/,
  /\/src\/components\/DashboardsView\.tsx$/,
  /\/src\/components\/OAuthConfig\.tsx$/,
  /\/src\/firebaseRuntime\.ts$/,
];

/** Views that must be their own chunks, loaded on demand. */
const LAZY_VIEWS = [
  'src/components/TabContent.tsx',
  'src/components/DashboardsView.tsx',
  'src/components/ReportView.tsx',
  'src/components/SubmitServerView.tsx',
  'src/components/learn/LearnArticlePage.tsx',
  'src/components/OAuthCallback.tsx',
  'src/components/OAuthConfig.tsx',
  'src/firebaseRuntime.ts',
  'src/utils/savedCardRuntime.ts',
];

const fixtureManifest = {
  'index.html': { file: 'assets/index.js', isEntry: true, imports: ['_react.js', '_shared.js'], dynamicImports: ['src/lazy.ts'] },
  '_react.js': { file: 'assets/react.js' },
  '_shared.js': { file: 'assets/shared.js', imports: ['_react.js'] },
  'src/lazy.ts': { file: 'assets/lazy.js', imports: ['_shared.js', '_sdk.js'], isDynamicEntry: true },
  '_sdk.js': { file: 'assets/sdk.js' },
};

const fixtureStats = {
  nodeParts: {
    a: { metaUid: 'ma', renderedLength: 10 },
    b: { metaUid: 'mb', renderedLength: 20 },
    c: { metaUid: 'mc', renderedLength: 30 },
  },
  nodeMetas: {
    ma: { id: '/src/main.tsx' },
    mb: { id: '/node_modules/react/index.js' },
    mc: { id: '/node_modules/zod/index.js' },
  },
  tree: {
    children: [
      { name: 'assets/index.js', children: [{ name: 'main.tsx', uid: 'a' }] },
      { name: 'assets/react.js', children: [{ name: 'react', children: [{ name: 'index.js', uid: 'b' }] }] },
      { name: 'assets/sdk.js', children: [{ name: 'zod', children: [{ name: 'index.js', uid: 'c' }] }] },
    ],
  },
};

describe('route graph helpers', () => {
  it('follows static imports from the entry and stops at dynamic imports', () => {
    expect(staticClosure(fixtureManifest)).toEqual(['assets/index.js', 'assets/react.js', 'assets/shared.js']);
    expect(lazyChunks(fixtureManifest)).toEqual(['assets/lazy.js', 'assets/sdk.js']);
  });

  it('reports modules of the initial graph that match a forbidden pattern', () => {
    expect(modulesByChunk(fixtureStats).get('assets/sdk.js')).toEqual([{ id: '/node_modules/zod/index.js', bytes: 30 }]);
    expect(forbiddenInitialModules(fixtureManifest, fixtureStats, [/zod/, /react/])).toEqual([
      { chunk: 'assets/react.js', module: '/node_modules/react/index.js', pattern: '/react/' },
    ]);
  });
});

/**
 * Asserts on the real build. Needs `npm run build` first, so it runs from
 * `npm run test:bundle-graph` (CI, after the build) rather than with the unit tests.
 */
describe.skipIf(!process.env.BUNDLE_GRAPH)('chunk graph of the built site', () => {
  const manifest = () => JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const stats = () => JSON.parse(fs.readFileSync(statsPath, 'utf8'));

  it('keeps the inspector, Firebase, the Markdown renderer and highlight.js out of the initial graph', () => {
    expect(fs.existsSync(manifestPath), 'dist/.vite/manifest.json; run npm run build').toBe(true);
    expect(fs.existsSync(statsPath), 'dist/.vite/bundle-stats.json; run npm run build').toBe(true);
    const offenders = forbiddenInitialModules(manifest(), stats(), INSPECTOR_ONLY);
    expect(offenders, offenders.map(item => `${item.module} (in ${item.chunk})`).join('\n')).toEqual([]);
  });

  it('loads every view behind a route boundary on demand', () => {
    const graph = manifest();
    const entry = graph['index.html'];
    for (const view of LAZY_VIEWS) {
      expect(graph[view], `${view} is a chunk`).toBeDefined();
      expect(graph[view].isDynamicEntry, `${view} is a dynamic entry`).toBe(true);
    }
    expect(entry.dynamicImports).toEqual(expect.arrayContaining(LAZY_VIEWS));
    const initial = new Set(staticClosure(graph));
    for (const view of LAZY_VIEWS) expect(initial.has(graph[view].file), `${view} is not in the initial graph`).toBe(false);
  });

  it('loads every guide body on demand, never with the initial graph', () => {
    const graph = manifest();
    const guides = fs.readdirSync(articlesDir).filter(file => file.endsWith('.md'));
    const initial = new Set(staticClosure(graph));
    for (const file of guides) {
      const chunk = graph[`src/content/articles/${file}?raw`];
      expect(chunk, `${file} is a chunk`).toBeDefined();
      expect(chunk.isDynamicEntry, `${file} is a dynamic entry`).toBe(true);
      expect(initial.has(chunk.file), `${file} is not in the initial graph`).toBe(false);
    }
    const offenders = forbiddenInitialModules(graph, stats(), [/\/src\/content\/articles\//]);
    expect(offenders, offenders.map(item => `${item.module} (in ${item.chunk})`).join('\n')).toEqual([]);
  });

  it('keeps the initial JavaScript under budget', () => {
    const graph = manifest();
    const bytes = staticClosure(graph).reduce((sum, file) => sum + fs.statSync(path.join(distDir, file)).size, 0);
    console.log(`Initial JavaScript: ${bytes} bytes`);
    // Minified, before compression: 2.9 MB before issue #401, 1,682,854 bytes
    // before guide bodies left the initial bundle (issue #424) and 1,346,890
    // after. Ratchet down, never up.
    expect(bytes).toBeLessThan(1_510_000);
  });
});
