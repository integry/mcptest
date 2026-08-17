import React from 'react';

interface LayoutColumnsIconProps {
  columns: number;
  size?: number;
}

// Positions of the internal divider lines for each supported column count.
const DIVIDERS: Record<number, number[]> = {
  1: [],
  2: [12],
  3: [9, 15],
  4: [7.5, 12, 16.5],
};

/**
 * Thin-stroke outline icon representing a column layout (Lucide-style).
 * Uses the shared 1.5px stroke width so it sits at the same visual weight
 * as the rest of the icons in the toolbar.
 */
const LayoutColumnsIcon: React.FC<LayoutColumnsIconProps> = ({ columns, size = 16 }) => {
  const dividers = DIVIDERS[columns] ?? DIVIDERS[2];

  return (
    <svg
      className="icon-outline"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      {dividers.map((x) => (
        <line key={x} x1={x} y1="3" x2={x} y2="21" />
      ))}
    </svg>
  );
};

export default LayoutColumnsIcon;
