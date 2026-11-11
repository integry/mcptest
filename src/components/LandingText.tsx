import React from 'react';
import { Link } from 'react-router-dom';
import { parseLandingText } from '../content/landingCopy';

/** Landing copy with `[label](href)` links: site paths route in the app, others open externally. */
export const LandingText: React.FC<{ value: string }> = ({ value }) => (
  <>
    {parseLandingText(value).map((part, index) => {
      if (!part.href) return <React.Fragment key={index}>{part.text}</React.Fragment>;
      return part.href.startsWith('/')
        ? <Link key={index} to={part.href}>{part.text}</Link>
        : <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>;
    })}
  </>
);

export default LandingText;
