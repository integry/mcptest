import { createHash } from 'node:crypto';
import {
  applySiteAssistantCsp,
  SITE_ASSISTANT_BOOT_HASH,
  SITE_ASSISTANT_CANCEL_DOCK_EVENT,
  SITE_ASSISTANT_EXCLUDED_PATH,
  SITE_ASSISTANT_META_NAME,
  transformCspMeta,
  type SiteAssistantConfig,
} from './config.mts';

// @solvchat/widget@0.1.13, dist/boot.js
const VENDORED_BOOT_HASH = '8QbwUUUHZbjoxVNSN60wRYrrruEqb6IWfzqkX38JqcQ=';

export const siteAssistantHtmlTransform = (boot: Buffer) => {
  if (createHash('sha256').update(boot).digest('base64') !== VENDORED_BOOT_HASH) {
    throw new Error('The vendored solv.chat boot script does not match its upstream hash.');
  }
  // The wrapper keeps the vendor body intact and has its own CSP hash.
  // On a client-side route change, run the vendor's timeout cleanup immediately.
  // That cleanup only acts if the placeholder still owns the layout reservation.
  const script = `if (!${SITE_ASSISTANT_EXCLUDED_PATH}.test(location.pathname)) {
  const setTimeout = (cleanup, delay) => {
    const cancel = () => {
      window.clearTimeout(timer);
      document.removeEventListener('${SITE_ASSISTANT_CANCEL_DOCK_EVENT}', cancel);
      cleanup();
    };
    const timer = window.setTimeout(cancel, delay);
    document.addEventListener('${SITE_ASSISTANT_CANCEL_DOCK_EVENT}', cancel);
  };
${boot.toString('utf8')}
}`;
  const hash = createHash('sha256').update(script).digest('base64');
  if (hash !== SITE_ASSISTANT_BOOT_HASH) {
    throw new Error(`The site assistant boot script does not match its CSP hash. Expected ${hash}.`);
  }

  return (html: string, config: SiteAssistantConfig | null): string => {
    if (!config) return html;
    const meta = `<meta name="${SITE_ASSISTANT_META_NAME}" data-endpoint="${config.endpoint}" data-assistant="${config.assistantKey}" />`;
    const withConfig = transformCspMeta(html, policy => applySiteAssistantCsp(policy, config), meta);
    return withConfig.replace('</head>', () => `  <script data-key="${config.assistantKey}">${script}</script>\n  </head>`);
  };
};
