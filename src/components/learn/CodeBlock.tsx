/**
 * A fenced code block with a copy button, as guides render them
 * (ArticleMarkdown) and as /mcp-test-servers renders its snippets. The
 * markup (`div.reading-code`, `button.reading-code-copy`, `pre`) is what
 * src/utils/codeCopy.ts makes work on the prerendered page before React mounts.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { getHighlighter, loadHighlighter } from './highlighter';

const childText = (children: React.ReactNode): string =>
  React.Children.toArray(children)
    .map(child => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      if (React.isValidElement<{ children?: React.ReactNode }>(child)) return childText(child.props.children);
      return '';
    })
    .join('');

const CodeBlock: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const [copied, setCopied] = useState(false);
  const codeElement = React.Children.toArray(children).find(React.isValidElement) as
    | React.ReactElement<{ className?: string; children?: React.ReactNode }>
    | undefined;
  const className = codeElement?.props.className ?? '';
  const language = className.match(/language-([\w-]+)/)?.[1];
  const code = childText(codeElement?.props.children).replace(/\n$/, '');
  // highlight.js arrives in its own chunk the first time a fenced block with a
  // language mounts; until then the block renders as plain code.
  const [highlighter, setHighlighter] = useState(getHighlighter);
  useEffect(() => {
    if (highlighter || !language) return undefined;
    let active = true;
    loadHighlighter()
      .then(loaded => {
        if (active) setHighlighter(() => loaded);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [highlighter, language]);
  const highlighted = useMemo(
    () => (language && highlighter?.getLanguage(language) ? highlighter.highlight(code, { language }).value : null),
    [code, language, highlighter]
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="reading-code">
      <button
        type="button"
        className="reading-code-copy"
        onClick={copy}
        aria-label={copied ? 'Code copied' : 'Copy code'}
        title={copied ? 'Copied' : 'Copy code'}
      >
        <i className={`bi ${copied ? 'bi-check-lg' : 'bi-copy'}`} aria-hidden="true"></i>
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      <pre tabIndex={0}>
        {highlighted !== null ? (
          <code className={`hljs language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <code className={className}>{code}</code>
        )}
      </pre>
    </div>
  );
};

export default CodeBlock;
