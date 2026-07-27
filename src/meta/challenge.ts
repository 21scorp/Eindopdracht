/**
 * Challenge links.
 *
 * The wave director is seeded, so the same seed produces the same waves in the
 * same order. That makes a run *reproducible*, which turns a score into
 * something a friend can actually contest rather than just admire.
 *
 * A challenge encodes the seed plus enough context to render a target card, and
 * rides in the URL. Opening the link drops you straight onto the challenge
 * screen with one button.
 *
 * The payload is deliberately tiny and unsigned: it is a party trick, not a
 * leaderboard. Anyone can hand-craft one claiming a huge score, which costs
 * nothing because there is no ranking to corrupt. If a real leaderboard is ever
 * added, scores have to be produced and validated server-side; nothing here
 * should be trusted for that.
 */

const VERSION = 1;
const PARAM = 'c';

export interface Challenge {
  /** Run seed. Replaying it reproduces the same waves. */
  seed: string;
  /** Score to beat. */
  score: number;
  /** Wave the challenger reached. */
  wave: number;
  /** Challenger's display name. */
  name: string;
  /** Guardian they used, for the card art. */
  guardianId: string;
}

/** URL-safe base64 without padding. */
function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Pack a challenge into a token. Fields are positional rather than a JSON
 * object so the token stays short enough to survive every messaging app's
 * link handling.
 */
export function encodeChallenge(c: Challenge): string {
  const parts = [
    String(VERSION),
    c.seed,
    String(Math.max(0, Math.round(c.score))),
    String(Math.max(1, Math.round(c.wave))),
    c.guardianId,
    c.name.slice(0, 14),
  ];
  return encodeBase64Url(parts.join('|'));
}

export function decodeChallenge(token: string): Challenge | null {
  try {
    const parts = decodeBase64Url(token.trim()).split('|');
    if (parts.length < 6) return null;
    const [version, seed, score, wave, guardianId, name] = parts;
    if (Number(version) !== VERSION) return null;
    if (!seed || !guardianId) return null;
    const parsedScore = Number(score);
    const parsedWave = Number(wave);
    if (!Number.isFinite(parsedScore) || !Number.isFinite(parsedWave)) return null;
    return {
      seed,
      score: Math.max(0, Math.round(parsedScore)),
      wave: Math.max(1, Math.round(parsedWave)),
      guardianId,
      name: (name || 'GUARDIAN').slice(0, 14),
    };
  } catch {
    return null;
  }
}

/** Absolute URL that opens straight into this challenge. */
export function challengeUrl(c: Challenge, base = location.href): string {
  const url = new URL(base);
  url.hash = '';
  url.searchParams.set(PARAM, encodeChallenge(c));
  return url.toString();
}

/** Read a challenge out of the current URL, if there is one. */
export function readChallengeFromUrl(search = location.search): Challenge | null {
  const token = new URLSearchParams(search).get(PARAM);
  return token ? decodeChallenge(token) : null;
}

/**
 * Strip the challenge parameter without reloading, so a refresh does not
 * re-prompt and the URL is clean once the challenge has been seen.
 */
export function clearChallengeFromUrl(): void {
  if (typeof history === 'undefined' || !history.replaceState) return;
  const url = new URL(location.href);
  if (!url.searchParams.has(PARAM)) return;
  url.searchParams.delete(PARAM);
  history.replaceState({}, '', url.toString());
}

/** How the result of an attempt is described back to the player. */
export type ChallengeOutcome = 'beaten' | 'missed';

export function evaluateChallenge(challenge: Challenge, score: number): { outcome: ChallengeOutcome; margin: number } {
  const margin = score - challenge.score;
  return { outcome: margin >= 0 ? 'beaten' : 'missed', margin: Math.abs(margin) };
}
