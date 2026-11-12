import React from 'react';
import type { LearnArticleSummary } from '../../content/contentModel';
import { getCatalogServers } from '../../utils/catalogUtils';
import { getServerUrl } from '../../utils/urlUtils';
import { getPreferredCatalogEndpoint } from '../../utils/clientSetup';

export const selectGuideServers = (article: LearnArticleSummary) => {
  if (article.track !== 'use') return [];
  const text = `${article.slug} ${article.title} ${article.summary}`;
  const terms = /(?:own.data|database|documents|knowledge)/i.test(text) ? /database|search|knowledge/i
    : /(?:coding|developer|code)/i.test(text) ? /developer|coding/i
    : /(?:search|web)/i.test(text) ? /search/i : null;
  if (!terms) return [];
  return getCatalogServers().filter(server => terms.test(`${server.category} ${server.tags.join(' ')}`)).sort((a,b) => Number(b.status === 'online') - Number(a.status === 'online')).slice(0, 3);
};
export default function GuideServers({ article }: { article: LearnArticleSummary }) {
  const servers = selectGuideServers(article);
  if (!servers.length) return null;
  return <section className="reading-related" aria-label="Servers to try"><h2>Servers to try</h2><ul>{servers.map(server => {
    const endpoint = getPreferredCatalogEndpoint(server);
    return <li key={server.id}>
    <a href={`/servers/${server.id}/`}>{server.name}</a> — {server.description}{' '}
    <a href={getServerUrl(endpoint.url, endpoint.transport)}>Test it live<span className="visually-hidden">: {server.name}</span></a>
  </li>;
  })}</ul></section>;
}
