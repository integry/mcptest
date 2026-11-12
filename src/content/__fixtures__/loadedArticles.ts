/**
 * Every registry article with its body, loaded through the same on-demand
 * path the guide page uses, for tests that read article bodies.
 */
import { LEARN_ARTICLES, loadLearnArticleBody } from '../learnRegistry';

export const loadAllLearnArticles = () =>
  Promise.all(LEARN_ARTICLES.map(async article => ({ ...article, content: await loadLearnArticleBody(article) })));
