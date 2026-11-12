import React from 'react';
import { Link } from 'react-router-dom';
import { parseLandingText } from '../content/landingCopy';
import { isKnownAppPath } from '../utils/appRoutes';

/**
 * Landing copy with `[label](href)` links: app paths route in the app, site
 * paths the app has no view for (the standalone /ci page) load as documents,
 * and others open externally.
 */
export const LandingText: React.FC<{ value: string }> = ({ value }) => (
  <>
    {parseLandingText(value).map((part, index) => {
      if (!part.href) return <React.Fragment key={index}>{part.text}</React.Fragment>;
      if (!part.href.startsWith('/')) {
        return <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>;
      }
      const pathname = part.href.split(/[?#]/)[0];
      return <Link key={index} to={part.href} reloadDocument={!isKnownAppPath(pathname)}>{part.text}</Link>;
    })}
  </>
);

export default LandingText;
