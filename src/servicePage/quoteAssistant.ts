import type { SiteAssistantConfig } from '../siteAssistant/config.mts';
import { createWidgetElement, getSolvActions, loadWidgetScript, openWidgetPanel, type SolvPageAction } from '../siteAssistant/widgetScript';
import { isQuoteUrl } from './config.mts';

/*
 * The service page's quote assistant (issue #638): a second solv.chat
 * assistant, loaded with the site assistant's loader only when the visitor
 * presses "Get a quote" on /mcp-server-development, with one page action:
 * `open_quote({ url })`. The site assistant never shows on this page
 * (src/siteAssistant/config.mts excludes it), and leaving the page removes
 * the widget and the action so no other assistant can call it.
 */

export const OPEN_QUOTE_ACTION = 'open_quote';
export const QUOTE_REFUSED = 'That destination is not allowed. Only quote pages on the mcptest service site can be opened.';

/**
 * `open_quote`: navigates to a quote page, `${serviceApi}/q/<id>`, after the
 * visitor confirms in the widget (`confirm: true`). Any other URL, origin or
 * scheme is refused without navigating.
 */
export const createOpenQuoteAction = (
  serviceApi: string | null,
  navigate: (url: string) => void = url => window.location.assign(url),
): SolvPageAction => ({
  name: OPEN_QUOTE_ACTION,
  description: 'Open the visitor\'s quote page on the mcptest service site to review and pay for the quote. Only quote URLs returned by the service are accepted.',
  input: {
    type: 'object',
    properties: {
      url: { type: 'string', description: serviceApi ? `The quote page URL: ${serviceApi}/q/<id>` : 'The quote page URL' },
    },
    required: ['url'],
  },
  confirm: true,
  run: ({ url }) => {
    if (!isQuoteUrl(url, serviceApi)) return { opened: false, error: QUOTE_REFUSED };
    navigate(url);
    return { opened: true, url };
  },
});

export interface QuoteAssistant {
  /** Opens the panel (loading the widget on first use); false when the widget could not load. */
  open(): Promise<boolean>;
  /** Removes the widget and the page action. */
  destroy(): void;
}

export const createQuoteAssistant = (
  config: SiteAssistantConfig,
  serviceApi: string | null,
  options: { navigate?: (url: string) => void } = {},
): QuoteAssistant => {
  let widget: HTMLElement | null = null;
  let destroyed = false;
  let loading: Promise<boolean> | null = null;

  const load = (): Promise<boolean> => {
    if (loading) return loading;
    loading = loadWidgetScript(config).then(() => {
      if (destroyed) return false;
      const actions = getSolvActions();
      // Without the page action API there is no safe way to offer open_quote;
      // the chat itself still works.
      actions?.register(createOpenQuoteAction(serviceApi, options.navigate));
      widget = createWidgetElement(config);
      widget.dataset.quoteAssistant = '';
      document.body.append(widget);
      return true;
    }, error => {
      console.warn('[Quote assistant] The widget did not load.', error);
      loading = null;
      return false;
    });
    return loading;
  };

  return {
    async open() {
      const loaded = await load();
      if (!loaded || !widget?.isConnected) return false;
      openWidgetPanel(widget);
      return true;
    },
    destroy() {
      destroyed = true;
      getSolvActions()?.unregister(OPEN_QUOTE_ACTION);
      widget?.remove();
      widget = null;
    },
  };
};
