// Reusable brand primitives shared across the admin surface. Built on the
// tokens in ../theme so the admin pages match the player-facing Join / End /
// Game pages.
import type { CSSProperties, ReactNode } from 'react';
import MapBackground from './MapBackground';
import {
  WHITE, INK, INK_SOFT, ORANGE, ORANGE_TEXT, CREAM, FILL, HAIRLINE, BRAND_GREY,
  CARD_SHADOW, RADIUS_CARD, RADIUS_PILL,
  primaryBtn, secondaryBtn, fieldLabel,
} from '../theme';

// Full-page backdrop (muted live map) + centered single-column content.
// Mirrors the player pages' shell for card-on-backdrop screens.
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <>
      <MapBackground />
      <div style={{
        position: 'relative', zIndex: 1,
        minHeight: '100vh',
        padding: '32px 16px 48px',
        maxWidth: 480, margin: '0 auto',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-start',
      }}>
        {children}
      </div>
    </>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      background: WHITE, color: INK, borderRadius: RADIUS_CARD,
      padding: '22px 22px 24px',
      boxShadow: CARD_SHADOW,
      ...style,
    }}>
      {children}
    </div>
  );
}

export function BrandLine({ children = 'In the Loop' }: { children?: ReactNode }) {
  return (
    <span style={{
      fontSize: 12, fontWeight: 700, letterSpacing: '0.12em',
      textTransform: 'uppercase', color: BRAND_GREY,
    }}>
      {children}
    </span>
  );
}

// Cream pill with a colored status dot. `dot` defaults to brand orange.
export function StatusPill({ children, dot = ORANGE }: { children: ReactNode; dot?: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: CREAM, color: ORANGE_TEXT,
      padding: '4px 10px 4px 8px', borderRadius: RADIUS_PILL,
      fontSize: 12, fontWeight: 700, letterSpacing: '0.01em',
      whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />
      {children}
    </span>
  );
}

// Full-bleed hairline. Pass the card's horizontal padding as `bleed` so the
// rule reaches both edges (cards use 22px padding by default).
export function Divider({ bleed = 22, margin = 18 }: { bleed?: number; margin?: number }) {
  return <div style={{ height: 1, background: HAIRLINE, margin: `${margin}px -${bleed}px` }} />;
}

// Small uppercase caption used to head a list/section. Uses INK_SOFT (not the
// lighter BRAND_GREY) so functional labels clear WCAG AA on white/fill panels;
// BRAND_GREY stays reserved for the decorative "In the Loop" wordmark.
export function SectionLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <p style={{
      margin: '0 0 8px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: INK_SOFT, ...style,
    }}>
      {children}
    </p>
  );
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ ...fieldLabel, display: 'block' }}>{label}</label>
      {children}
    </div>
  );
}

export function PrimaryButton({
  children, onClick, disabled = false, type = 'button', style,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  style?: CSSProperties;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      style={{ ...primaryBtn(disabled), ...style }}>
      {children}
    </button>
  );
}

export function SecondaryButton({
  children, onClick, disabled = false, style,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ ...secondaryBtn(disabled), ...style }}>
      {children}
    </button>
  );
}

// Empty-state pill — soft neutral fill, centered text.
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div style={{
      background: FILL, color: INK_SOFT,
      borderRadius: 10, padding: '14px 16px',
      fontSize: 14, textAlign: 'center',
    }}>
      {children}
    </div>
  );
}
