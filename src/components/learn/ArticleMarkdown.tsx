import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Link } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { splitAtComponentMarker } from '../../content/contentModel';
import { extractSegmentHeadingIds, remarkHeadingIds } from '../../content/outline';
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

const markdownComponents: Components = {
  a: ({ href = '', children, node: _node, ...props }) => {
    if (href.startsWith('/')) {
      return <Link to={href}>{children}</Link>;
    }
    if (href.startsWith('#')) {
      return <a href={href} {...props}>{children}</a>;
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
        <span className="visually-hidden"> (opens in a new tab)</span>
      </a>
    );
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children, node: _node, ...props }) => (
    <div className="reading-table">
      <table {...props}>{children}</table>
    </div>
  ),
};

export interface ArticleMarkdownProps {
  content: string;
  /** Component inserted at the `<!-- component -->` marker, or after the body when no marker exists. */
  embedded?: React.ReactNode;
}

const ArticleMarkdown: React.FC<ArticleMarkdownProps> = ({ content, embedded }) => {
  // Heading ids are precomputed per segment so each Markdown processing run is
  // deterministic: StrictMode re-invoking ReactMarkdown with the same plugins
  // must not allocate `-2` suffixes the outline never links to.
  const { segments, plugins } = useMemo(() => {
    const segments = splitAtComponentMarker(content);
    const headingIds = extractSegmentHeadingIds(content);
    return {
      segments,
      plugins: segments.map((_segment, index) => [remarkGfm, remarkHeadingIds(headingIds[index] ?? [])]),
    };
  }, [content]);

  return (
    <>
      {segments.map((segment, index) => (
        <React.Fragment key={index}>
          {index > 0 && embedded}
          {segment.markdown && (
            <ReactMarkdown remarkPlugins={plugins[index]} components={markdownComponents}>
              {segment.markdown}
            </ReactMarkdown>
          )}
        </React.Fragment>
      ))}
      {segments.length === 1 && embedded}
    </>
  );
};

export default ArticleMarkdown;
