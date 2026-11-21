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
const { findFigures, validateFigureSvg, validateFigureUsage } = require('../../src/content/figures.ts');

const ARTICLES_DIR = path.join(__dirname, '..', '..', 'src', 'content', 'articles');
const FIGURES_DIR = path.join(__dirname, '..', '..', 'src', 'content', 'figures');

/**
 * Fails the build on a figure that is placed wrongly, missing, breaks the SVG
 * contract (docs/article-figures.md), or sits in the figures directory unused.
 *
 * @param {import('../../src/content/contentModel').LearnArticle[]} articles
 * @param {string} [figuresDirectory]
 */
function validateArticleFigures(articles, figuresDirectory = FIGURES_DIR) {
  const errors = [];
  const used = new Set();
  for (const article of articles) {
    for (const error of validateFigureUsage(article.content, article.slug)) {
      errors.push(`${article.slug}: ${error}`);
    }
    for (const figure of findFigures(article.content)) {
      const relative = path.join(figure.slug, `${figure.name}.svg`);
      used.add(relative);
      const file = path.join(figuresDirectory, relative);
      if (!fs.existsSync(file)) {
        errors.push(`${article.slug}: figure file ${relative} does not exist`);
        continue;
      }
      for (const error of validateFigureSvg(fs.readFileSync(file, 'utf8'))) {
        errors.push(`${relative}: ${error}`);
      }
    }
  }
  if (fs.existsSync(figuresDirectory)) {
    for (const slug of fs.readdirSync(figuresDirectory).sort()) {
      for (const file of fs.readdirSync(path.join(figuresDirectory, slug)).sort()) {
        const relative = path.join(slug, file);
        if (!used.has(relative)) errors.push(`${relative}: no article places this figure`);
      }
    }
  }
  if (errors.length) throw new Error(`Invalid article figures:\n${errors.join('\n')}`);
}

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
  // A custom article directory (tests) carries no figures of its own.
  if (!options.directory || options.figuresDirectory) validateArticleFigures(articles, options.figuresDirectory);
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

module.exports = { ARTICLES_DIR, FIGURES_DIR, hasCodeBlock, loadArticleIndex, loadArticles, toArticleIndexEntry, validateArticleFigures };
