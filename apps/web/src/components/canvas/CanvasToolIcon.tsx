"use client";

import type { CanvasTool } from "@/lib/canvas-types";

const common = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function CanvasToolIcon({ tool }: { tool: CanvasTool }) {
  switch (tool) {
    case "select":
      return (
        <svg {...common}>
          <path d="M4 3l7.5 17 2.3-6.2L20 11.5z" />
        </svg>
      );
    case "pen":
      return (
        <svg {...common}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      );
    case "text":
      return (
        <svg {...common}>
          <path d="M4 6V4h16v2" />
          <path d="M12 4v16" />
          <path d="M9 20h6" />
        </svg>
      );
    case "rect":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="1.5" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...common}>
          <path d="M5 19 19 5" />
          <path d="M10 5h9v9" />
        </svg>
      );
    case "badge":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M10.5 9.5 12 8v8" />
        </svg>
      );
    case "blur":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="6" height="6" rx="1" />
          <rect x="15" y="3" width="6" height="6" rx="1" opacity="0.45" />
          <rect x="3" y="15" width="6" height="6" rx="1" opacity="0.45" />
          <rect x="15" y="15" width="6" height="6" rx="1" />
        </svg>
      );
    default:
      return null;
  }
}
