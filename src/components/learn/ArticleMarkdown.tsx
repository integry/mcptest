import InlineTestForm from './InlineTestForm';
import React, { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Link } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { splitAtComponentMarker } from '../../content/contentModel';
import { extractSegmentHeadingIds, remarkHeadingIds } from '../../content/outline';
import CodeBlock from './CodeBlock';

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
  inlineTest?: boolean;
}

const ArticleMarkdown: React.FC<ArticleMarkdownProps> = ({ content, embedded, inlineTest }) => {
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

  let codeIndex = 0;
  const components = { ...markdownComponents, pre: ({ children }: { children?: React.ReactNode }) => {
    const first = codeIndex++ === 0;
    return <><CodeBlock>{children}</CodeBlock>{inlineTest && first && <InlineTestForm id="guide-early-test" />}</>;
  } };
  return (
    <>
      {segments.map((segment, index) => (
        <React.Fragment key={index}>
          {index > 0 && embedded}
          {segment.markdown && (
            <ReactMarkdown remarkPlugins={plugins[index]} components={components}>
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
