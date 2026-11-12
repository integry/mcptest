/**
 * Node-side loader for the Markdown articles in src/content/articles.
 * Uses the same frontmatter parser, article factory, and validation rules as
 * the browser registry so the build never disagrees with the app.
 */
const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('../../src/content/frontmatter.ts');
const {
  CONTENT_COMPONENT_NAMES,
  createArticle,
  sortArticlesForReading,
  validateArticles,
} = require('../../src/content/contentModel.ts');
const { extractOutline } = require('../../src/content/outline.ts');

const ARTICLES_DIR = path.join(__dirname, '..', '..', 'src', 'content', 'articles');

/**
 * @param {object} [options]
 * @param {string} [options.directory] Directory containing `*.md` files.
 * @param {string[]} [options.reservedPaths] Paths owned by non-article pages.
 * @returns {import('../../src/content/contentModel').LearnArticle[]}
 */
function loadArticles(options = {}) {
  const directory = options.directory || ARTICLES_DIR;
  const files = fs.readdirSync(directory).filter(file => file.endsWith('.md')).sort();
  const articles = files.map(file => {
    const raw = fs.readFileSync(path.join(directory, file), 'utf8');
    let parsed;
    try {
      parsed = parseFrontmatter(raw);
    } catch (error) {
      throw new Error(`${file}: ${error.message}`);
    }
    return createArticle(parsed.data, parsed.content, file);
  });
  validateArticles(articles, {
    knownComponents: CONTENT_COMPONENT_NAMES,
    reservedPaths: options.reservedPaths || [],
  });
  return sortArticlesForReading(articles);
}

/** True when the body has a fenced code block, so the article needs the highlighter. */
const hasCodeBlock = markdown => /^(`{3,}|~{3,})/m.test(markdown);

/**
 * The eager article index the browser bundle imports: every article without
 * its body, plus the outline and code-block flag precomputed from the body.
 * Bodies are loaded on demand when a guide renders (src/content/learnRegistry.ts).
 *
 * @param {import('../../src/content/contentModel').LearnArticle} article
 * @returns {import('../../src/content/contentModel').LearnArticleEntry}
 */
function toArticleIndexEntry({ content, ...summary }) {
  return { ...summary, outline: extractOutline(content), hasCodeBlock: hasCodeBlock(content) };
}

/**
 * Loads and validates every article, so a bad frontmatter fails the build,
 * and returns the index in reading order.
 *
 * @param {Parameters<typeof loadArticles>[0]} [options]
 */
function loadArticleIndex(options = {}) {
  return loadArticles(options).map(toArticleIndexEntry);
}

module.exports = { ARTICLES_DIR, hasCodeBlock, loadArticleIndex, loadArticles, toArticleIndexEntry };
