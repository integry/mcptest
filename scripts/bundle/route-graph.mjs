/**
 * Chunk graph helpers over Vite's build manifest (dist/.vite/manifest.json)
 * and rollup-plugin-visualizer's raw data (dist/.vite/bundle-stats.json).
 *
 * The "initial graph" of a route is the entry chunk plus everything it imports
 * statically: the JavaScript every page downloads before any dynamic import.
 * The content routes (guides, catalog, server profiles) render from that graph
 * alone, so it must not contain the inspector's dependencies.
 */

/** Chunk files reachable from `entryKey` through static imports only. */
export function staticClosure(manifest, entryKey = 'index.html') {
  const entry = manifest[entryKey];
  if (!entry) throw new Error(`${entryKey} is not in the manifest.`);
  const byFile = new Map(Object.values(manifest).map(chunk => [chunk.file, chunk]));
  const byKey = manifest;
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const chunk = queue.shift();
    if (seen.has(chunk.file)) continue;
    seen.add(chunk.file);
    for (const key of chunk.imports || []) {
      const next = byKey[key] || byFile.get(key);
      if (next) queue.push(next);
    }
  }
  return [...seen];
}

/** Chunk files only reachable through a dynamic import somewhere in the graph. */
export function lazyChunks(manifest, entryKey = 'index.html') {
  const initial = new Set(staticClosure(manifest, entryKey));
  return Object.values(manifest).map(chunk => chunk.file).filter(file => file.endsWith('.js') && !initial.has(file));
}

/** Module ids (as the visualizer records them) per emitted chunk file. */
export function modulesByChunk(stats) {
  const result = new Map();
  const walk = (node, chunkFile) => {
    if (node.uid) {
      const part = stats.nodeParts[node.uid];
      const meta = part && stats.nodeMetas[part.metaUid];
      if (meta) {
        const list = result.get(chunkFile) || [];
        list.push({ id: meta.id, bytes: part.renderedLength });
        result.set(chunkFile, list);
      }
    }
    for (const child of node.children || []) walk(child, chunkFile);
  };
  for (const chunk of stats.tree.children) walk(chunk, chunk.name);
  return result;
}

/** Modules in the initial graph whose id matches one of `patterns`. */
export function forbiddenInitialModules(manifest, stats, patterns, entryKey = 'index.html') {
  const initial = new Set(staticClosure(manifest, entryKey));
  const modules = modulesByChunk(stats);
  const offenders = [];
  for (const [chunkFile, list] of modules) {
    if (!initial.has(chunkFile)) continue;
    for (const module of list) {
      const pattern = patterns.find(candidate => candidate.test(module.id));
      if (pattern) offenders.push({ chunk: chunkFile, module: module.id, pattern: String(pattern) });
    }
  }
  return offenders;
}

/** Bytes per module directory group in the initial graph, largest first. */
export function initialGraphSummary(manifest, stats, entryKey = 'index.html') {
  const initial = new Set(staticClosure(manifest, entryKey));
  const modules = modulesByChunk(stats);
  const groups = new Map();
  let total = 0;
  for (const [chunkFile, list] of modules) {
    if (!initial.has(chunkFile)) continue;
    for (const module of list) {
      const id = module.id.replace(/^.*\/node_modules\//, 'node_modules/').replace(/^\/.*?\/src\//, 'src/');
      const group = id.startsWith('node_modules/')
        ? id.split('/').slice(0, id.startsWith('node_modules/@') ? 3 : 2).join('/')
        : id.split('/').slice(0, 3).join('/');
      groups.set(group, (groups.get(group) || 0) + module.bytes);
      total += module.bytes;
    }
  }
  return { total, groups: [...groups.entries()].sort((a, b) => b[1] - a[1]) };
}
