import type { ComponentType } from 'react';
import Contact from '../components/docs/Contact';
import PrivacyPolicy from '../components/docs/PrivacyPolicy';
import RemoteVsLocal from '../components/docs/RemoteVsLocal';
import TermsOfService from '../components/docs/TermsOfService';
import TestingGuide from '../components/docs/TestingGuide';
import Troubleshooting from '../components/docs/Troubleshooting';
import WhatIsMcp from '../components/docs/WhatIsMcp';

export interface DocumentationPage {
  slug: string;
  title: string;
  icon: string;
  component: ComponentType;
  showInNavigation: boolean;
}

export const DOCUMENTATION_PAGES: readonly DocumentationPage[] = [
  {
    slug: 'what-is-mcp',
    title: 'What is MCP?',
    icon: 'bi-info-circle',
    component: WhatIsMcp,
    showInNavigation: true,
  },
  {
    slug: 'remote-vs-local',
    title: 'Remote vs Local',
    icon: 'bi-cloud-arrow-up',
    component: RemoteVsLocal,
    showInNavigation: true,
  },
  {
    slug: 'testing-guide',
    title: 'Testing Guide',
    icon: 'bi-check-circle',
    component: TestingGuide,
    showInNavigation: true,
  },
  {
    slug: 'troubleshooting',
    title: 'Troubleshooting',
    icon: 'bi-wrench',
    component: Troubleshooting,
    showInNavigation: true,
  },
  {
    slug: 'privacy-policy',
    title: 'Privacy Policy',
    icon: 'bi-shield-check',
    component: PrivacyPolicy,
    showInNavigation: false,
  },
  {
    slug: 'terms-of-service',
    title: 'Terms of Service',
    icon: 'bi-file-text',
    component: TermsOfService,
    showInNavigation: false,
  },
  {
    slug: 'contact',
    title: 'Contact',
    icon: 'bi-envelope',
    component: Contact,
    showInNavigation: false,
  },
] as const;

export const DOCUMENTATION_NAV_ITEMS = DOCUMENTATION_PAGES.filter(
  ({ showInNavigation }) => showInNavigation
);

export const getDocumentationPage = (slug: string | null | undefined) =>
  slug ? DOCUMENTATION_PAGES.find(page => page.slug === slug) : undefined;
