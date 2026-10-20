import React, { useState } from 'react';
import type { BadgeSnippets } from '../utils/badges';
import './BadgeEmbed.css';

interface BadgeEmbedProps {
  /** Heading id, used to label the section. */
  titleId: string;
  titleLevel?: 2 | 3;
  description: React.ReactNode;
  previewSrc: string;
  previewAlt: string;
  linkUrl: string;
  snippets: BadgeSnippets;
}

const SNIPPET_FORMATS: { key: keyof BadgeSnippets; label: string }[] = [
  { key: 'markdown', label: 'Markdown' },
  { key: 'html', label: 'HTML' },
  { key: 'restructuredText', label: 'reStructuredText' },
];

/** Badge preview with copyable Markdown, HTML and reStructuredText embed snippets. */
const BadgeEmbed: React.FC<BadgeEmbedProps> = ({
  titleId,
  titleLevel = 3,
  description,
  previewSrc,
  previewAlt,
  linkUrl,
  snippets,
}) => {
  const [copied, setCopied] = useState<keyof BadgeSnippets | null>(null);
  const Heading = titleLevel === 2 ? 'h2' : 'h3';

  const copy = async (key: keyof BadgeSnippets) => {
    try {
      await navigator.clipboard?.writeText(snippets[key]);
      setCopied(key);
    } catch {
      setCopied(null);
    }
  };

  return (
    <section className="badge-embed" aria-labelledby={titleId}>
      <div className="badge-embed-heading">
        <Heading id={titleId}>Share and embed</Heading>
        <p>{description}</p>
      </div>
      <a className="badge-embed-preview" href={linkUrl} target="_blank" rel="noopener noreferrer">
        <img src={previewSrc} alt={previewAlt} height={20} />
      </a>
      <div className="badge-embed-snippets">
        {SNIPPET_FORMATS.map(({ key, label }) => {
          const fieldId = `${titleId}-${key}`;
          return (
            <div className="badge-embed-snippet" key={key}>
              <div className="badge-embed-snippet-header">
                <label htmlFor={fieldId}>{label}</label>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost badge-embed-copy"
                  onClick={() => void copy(key)}
                  aria-label={`Copy ${label} badge snippet`}
                >
                  <i className={`bi ${copied === key ? 'bi-check2' : 'bi-copy'} me-1`} aria-hidden="true"></i>
                  {copied === key ? 'Copied' : 'Copy'}
                </button>
              </div>
              <textarea
                id={fieldId}
                className="form-control badge-embed-code"
                readOnly
                spellCheck={false}
                rows={key === 'restructuredText' ? 3 : 2}
                value={snippets[key]}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default BadgeEmbed;
