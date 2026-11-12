import { useEffect, useState } from 'react';

import { MENU_OPEN_CLASS } from '../utils/layoutState';

const isMenuOpen = () => typeof document !== 'undefined' && document.body.classList.contains(MENU_OPEN_CLASS);

/** Whether the mobile drawer is open; App and the drawer toggle a class on <body>. */
export const useMobileMenuOpen = (): boolean => {
  const [open, setOpen] = useState(isMenuOpen);

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    setOpen(isMenuOpen());
    const observer = new MutationObserver(() => setOpen(isMenuOpen()));
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return open;
};
