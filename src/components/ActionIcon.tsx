import React from 'react';

/** Toolbar actions use the global outline-icon stroke weight. */
export default function ActionIcon({ name }: { name: 'share' | 'info' }) {
  return (
    <svg className="icon-outline" width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      {name === 'share' ? <>
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
      </> : <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>}
    </svg>
  );
}
