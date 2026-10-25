import type { LearnArticleSummary } from '../content/contentModel';
export const isErrorGuide = (article: LearnArticleSummary) => /(?:401|406|415|405|error|session-not-found|connected-but-no-tools)/.test(article.slug);
export const showInlineTest = (article: LearnArticleSummary) => article.track === 'build' || article.track === 'reference' || article.category === 'Troubleshooting' || isErrorGuide(article);
