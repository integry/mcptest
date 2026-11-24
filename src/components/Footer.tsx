import React from 'react';
import { Link } from 'react-router-dom';
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
          <ul>{column.links.map(([title, href]) => <li key={href}><Link to={href}>{title}</Link></li>)}</ul>
        </section>
      ))}
      {getFooterLinkColumns(APP_ROUTE_OPTIONS).map(column => (
        <section key={column.title}>
          <h2>{column.title}</h2>
          <ul>{column.links.map(link => <li key={link.href}>{link.external ? <a href={link.href}>{link.label}</a> : <Link to={link.href} reloadDocument={link.reloadDocument}>{link.label}</Link>}</li>)}</ul>
        </section>
      ))}
    </div>
    <div className="site-footer-meta">
      <nav aria-label="Project and legal links">
        {LEGAL_NAVIGATION.map(link => <Link key={link.href} to={link.href}>{link.label}</Link>)}
      </nav>
      <small>© {new Date().getFullYear()} Unchained Development OÜ</small>
    </div>
  </footer>
);
export default Footer;
