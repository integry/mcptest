import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LandingHero } from '../src/components/LandingHero';
import * as landingCopy from '../src/content/landingCopy';
import { getCatalogServers } from '../src/utils/catalogUtils';
import seoGenerator from './generate-seo-pages.js';
import catalogSeeds from '../src/data/serverCatalog.json';

const { renderLandingFallback } = seoGenerator;

const catalogCount = getCatalogServers().length;
const parse = html => new DOMParser().parseFromString(`<!DOCTYPE html><body>${html}</body>`, 'text/html').body;
const text = element => element?.textContent.replace(/\s+/g, ' ').trim();

const component = parse(renderToStaticMarkup(React.createElement(
  MemoryRouter,
  null,
  React.createElement(LandingHero, {
    serverUrl: '',
    onServerUrlChange: () => {},
    onConnect: () => {},
    isConnecting: false,
    quickPicks: [],
    catalogCount,
  })
)));
const fallback = parse(renderLandingFallback(catalogSeeds.length));

const describeLanding = root => ({
  headline: text(root.querySelector('h1')),
  lede: text(root.querySelector('.landing-lede')),
  pathsLabel: root.querySelector('nav').getAttribute('aria-label'),
  paths: Array.from(root.querySelectorAll('nav a'), link => ({
    href: link.getAttribute('href'),
    title: text(link.querySelector('.landing-path-title')),
    description: text(link.querySelector('.landing-path-description')),
  })),
  coverageTitle: text(root.querySelector('.landing-coverage h2')),
  coverage: Array.from(root.querySelectorAll('.landing-coverage li'), text),
  catalog: {
    href: root.querySelector('.landing-catalog a').getAttribute('href'),
    text: text(root.querySelector('.landing-catalog a')),
  },
});

describe('crawler-visible landing fallback', () => {
  it('counts the same catalog servers as the app', () => {
    expect(catalogSeeds.length).toBe(catalogCount);
  });

  it('carries the same text, links and labels as LandingHero', () => {
    expect(describeLanding(fallback)).toEqual(describeLanding(component));
  });

  it('renders every string in the shared landing copy module', () => {
    const strings = Object.values(landingCopy).flatMap(value => (
      typeof value === 'string'
        ? [value]
        : value.flatMap(item => (typeof item === 'string' ? [item] : [item.title, item.description]))
    ));
    const fallbackText = text(fallback);
    const componentText = text(component);
    for (const value of strings) {
      expect(fallbackText.includes(value) || fallback.innerHTML.includes(value), value).toBe(true);
      expect(componentText.includes(value) || component.innerHTML.includes(value), value).toBe(true);
    }
  });

  it('uses semantic elements and only classes the component also renders', () => {
    expect(fallback.querySelector('section > div > h1')).not.toBeNull();
    expect(fallback.querySelector('section > div > p')).not.toBeNull();
    expect(fallback.querySelectorAll('section > nav > ul > li > a')).toHaveLength(landingCopy.LANDING_AUDIENCE_PATHS.length);
    expect(fallback.querySelectorAll('.landing-coverage > ul > li')).toHaveLength(landingCopy.LANDING_REPORT_COVERAGE.length);

    const componentClasses = new Set(Array.from(component.querySelectorAll('[class]'), element => [...element.classList]).flat());
    const fallbackClasses = Array.from(fallback.querySelectorAll('[class]'), element => [...element.classList]).flat();
    expect(fallbackClasses.filter(name => name !== 'seo-landing-fallback' && !componentClasses.has(name))).toEqual([]);
  });
});
