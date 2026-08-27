// i18n groundwork — the mechanism, installed ahead of any second language.
//
// Gettext-style: the ENGLISH STRING IS THE KEY. `t('Solve this cube')` looks the sentence up in
// the active catalog and returns it untouched when there is none — so wiring `t()` through the
// app changes nothing observable today (every test that asserts English text keeps passing), and
// adding a language later is exactly one catalog file plus one `registerLocale` call. English
// needs no catalog, ever.
//
// Why English-as-key over invented ids ('scan.solve.button'): the source stays readable, missing
// translations degrade to correct English instead of leaking bare ids into the UI, and the
// catalog file doubles as a complete, reviewable list of every sentence the app can say.
//
// Parameters use %1..%9 — `t('Got the %1 side — %2/6', name, done)` — substituted AFTER lookup,
// so a translation can reorder them. Strings assembled by interpolation before reaching t()
// (today: the scanner panel's notices, which embed colour words) pass through untranslated until
// their call sites move to the placeholder form; dev-docs/i18n.md tracks that seam.

/** locale tag → Map(english → translated). */
const catalogs = new Map();
let active = null;

/** Translate `text`, then substitute %1..%9 with `args`. Identity while no locale is active. */
export const t = (text, ...args) => {
  const out = active?.get(text) ?? text;
  return args.length === 0 ? out : out.replace(/%([1-9])/g, (m, i) => String(args[i - 1] ?? m));
};

/** Make a language available. `entries` is a plain object: { 'English sentence': '译文', … }. */
export function registerLocale(tag, entries) {
  catalogs.set(tag, new Map(Object.entries(entries)));
}

/** Registered locales, English first — what a future language picker will list. */
export function availableLocales() {
  return ['en', ...catalogs.keys()];
}

/**
 * Activate a locale. 'en' (or anything unregistered) deactivates translation rather than failing:
 * English is the source text, not a catalog. Returns whether `tag` was actually available, so a
 * caller can fall back loudly instead of wondering.
 */
export function setLocale(tag) {
  active = catalogs.get(tag) ?? null;
  return active !== null || tag === 'en';
}

/**
 * Pick the startup locale: an explicit choice wins; otherwise the browser's language, matched
 * loosely ('zh-CN' finds 'zh'). With no catalogs registered this resolves to English and does
 * nothing — which is today.
 */
export function initLocale(preferred) {
  const want = preferred || (typeof navigator !== 'undefined' ? navigator.language : '') || 'en';
  if (setLocale(want) && catalogs.has(want)) return want;
  const base = want.toLowerCase().split('-')[0];
  if (catalogs.has(base)) {
    setLocale(base);
    return base;
  }
  setLocale('en');
  return 'en';
}
