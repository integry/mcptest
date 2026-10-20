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

module.exports = { ARTICLES_DIR, loadArticles };
