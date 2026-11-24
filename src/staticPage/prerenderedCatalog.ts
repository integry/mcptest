/** The server rows already parsed by the browser, indexed once for reuse on mount. */
export interface PrerenderedCatalog {
  pathname: string;
  list: HTMLUListElement;
  rows: Map<string, HTMLLIElement>;
}

let captured: PrerenderedCatalog | null = null;

export const capturePrerenderedCatalog = (root: HTMLElement, pathname: string): void => {
  const list = root.querySelector<HTMLUListElement>('[data-deferred-mount] .catalog-server-list');
  captured = list?.firstElementChild?.hasAttribute('data-catalog-server-id') ? {
    pathname,
    list,
    rows: new Map(Array.from(list.children as HTMLCollectionOf<HTMLLIElement>, row => [
      row.dataset.catalogServerId!, row,
    ])),
  } : null;
};

export const getPrerenderedCatalog = (pathname: string): PrerenderedCatalog | null =>
  captured?.pathname === pathname ? captured : null;

export const STATIC_SEARCH_EDITED_ATTRIBUTE = 'data-static-search-edited';
export const STATIC_CATALOG_SEARCH_ATTRIBUTE = 'data-static-catalog-search';

/** Leave matching nodes in place and move only rows that are new or out of order. */
export const syncCatalogRows = (list: HTMLUListElement, rows: HTMLLIElement[]): void => {
  const visible = new Set(rows);
  for (const row of Array.from(list.children) as HTMLLIElement[]) {
    if (!visible.has(row)) row.remove();
  }
  let next = list.firstElementChild;
  for (const row of rows) {
    if (row === next) next = next.nextElementSibling;
    else list.insertBefore(row, next);
  }
};
