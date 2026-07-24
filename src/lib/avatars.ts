/**
 * The fixed onboarding avatar set (alohe/avatars, served from jsDelivr).
 *
 * These are a curated preset list, not user uploads, so they are hotlinked
 * directly — there is nothing to moderate, no binary passes through the app,
 * and no image host to configure.
 *
 * `id` is stored in `profiles.avatar_id`, `url` in `profiles.avatar_url`.
 */

export interface AvatarPreset {
  id: string;
  url: string;
}

const CDN = 'https://cdn.jsdelivr.net/gh/alohe/avatars/png';

export const AVATARS: AvatarPreset[] = Array.from({ length: 27 }, (_, i) => ({
  id: `vibrent_${i + 1}`,
  url: `${CDN}/vibrent_${i + 1}.png`,
}));

export const AVATAR_IDS = AVATARS.map((a) => a.id);

/** Guard for what a client is allowed to save — rejects arbitrary URLs. */
export function isKnownAvatarId(id: string): boolean {
  return AVATAR_IDS.includes(id);
}

export function avatarById(id: string): AvatarPreset | undefined {
  return AVATARS.find((a) => a.id === id);
}
