import React from 'react';
import { createDeferredComponent } from '../utils/deferredComponent';
import { getCatalogServerIdFromPath } from '../utils/catalogSeo';
import { getContentPage, getLearnArticleFromPath } from '../content/learnRegistry';
import { parseResultShareUrl, parseServerUrl } from '../utils/urlUtils';
import { getPrerenderedArticle } from '../content/prerenderedArticle';
import { markdownLearnArticle } from '../components/learn/deferredMarkdownArticle';

/*
 * Route-level code splitting. Each view below is its own chunk (plus the
 * vendor chunks only it needs: the MCP SDK and zod, Firebase, the Markdown
 * renderer, highlight.js, Bootstrap's JS). The shell, catalog and server
 * profile stay in the entry chunk because the prerendered pages mount them
 * directly from their static HTML.
 */

const playground = createDeferredComponent(() => import('../components/TabContent'));
const dashboards = createDeferredComponent(() => import('../components/DashboardsView'));
const report = createDeferredComponent(() => import('../components/ReportView'));
const submit = createDeferredComponent(() => import('../components/SubmitServerView'));
const article = createDeferredComponent(() => import('../components/learn/LearnArticlePage'));
const oauthCallback = createDeferredComponent(() => import('../components/OAuthCallback'));
const oauthConfig = createDeferredComponent(() => import('../components/OAuthConfig'));
/** highlight.js with the languages the guides use; only fetched for pages with code blocks. */
const highlighter = () => import('../components/learn/highlighter').then(module => module.loadHighlighter());

export const TabContent = playground.Component;
export const DashboardsView = dashboards.Component;
export const ReportView = report.Component;
export const SubmitServerView = submit.Component;
export const LearnArticlePage = article.Component;
export const OAuthCallback = oauthCallback.Component;
export const OAuthConfig = oauthConfig.Component;

/** Shown while a view chunk is still arriving after client-side navigation. */
export const ViewFallback: React.FC<{ label?: string }> = ({ label = 'Loading' }) => (
  <div className="view-loading" role="status" aria-live="polite">
    <span className="spinner-border spinner-border-sm" aria-hidden="true"></span>
    <span className="ms-2">{label}…</span>
  </div>
);

export type RouteView =
  | 'playground'
  | 'dashboards'
  | 'report'
  | 'submit'
  | 'article'
  | 'oauth-callback'
  | 'catalog'
  | 'server-profile'
  | 'learn-index'
  | 'page';

/** The view a path renders first, mirroring App's activeView derivation. */
export const getRouteView = (pathname: string, search = ''): RouteView => {
  if (pathname === '/oauth/callback') return 'oauth-callback';
  if (pathname === '/submit') return 'submit';
  if (pathname.startsWith('/report')) return 'report';
  if (pathname.startsWith('/space/')) return 'dashboards';
  if (getCatalogServerIdFromPath(pathname)) return 'server-profile';
  if (pathname.startsWith('/catalog')) return 'catalog';
  if (pathname === '/learn' || pathname === '/learn/') return 'learn-index';
  const content = getContentPage(pathname);
  if (content?.kind === 'article') return 'article';
  if (content?.kind === 'page') return 'page';
  if (pathname.startsWith('/learn/') || pathname.startsWith('/docs/')) return 'learn-index';
  if (parseServerUrl(pathname) || parseResultShareUrl(pathname, search)) return 'playground';
  return 'playground';
};

const hasCodeBlock = (markdown: string): boolean => /^(`{3,}|~{3,})/m.test(markdown);

/**
 * The chunks the first render of `pathname` needs. main.tsx awaits them before
 * mounting so the mount never shows a Suspense fallback over the static HTML.
 */
export const preloadViewsForPath = (pathname: string, search = ''): Promise<void> => {
  const loads: Promise<unknown>[] = [];
  switch (getRouteView(pathname, search)) {
    case 'playground':
      loads.push(playground.preload());
      break;
    case 'dashboards':
      loads.push(dashboards.preload());
      break;
    case 'report':
      loads.push(report.preload());
      break;
    case 'submit':
      loads.push(submit.preload());
      break;
    case 'oauth-callback':
      loads.push(oauthCallback.preload());
      break;
    case 'article': {
      loads.push(article.preload());
      const current = getLearnArticleFromPath(pathname);
      // A prerendered guide keeps its static body (LearnArticlePage), so it needs
      // neither the Markdown renderer nor highlight.js; embedded components still render.
      if (current && (current.component || getPrerenderedArticle(current.slug) === null)) {
        loads.push(markdownLearnArticle.preload());
        if (hasCodeBlock(current.content)) loads.push(highlighter());
      }
      break;
    }
    default:
      break;
  }
  return Promise.all(loads).then(() => undefined);
};
