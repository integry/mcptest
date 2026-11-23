import { createHash } from 'node:crypto';
import {
  applySiteAssistantCsp,
  SITE_ASSISTANT_BOOT_HASH,
  SITE_ASSISTANT_META_NAME,
  transformCspMeta,
  type SiteAssistantConfig,
} from './config.mts';

export const siteAssistantHtmlTransform = (boot: Buffer) => {
  if (createHash('sha256').update(boot).digest('base64') !== SITE_ASSISTANT_BOOT_HASH) {
    throw new Error('The solv.chat boot script does not match its CSP hash.');
  }
  const script = boot.toString('utf8');

  return (html: string, config: SiteAssistantConfig | null): string => {
    if (!config) return html;
    const meta = `<meta name="${SITE_ASSISTANT_META_NAME}" data-endpoint="${config.endpoint}" data-assistant="${config.assistantKey}" />`;
    const withConfig = transformCspMeta(html, policy => applySiteAssistantCsp(policy, config), meta);
    return withConfig.replace('</head>', () => `  <script data-key="${config.assistantKey}">${script}</script>\n  </head>`);
  };
};
