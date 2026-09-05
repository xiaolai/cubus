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
  activeTag = active ? tag : 'en';
  // The DOCUMENT'S language, not just the catalog's. `<html lang>` is what a screen reader picks
  // its voice and its pronunciation rules from, what a browser offers to translate against, and
  // what CSS `:lang()` and hyphenation read; leaving it at `en` while the app speaks another
  // language is the whole page lying about itself in the one place assistive software looks.
  // Guarded, because this module is used from plain Node tests with no document.
  const html = globalThis.document?.documentElement;
  if (html) html.lang = active ? tag : 'en';
  return active !== null || tag === 'en';
}

/**
 * One / many, chosen by the language rather than by an `n === 1` written at the call site.
 *
 * English plurals were hard-coded in a dozen templates (`solve${n === 1 ? '' : 's'}`), which is
 * both untranslatable and wrong for most languages — Chinese has no plural inflection at all,
 * Russian has three forms. `Intl.PluralRules` knows the answer for the ACTIVE locale, and the
 * caller supplies the forms it has; a language needing a form nobody wrote falls back to
 * `other`, which is the form every language declares.
 *
 * The forms go through `t()` themselves, so a catalog translates them as ordinary sentences —
 * which is what keeps this a helper rather than a second, parallel translation mechanism.
 *
 * @param {number} n
 * @param {Record<string, string>} forms  keyed by Intl category: one, other, and any of
 *   zero/two/few/many the language uses. `%1` in a form is substituted with `n`.
 */
export function plural(n, forms) {
  let category = 'other';
  try {
    category = new Intl.PluralRules(activeTag).select(n);
  } catch {
    // An engine without Intl.PluralRules, or a tag it will not parse. English's own rule is the
    // honest fallback for a file whose keys are English.
    category = n === 1 ? 'one' : 'other';
  }
  const form = forms[category] ?? forms.other;
  return t(form, n);
}

/** The active tag, for Intl. English is the source language, so an inactive catalog is 'en'. */
let activeTag = 'en';
/** What Intl should format in. Exported because the app formats dates and relative times too,
 *  and they must agree with the sentences around them. */
export const locale = () => activeTag;

/**
 * Pick the startup locale: an explicit choice wins; otherwise the browser's language, matched
 * loosely ('zh-CN' finds 'zh'). With no catalogs registered this resolves to English and does
 * nothing — which is today.
 */
export function initLocale(preferred) {
  // STRINGS ONLY. `preferred` comes from settings, which comes from localStorage, which is
  // untrusted input — and a truthy non-string sailed past the `||` and reached `.toLowerCase()`,
  // where it threw. That throw happened inside boot() before the first route was applied, so a
  // stored `language: 7` did not degrade the language picker: it left the app with a blank stage
  // (found 2026-09-04 by the hostile-settings suite). A tag that is not a string is not a tag.
  const asked = typeof preferred === 'string' ? preferred : '';
  const fromNav = typeof navigator !== 'undefined' && typeof navigator.language === 'string' ? navigator.language : '';
  const want = asked || fromNav || 'en';
  if (setLocale(want) && catalogs.has(want)) return want;
  const base = want.toLowerCase().split('-')[0];
  if (catalogs.has(base)) {
    setLocale(base);
    return base;
  }
  setLocale('en');
  return 'en';
}
