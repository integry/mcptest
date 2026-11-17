import React from 'react';
import { HOME_GUIDE_COLUMNS } from '../content/siteLinks';
import './SiteContentNavigation.css';

export default function HomeGuides() {
  return <section className="home-guides" aria-labelledby="home-guides-title">
    <header><h2 id="home-guides-title">Guides &amp; Documentation</h2><a href="/guides">Browse all guides →</a></header>
    <div className="site-link-columns">{HOME_GUIDE_COLUMNS.map(column => <section key={column.title}>
      <h3>{column.title}</h3>
      <ul>{column.links.map(([title, slug, summary]) => <li key={slug}><a href={`/guides/${slug}`}>{title}</a><p>{summary}</p></li>)}</ul>
    </section>)}</div>
  </section>;
}
