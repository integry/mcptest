import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import DashboardsView from './DashboardsView';
import { Space } from '../types';

const space: Space = {
  id: 'dashboard-1',
  name: 'My dashboard',
  cards: [],
  columns: 2,
};

const renderToolbar = (overrides: Partial<React.ComponentProps<typeof DashboardsView>> = {}) =>
  renderToStaticMarkup(
    <DashboardsView
      space={space}
      onUpdateSpace={vi.fn()}
      onDeleteSpace={vi.fn()}
      onUpdateCard={vi.fn()}
      onDeleteCard={vi.fn()}
      onExecuteCard={vi.fn()}
      onMoveCard={vi.fn()}
      onAddCard={vi.fn()}
      onRefreshSpace={vi.fn()}
      {...overrides}
    />
  );

describe('DashboardsView toolbar', () => {
  it('renders the column selector as a segmented control instead of joined buttons', () => {
    const markup = renderToolbar();

    expect(markup).toContain('class="segmented-control"');
    expect(markup).not.toContain('btn-group');
    // The old control drew columns with heavy block glyphs.
    expect(markup).not.toContain('▌');
  });

  it('marks only the current column count as the active pill', () => {
    const markup = renderToolbar();
    const activeItems = markup.match(/segmented-control-item active/g) ?? [];

    expect(activeItems).toHaveLength(1);
    expect(markup).toContain('aria-label="2 columns"');
    expect(markup).toContain('aria-label="1 column"');
    expect(markup).toContain('aria-label="4 columns"');
  });

  it('draws the layout icons as thin-stroke outlines', () => {
    const markup = renderToolbar();

    expect(markup).toContain('stroke-width="1.5"');
    expect(markup).toContain('fill="none"');
  });

  it('keeps the delete button neutral until hover', () => {
    const markup = renderToolbar();

    expect(markup).not.toContain('btn-outline-danger');
    expect(markup).toContain('btn-outline-secondary btn-danger-hover');
  });

  it('separates the toolbar into logical groups with dividers', () => {
    const markup = renderToolbar();
    const dividers = markup.match(/class="toolbar-divider"/g) ?? [];

    expect(dividers).toHaveLength(2);
  });

  it('omits the leading divider when there is no refresh action', () => {
    const markup = renderToolbar({ onRefreshSpace: undefined });
    const dividers = markup.match(/class="toolbar-divider"/g) ?? [];

    expect(dividers).toHaveLength(1);
  });

  it('styles the segmented control as a grey container with a raised active pill', () => {
    const css = readFileSync(resolve('src/index.css'), 'utf8');

    expect(css).toMatch(/\.segmented-control\s*\{[^}]*background-color:\s*var\(--card-bg-secondary\)/);
    expect(css).toMatch(/\.segmented-control-item\s*\{[^}]*border:\s*none/);
    expect(css).toMatch(/\.segmented-control-item\.active\s*\{[^}]*background-color:\s*var\(--card-bg\)/);
    expect(css).toMatch(/\.btn-danger-hover:hover[^{]*\{[^}]*color:\s*var\(--danger-color\)/);
    expect(css).toMatch(/\.btn-ghost\s*\{[^}]*background-color:\s*transparent/);
  });
});
