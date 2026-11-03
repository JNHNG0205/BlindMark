// Stroke icons drawn on a 24px grid, 1.5px stroke, so they read as one set.
import type { ReactNode, SVGProps } from "react";

function Icon({
  children,
  ...props
}: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ArrowRight() {
  return (
    <Icon width="14" height="14">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  );
}

export function Mark() {
  // Wordmark glyph: a closed box (the sealed test set) with a single tick through it.
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1" y="1" width="18" height="18" rx="3" fill="var(--accent)" />
      <path
        d="M5.5 10.5l3 3 6-7"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Chip() {
  return (
    <Icon>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </Icon>
  );
}

export function Lock() {
  return (
    <Icon>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </Icon>
  );
}

export function Ledger() {
  return (
    <Icon>
      <path d="M4 4h16v16H4z" />
      <path d="M4 9h16M9 9v11" />
    </Icon>
  );
}

export function Tree() {
  return (
    <Icon>
      <circle cx="12" cy="4.5" r="2" />
      <circle cx="5.5" cy="19.5" r="2" />
      <circle cx="18.5" cy="19.5" r="2" />
      <path d="M12 6.5v5M12 11.5l-6.5 6M12 11.5l6.5 6" />
    </Icon>
  );
}

export function Fingerprint() {
  return (
    <Icon>
      <path d="M12 11v3a8 8 0 0 1-1.5 4.5" />
      <path d="M8.5 21a12 12 0 0 0 1.5-5.5V11a2 2 0 0 1 4 0v1" />
      <path d="M17.5 14.5c0 2.5-.5 4.5-1.5 6.5" />
      <path d="M5 16.5c.5-1.5.5-3 .5-5.5a6.5 6.5 0 0 1 12-3.5" />
    </Icon>
  );
}

export function Signature() {
  return (
    <Icon>
      <path d="M3 17c3-1 4-9 6-9s0 9 3 9 3-5 5-5 2 3 4 3" />
      <path d="M3 21h18" />
    </Icon>
  );
}
