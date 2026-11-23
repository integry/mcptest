/** Show the scroll hint when an article table exceeds its wrapper. */
export const observeArticleTableOverflow = (root: HTMLElement): (() => void) | undefined => {
  if (typeof ResizeObserver === 'undefined') return;
  const hints = root.querySelectorAll('.reading-table > .reading-table-hint');
  if (!hints.length) return;
  const wrappers = Array.from(hints, hint => hint.parentElement!);

  let frame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  });
  const update = () => {
    if (!root.isConnected) {
      observer.disconnect();
      return;
    }
    for (const wrapper of wrappers) {
      wrapper.toggleAttribute('data-overflowing', wrapper.scrollWidth > wrapper.clientWidth);
    }
  };
  for (const wrapper of wrappers) {
    observer.observe(wrapper);
    const table = wrapper.querySelector('table');
    if (table) observer.observe(table);
  }
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
  };
};
