/**
 * Host switch for Ka Link live translation (pure; tested in scripts/ka-link-translation.test.mjs).
 * The attribute name and value format must match plcc-live-translation src/control/attributes.ts.
 */
export const HOST_TRANSLATE_ATTRIBUTE = 'plcc.translate';

export const TRANSLATION_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'lg', label: 'Luganda' },
] as const;

export type TranslationLang = (typeof TRANSLATION_LANGUAGES)[number]['code'];

export function translateAttributeValue(on: boolean, src?: TranslationLang): string {
  return JSON.stringify(on && src ? { on: true, src } : { on: false });
}

/** Host/co-host per Canaan's room metadata ({hostId, coHostIds}); the worker checks the same. */
export function isHuddleHostOrCoHost(roomMetadata: string | undefined | null, identity: string | undefined | null): boolean {
  if (!roomMetadata || !identity) return false;
  try {
    const p = JSON.parse(roomMetadata) as { hostId?: unknown; coHostIds?: unknown };
    if (!p || typeof p !== 'object') return false;
    if (String(p.hostId || '').trim() === identity) return true;
    return Array.isArray(p.coHostIds) && p.coHostIds.some((id) => String(id || '').trim() === identity);
  } catch {
    return false;
  }
}
