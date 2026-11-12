import React from 'react';
import { referencePathFor } from '../utils/referenceLinks';

interface FindingReferenceLinkProps {
  id: string;
  /** Show the id itself as the link text, followed by "Learn more". */
  showId?: boolean;
  className?: string;
}

/**
 * Links a diagnostic or finding id to its section of the transport
 * diagnostics reference. Internal route, so it opens in the same tab.
 * Ids without a reference section render as plain code (or nothing).
 */
const FindingReferenceLink: React.FC<FindingReferenceLinkProps> = ({ id, showId = true, className }) => {
  const href = referencePathFor(id);
  if (!href) return showId ? <code className={className}>{id}</code> : null;
  return (
    // With the id shown, the visible text already names the link; a different
    // aria-label would hide what sighted and voice users read.
    <a href={href} className={className} {...(showId ? {} : { 'aria-label': `Learn more about ${id}` })}>
      {showId && <><code>{id}</code>{' '}</>}
      <span className="small text-decoration-underline">Learn more</span>
    </a>
  );
};

export default FindingReferenceLink;
