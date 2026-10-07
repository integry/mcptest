import React, { useEffect, useState } from 'react';

interface CatalogServerLogoProps {
  name: string;
  logoUrl?: string;
  className?: string;
  /** Set false when no adjacent visible text identifies the product. */
  decorative?: boolean;
}

export const getCatalogServerInitials = (name: string): string => {
  const words = name.match(/[\p{L}\p{N}]+/gu) || [];
  const initials = words.length > 1
    ? `${words[0][0]}${words[1][0]}`
    : words[0]?.slice(0, 2) || '?';

  return initials.toLocaleUpperCase();
};

/**
 * One resilient rendering path for every catalog logo. The fallback is stable
 * across server and client rendering and replaces images that fail at runtime.
 */
export const CatalogServerLogo: React.FC<CatalogServerLogoProps> = ({
  name,
  logoUrl,
  className = '',
  decorative = true,
}) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [logoUrl]);

  const accessibilityProps = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'img', 'aria-label': `${name} logo` };
  const classes = ['catalog-server-logo', className, failed || !logoUrl ? 'catalog-server-logo--fallback' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} {...accessibilityProps} data-catalog-server-logo>
      {logoUrl && !failed ? (
        <img
          src={logoUrl}
          alt={decorative ? '' : `${name} logo`}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="catalog-server-logo-initials">{getCatalogServerInitials(name)}</span>
      )}
    </span>
  );
};
