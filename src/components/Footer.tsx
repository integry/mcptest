import React from 'react';
import { FOOTER_COLUMNS } from '../content/siteLinks';
import { LEGAL_NAVIGATION, getFooterLinkColumns } from '../content/navigationLinks';
import { APP_ROUTE_OPTIONS } from '../servicePage/buildFlag';
import './SiteContentNavigation.css';

const Footer: React.FC = () => (
  <footer className="site-footer" aria-label="Site resources">
    <div className="site-link-columns">
      {FOOTER_COLUMNS.map(column => (
        <section key={column.title}>
          <h2>{column.title}</h2>
          <ul>{column.links.map(([title, href]) => <li key={href}><a href={href}>{title}</a></li>)}</ul>
        </section>
      ))}
      {getFooterLinkColumns(APP_ROUTE_OPTIONS).map(column => (
        <section key={column.title}>
          <h2>{column.title}</h2>
          <ul>{column.links.map(link => <li key={link.href}><a href={link.href}>{link.label}</a></li>)}</ul>
        </section>
      ))}
    </div>
    <div className="site-footer-meta">
      <nav aria-label="Project and legal links">
        {LEGAL_NAVIGATION.map(link => <a key={link.href} href={link.href}>{link.label}</a>)}
      </nav>
      <small>© {new Date().getFullYear()} Unchained Development OÜ</small>
    </div>
  </footer>
);
export default Footer;
