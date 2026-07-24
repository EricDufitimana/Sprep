/**
 * Shared contract for the onboarding-status cookie.
 *
 * The proxy needs `profiles.onboarded` to gate dashboard routes, but a DB read
 * on every request is wasteful. `onboarded` is monotonic — it goes false→true
 * once and never back — so once it is true the answer can be cached client-side
 * without risking a stale "allow" for someone who should be blocked.
 *
 * Worst case is one read per request while the user is still unboarded (a short
 * window, and they are being redirected to onboarding anyway); zero reads after.
 * The cookie is a cache, never the source of truth for anything security-
 * sensitive: it only ever short-circuits a redirect, and every procedure still
 * enforces auth through RLS.
 */

export const ONBOARDED_COOKIE = 'sprep-onboarded';

export const ONBOARDED_COOKIE_OPTIONS = {
  httpOnly: false,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
};
