// Shared formatting for the on-map challenge tooltips used by both the setup
// editor and the live admin map. MapLibre popups take raw HTML, so this builds
// an escaped, brand-styled markup string rather than React.
import type { Challenge, ChallengeType } from '@t4al/shared';
import { typeColor, statusColor } from './theme';

type ChallengeLike = Pick<
  Challenge, 'type' | 'name' | 'description' | 'tokens' | 'tokensPerUnit' | 'unitLabel'
>;

/** Human-readable token value for a challenge, keyed off its type. */
export function tokenSummary(c: ChallengeLike): string {
  if (c.type === 'normal')   return `${c.tokens ?? 0} tokens`;
  if (c.type === 'variable') return `${c.tokensPerUnit ?? 0} per ${c.unitLabel || 'unit'}`;
  return 'Wager';
}

function typeLabel(t: ChallengeType): string {
  return t === 'normal' ? 'NORMAL' : t === 'variable' ? 'VARIABLE' : 'WAGER';
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;');
}

/**
 * Brand-styled tooltip HTML for a challenge. The card hugs its content (no
 * forced min-width). The meta line carries the token value, optionally preceded
 * by a status dot (live map) — so the card stays dense instead of leaving the
 * lower half empty. `description: true` appends the (in-game hidden) description,
 * used on the editor map.
 */
export function challengePopupHTML(
  c: ChallengeLike,
  opts: { description?: boolean; status?: Challenge['status'] } = {},
): string {
  const color = typeColor(c.type);

  const bits: string[] = [];
  if (opts.status) {
    const sc = statusColor(opts.status, c.type);
    bits.push(
      `<span style="display:inline-flex;align-items:center;gap:5px;color:#5a5a5a;text-transform:capitalize;">` +
        `<span style="width:6px;height:6px;border-radius:50%;background:${sc};"></span>${esc(opts.status)}` +
      `</span>`
    );
  }
  // Wager has no fixed token value and its badge already says "WAGER", so a
  // "Wager" token line would just be redundant — show it only for normal/variable.
  if (c.type !== 'wager') {
    bits.push(`<span style="color:${color};font-weight:700;">${esc(tokenSummary(c))}</span>`);
  }
  const meta = bits.length
    ? `<div style="font-size:12px;margin-top:3px;white-space:nowrap;">` +
        bits.join('<span style="color:#cfc9bd;margin:0 6px;">·</span>') +
      `</div>`
    : '';

  const desc = opts.description && c.description
    ? `<div style="margin-top:5px;font-size:12px;line-height:1.35;color:#5a5a5a;">${esc(c.description)}</div>`
    : '';

  return (
    `<div style="font-family:'Sora',-apple-system,BlinkMacSystemFont,sans-serif;max-width:230px;">` +
      `<div style="display:flex;align-items:center;gap:7px;">` +
        `<span style="font-size:9px;font-weight:700;letter-spacing:0.4px;padding:2px 6px;border-radius:4px;color:#fff;background:${color};white-space:nowrap;">${typeLabel(c.type)}</span>` +
        `<span style="font-size:14px;font-weight:700;color:#111;white-space:nowrap;">${esc(c.name || 'Untitled')}</span>` +
      `</div>` +
      meta +
      desc +
    `</div>`
  );
}
