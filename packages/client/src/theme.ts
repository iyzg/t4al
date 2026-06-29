// Design tokens for the "In the Loop" brand.
//
// These mirror the warm card system used on the player-facing Join / End /
// Game pages so the admin surface reads as the same product instead of a
// separate, flat-UI app. The admin pages import from here; the player pages
// predate this module and still inline equivalent values — keep the two in
// sync if you retune the palette.
import type { CSSProperties } from 'react';
import type { Challenge, ChallengeType } from '@t4al/shared';

// ── Brand palette ─────────────────────────────────────────────────────────
export const WHITE        = '#FFFFFF';
export const INK          = '#111111';  // primary text
export const INK_SOFT     = '#5a5a5a';  // secondary text
export const ORANGE       = '#E88B3E';  // brand accent / primary action
export const ORANGE_TEXT  = '#a86421';  // orange-family text on cream
export const CREAM        = '#FBEFE1';  // warm highlight fill
export const FILL         = '#F4F1EB';  // neutral list / secondary fill
export const HAIRLINE     = '#ECE8DF';  // subtle borders + dividers
export const BRAND_GREY   = '#9b9385';  // uppercase labels / muted captions
export const NAVY         = '#0b0f1a';  // dark chrome floating over the map
export const DISABLED_BG   = '#D7D2C8';
export const DISABLED_TEXT = '#7a7a7a';
export const DANGER        = '#c0392b';  // error text (matches player pages)

export const CARD_SHADOW  = '0 16px 40px rgba(0, 0, 0, 0.32)';  // cards on backdrop
export const PANEL_SHADOW = '0 10px 30px rgba(0, 0, 0, 0.28)';  // panels floating over the map

export const RADIUS_CARD  = 18;
export const RADIUS_PANEL = 14;
export const RADIUS_FIELD = 10;
export const RADIUS_PILL  = 999;

// ── Data palette ──────────────────────────────────────────────────────────
// Challenge type + status colors, retuned from the original saturated
// flat-UI set to warm, muted tones that sit with the brand while still
// color-coding information. Used for badges AND map markers, so the admin
// map and admin panels stay in lockstep.
const TYPE_COLORS: Record<ChallengeType, string> = {
  normal:   '#4E89A8',  // dusty blue
  variable: '#5E9B7D',  // sage green
  wager:    '#9B6FA6',  // muted plum
};

export function typeColor(t: ChallengeType): string {
  return TYPE_COLORS[t] ?? INK_SOFT;
}

export const STATUS_COLORS = {
  claimed: '#3F8F6B',  // deep green — done / success
  expired: '#C56B54',  // terracotta — calmer than a flat red
  queued:  '#A89A82',  // warm taupe — neutral / waiting
} as const;

// Display color for a challenge given its status. Active challenges keep
// their type color; terminal/neutral states use the status palette.
export function statusColor(status: Challenge['status'], type: ChallengeType): string {
  switch (status) {
    case 'active':  return typeColor(type);
    case 'claimed': return STATUS_COLORS.claimed;
    case 'expired': return STATUS_COLORS.expired;
    default:        return STATUS_COLORS.queued; // queued / loading / etc.
  }
}

// Dot color for a game-status pill (lobby / active / ended).
export function gameStatusColor(status: string): string {
  if (status === 'active') return STATUS_COLORS.claimed;
  if (status === 'ended')  return STATUS_COLORS.expired;
  return ORANGE; // lobby / anything pre-start
}

// ── Shared style factories ──────────────────────────────────────────────────
export const textInput: CSSProperties = {
  fontSize: 16, padding: '11px 12px', width: '100%',
  boxSizing: 'border-box',
  background: WHITE, color: INK,
  border: `1px solid ${HAIRLINE}`,
  borderRadius: RADIUS_FIELD, outline: 'none',
};

export const fieldLabel: CSSProperties = {
  margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: INK,
};

export const cardTitle: CSSProperties = {
  margin: '12px 0 4px', fontSize: 26, fontWeight: 700,
  letterSpacing: '-0.01em', color: INK,
};

export const subtitle: CSSProperties = {
  margin: 0, fontSize: 14, color: INK_SOFT,
};

export const errorText: CSSProperties = {
  margin: '12px 4px 0', color: DANGER,
  fontSize: 14, textAlign: 'center', fontWeight: 600,
};

export function primaryBtn(disabled = false): CSSProperties {
  return {
    width: '100%',
    padding: '13px 18px', fontSize: 16, fontWeight: 700,
    background: disabled ? DISABLED_BG : ORANGE,
    color: disabled ? DISABLED_TEXT : WHITE,
    border: 'none', borderRadius: RADIUS_FIELD,
    cursor: disabled ? 'not-allowed' : 'pointer',
    letterSpacing: '0.01em',
  };
}

export function secondaryBtn(disabled = false): CSSProperties {
  return {
    width: '100%',
    padding: '13px 18px', fontSize: 16, fontWeight: 700,
    background: FILL, color: disabled ? DISABLED_TEXT : INK,
    border: `1px solid ${HAIRLINE}`, borderRadius: RADIUS_FIELD,
    cursor: disabled ? 'not-allowed' : 'pointer',
    letterSpacing: '0.01em',
  };
}
