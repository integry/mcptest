import type { ComponentType } from 'react';
import Contact from '../components/docs/Contact';
import DashboardDemo from '../components/docs/DashboardDemo';
import PrivacyPolicy from '../components/docs/PrivacyPolicy';
import TermsOfService from '../components/docs/TermsOfService';
import type { ContentComponentName } from './contentModel';
import type { ComponentPage } from './learnRegistry';

/** Components an article may embed via the `component:` frontmatter field. */
export const CONTENT_COMPONENTS: Record<ContentComponentName, ComponentType> = {
  DashboardDemo,
};

/** Components backing the React-only pages registered in `COMPONENT_PAGES`. */
export const PAGE_COMPONENTS: Record<ComponentPage['component'], ComponentType> = {
  PrivacyPolicy,
  TermsOfService,
  Contact,
};

export const getContentComponent = (name: string | undefined): ComponentType | undefined =>
  name && Object.prototype.hasOwnProperty.call(CONTENT_COMPONENTS, name)
    ? CONTENT_COMPONENTS[name as ContentComponentName]
    : undefined;
