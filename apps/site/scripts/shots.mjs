// What the site's screenshots ARE — shared by the script that takes them and the test that
// checks them, and importable by plain Node: the capture script needs Playwright, the test must
// not, and a list that lived in the script would drag the browser driver into a test that only
// measures image headers.
//
// Every picture is the desktop window at one of its two reference shapes, at 2×
// (dev-docs/stage-contract.md; capture-screenshots.mjs says why). `scheme` is the OS appearance
// the app is asked to follow — its default Auto theme answers White in light, Night in dark.

/** The desktop window's two reference shapes, as the app opens on a 2560×1410 work area. */
export const WINDOWS = Object.freeze({
  landscape: Object.freeze({ width: 1280, height: 1012 }),
  portrait: Object.freeze({ width: 900, height: 1252 }),
});

/** Device pixels per CSS pixel: the pictures are as crisp as a Retina screen. */
export const SCALE = 2;

/** The pictures, in the order the page tells the story. The `.webp` name is `<name>.webp`. */
export const SHOTS = Object.freeze([
  { name: 'home-landscape', screen: 'home', window: 'landscape', scheme: 'light' },
  { name: 'walk-landscape', screen: 'home', window: 'landscape', scheme: 'light' },
  { name: 'walk-portrait-night', screen: 'home', window: 'portrait', scheme: 'dark' },
  { name: 'scramble-portrait', screen: 'scramble', window: 'portrait', scheme: 'light' },
  { name: 'scan-landscape', screen: 'scan', window: 'landscape', scheme: 'light' },
]);

/** The social-card image: the Home shot again, as a 1× PNG — the platforms that read
 *  `og:image` do not all read WebP, and 1280 wide is what they ask for. */
export const OG = Object.freeze({ name: 'og', window: 'landscape' });

/** The pixel size a shot's file must have. */
export const pixels = ({ window, scale = SCALE }) => ({
  width: WINDOWS[window].width * scale,
  height: WINDOWS[window].height * scale,
});
