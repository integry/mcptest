import React, { useMemo, useState } from 'react';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import http from 'highlight.js/lib/languages/http';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import typescript from 'highlight.js/lib/languages/typescript';
import yaml from 'highlight.js/lib/languages/yaml';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Link } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { COMPONENT_MARKER } from '../../content/contentModel';
import { createHeadingIdAllocator } from '../../content/outline';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('http', http);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);

interface MarkdownNode {
  type: string;
  depth?: number;
  value?: string;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, unknown> };
}

const nodeText = (node: MarkdownNode): string => {
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(nodeText).join('');
};

/**
 * Remark plugin that assigns stable ids to headings so the in-page outline
 * (built from the Markdown source with the same slug rules) can link to them.
 */
export const remarkHeadingIds = (allocate: (text: string) => string) => () => (tree: MarkdownNode) => {
  const visit = (node: MarkdownNode) => {
    if (node.type === 'heading') {
      node.data = { ...(node.data ?? {}), hProperties: { ...(node.data?.hProperties ?? {}), id: allocate(nodeText(node)) } };
    }
    node.children?.forEach(visit);
  };
  visit(tree);
};

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
  const highlighted = useMemo(
    () => (language && hljs.getLanguage(language) ? hljs.highlight(code, { language }).value : null),
    [code, language]
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
      <pre>
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

interface ArticleMarkdownProps {
  content: string;
  /** Component inserted at the `<!-- component -->` marker, or after the body when no marker exists. */
  embedded?: React.ReactNode;
}

/** Splits the body at the component marker so the embedded component can be positioned. */
export const splitAtComponentMarker = (content: string): string[] => {
  const lines = content.split('\n');
  const markerIndex = lines.findIndex(line => line.trim() === COMPONENT_MARKER);
  if (markerIndex === -1) return [content];
  return [lines.slice(0, markerIndex).join('\n').trim(), lines.slice(markerIndex + 1).join('\n').trim()];
};

const ArticleMarkdown: React.FC<ArticleMarkdownProps> = ({ content, embedded }) => {
  const allocate = createHeadingIdAllocator();
  const segments = splitAtComponentMarker(content);
  const plugins = [remarkGfm, remarkHeadingIds(allocate)];

  return (
    <>
      {segments.map((segment, index) => (
        <React.Fragment key={index}>
          {index > 0 && embedded}
          {segment && (
            <ReactMarkdown remarkPlugins={plugins} components={markdownComponents}>
              {segment}
            </ReactMarkdown>
          )}
        </React.Fragment>
      ))}
      {segments.length === 1 && embedded}
    </>
  );
};

export default ArticleMarkdown;
