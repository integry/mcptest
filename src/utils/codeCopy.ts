/**
 * Copy buttons on prerendered code blocks: `div.reading-code` holding a
 * `button.reading-code-copy` and the `pre`, as CodeBlock in
 * components/learn/ArticleMarkdown.tsx renders them. Used by the static guide
 * page before React mounts and by LearnArticlePage when it keeps the
 * prerendered article body, so both behave like CodeBlock.
 */

const COPIED_RESET_MS = 2000;

const setCopied = (button: Element, copied: boolean): void => {
  button.setAttribute('aria-label', copied ? 'Code copied' : 'Copy code');
  button.setAttribute('title', copied ? 'Copied' : 'Copy code');
  const icon = button.querySelector('i');
  if (icon) icon.className = `bi ${copied ? 'bi-check-lg' : 'bi-copy'}`;
  const label = button.querySelector('span');
  if (label) label.textContent = copied ? 'Copied' : 'Copy';
};

/** Handles a click inside prerendered prose; true when it was a copy button. */
export const handleCodeCopyClick = (event: { target: EventTarget | null }): boolean => {
  const target = event.target as Element | null;
  const button = typeof target?.closest === 'function' ? target.closest('.reading-code-copy') : null;
  if (!button) return false;
  const code = (button.closest('.reading-code')?.querySelector('pre')?.textContent ?? '').replace(/\n$/, '');
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (!clipboard) return true;
  clipboard.writeText(code).then(
    () => {
      setCopied(button, true);
      window.setTimeout(() => setCopied(button, false), COPIED_RESET_MS);
    },
    () => setCopied(button, false),
  );
  return true;
};

/** Shows a copy button's result, then restores its own label (`data-copy-label`). */
const setCopyFromState = (button: HTMLElement, copied: boolean): void => {
  const label = button.dataset.copyLabel ?? 'Copy';
  const labelElement = button.querySelector('span');
  if (labelElement) labelElement.textContent = copied ? 'Copied' : label;
  const icon = button.querySelector('i');
  if (icon) icon.className = `bi ${copied ? 'bi-check-lg' : 'bi-copy'}`;
};

/**
 * Copy buttons that name the element holding their text:
 * `button[data-copy-from="<id>"]`, as the server page's setup snippets and
 * agent prompt render them (ServerConnect.tsx, scripts/content/catalogPages.js).
 * True when the click was such a button.
 */
export const handleCopyFromClick = (event: { target: EventTarget | null }): boolean => {
  const target = event.target as Element | null;
  const button = typeof target?.closest === 'function' ? target.closest<HTMLElement>('button[data-copy-from]') : null;
  if (!button) return false;
  const source = document.getElementById(button.dataset.copyFrom ?? '');
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (!source || !clipboard) return true;
  clipboard.writeText(source.textContent ?? '').then(
    () => {
      setCopyFromState(button, true);
      window.setTimeout(() => setCopyFromState(button, false), COPIED_RESET_MS);
    },
    () => setCopyFromState(button, false),
  );
  return true;
};
