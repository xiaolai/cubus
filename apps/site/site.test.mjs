// What the introduction site claims, held to the files that make the claim true.
//
// The site is a static page and a folder of pictures, and each of these is a way it goes wrong
// while still looking fine on the developer's machine: a screenshot the page names that nobody
// regenerated, a copied stylesheet that drifted from the app's, an image loaded from a third
// party, a workflow that quietly publishes the wrong folder. Every test here fails when one of
// those stops being true.
//
// Plain Node on purpose — files and image headers, nothing from node_modules — so the deploy
// workflow can run it on a bare checkout, and a missing install cannot become a skipped gate.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { OG, SCALE, SHOTS, WINDOWS, pixels } from './scripts/shots.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, 'public');
const WEB = resolve(here, '../web');
const ROOT = resolve(here, '../..');
const WORKFLOW = join(ROOT, '.github/workflows/deploy-site.yml');

const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');

/** Every `<tag …>` in the page as `{ tag, attrs }`, attribute values unquoted. */
function tags(source) {
  const out = [];
  for (const m of source.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
    out.push({ tag: m[1].toLowerCase(), attrs });
  }
  return out;
}
const TAGS = tags(html);
const imgs = TAGS.filter((t) => t.tag === 'img');
const shotImgs = imgs.filter((t) => t.attrs.src.startsWith('./screenshots/'));

/** Pixel size of a WebP (VP8, VP8L or VP8X) or a PNG, read from its header. */
function imageSize(path) {
  const b = readFileSync(path);
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    assert.equal(b.subarray(12, 16).toString('latin1'), 'IHDR', `${path}: PNG without IHDR first`);
    return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  assert.equal(b.subarray(0, 4).toString('latin1'), 'RIFF', `${path}: not RIFF`);
  assert.equal(b.subarray(8, 12).toString('latin1'), 'WEBP', `${path}: not WebP`);
  const chunk = b.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8 ') {
    assert.deepEqual([...b.subarray(23, 26)], [0x9d, 0x01, 0x2a], `${path}: VP8 frame without its start code`);
    return { format: 'webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    assert.equal(b[20], 0x2f, `${path}: VP8L without its signature byte`);
    const bits = b.readUInt32LE(21);
    return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return { format: 'webp', width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  }
  assert.fail(`${path}: unknown WebP chunk ${JSON.stringify(chunk)}`);
}

// ---- the domain ------------------------------------------------------------------------------

test('public/CNAME names cubus.im and nothing else', () => {
  assert.equal(readFileSync(join(PUBLIC, 'CNAME'), 'utf8'), 'cubus.im\n');
});

// ---- what the page loads ---------------------------------------------------------------------

// A <link> either fetches (a stylesheet, an icon) or merely names (canonical). The first kind
// must point inside public/; the second kind is a URL by nature. A rel outside both lists is a
// link this test has not thought about, and fails rather than passes.
const FETCHING_REL = new Set(['stylesheet', 'icon', 'apple-touch-icon', 'manifest', 'preload', 'modulepreload', 'prefetch']);
const NAMING_REL = new Set(['canonical']);

test('the page loads nothing remote and runs no script', () => {
  assert.equal(TAGS.filter((t) => t.tag === 'script').length, 0, 'a <script> on the introduction page');
  for (const t of TAGS) {
    if (t.tag === 'link' && NAMING_REL.has(t.attrs.rel)) continue;
    if (t.tag === 'link') assert.ok(FETCHING_REL.has(t.attrs.rel), `<link rel="${t.attrs.rel}"> — does it fetch? Say so in the lists above`);
    const src = t.attrs.src ?? (t.tag === 'link' ? t.attrs.href : undefined);
    if (src === undefined) continue;
    assert.match(src, /^\.\//, `<${t.tag}> loads ${src}: only ./ paths inside public/ are allowed`);
    assert.ok(!src.includes('..'), `<${t.tag}> reaches outside public/: ${src}`);
    assert.ok(existsSync(join(PUBLIC, src)), `<${t.tag}> names ${src}, which is not in public/`);
  }
  // Nothing fetched from a stylesheet either: the app's tokens carry no url(), and the page's
  // own style must not start.
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  assert.ok(!/url\(|@import/.test(style), 'the inline style loads something');
  assert.ok(!/url\(|@import/.test(readFileSync(join(PUBLIC, 'tokens.css'), 'utf8')), 'tokens.css loads something');
});

test('every link off the site is https, and external ones open safely', () => {
  for (const t of TAGS.filter((x) => x.tag === 'a')) {
    const href = t.attrs.href;
    assert.ok(href, 'an <a> with no href');
    if (href.startsWith('#') || href.startsWith('./')) continue;
    assert.match(href, /^https:\/\//, `link is not https: ${href}`);
    assert.equal(t.attrs.rel, 'noopener', `external link without rel="noopener": ${href}`);
  }
});

test('the page is a document: lang, title, description, viewport, canonical', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>Cubus — [^<]+<\/title>/);
  const meta = (name) => TAGS.find((t) => t.tag === 'meta' && (t.attrs.name === name || t.attrs.property === name))?.attrs.content;
  assert.ok(meta('description')?.length > 80, 'a meta description worth reading');
  assert.ok(meta('viewport'), 'no viewport');
  assert.equal(TAGS.find((t) => t.tag === 'link' && t.attrs.rel === 'canonical')?.attrs.href, 'https://cubus.im/');
});

// ---- the pictures ----------------------------------------------------------------------------

test('every shot in shots.mjs is on the page, on disk, and the size the capture script produces', () => {
  for (const shot of SHOTS) {
    const file = join(PUBLIC, 'screenshots', `${shot.name}.webp`);
    assert.ok(existsSync(file), `missing screenshots/${shot.name}.webp — run pnpm --filter cubus-site screenshots`);
    const size = imageSize(file);
    assert.equal(size.format, 'webp', `${shot.name} is not a WebP`);
    assert.deepEqual({ width: size.width, height: size.height }, pixels(shot), `${shot.name}.webp is not the ${shot.window} window at ${SCALE}×`);
    const img = shotImgs.find((t) => t.attrs.src === `./screenshots/${shot.name}.webp`);
    assert.ok(img, `the page does not show ${shot.name}.webp`);
    // Intrinsic size in CSS pixels, so the layout is reserved before the picture arrives and
    // the aspect the browser reserves is the aspect the file has.
    assert.equal(Number(img.attrs.width), WINDOWS[shot.window].width, `${shot.name}: width attribute`);
    assert.equal(Number(img.attrs.height), WINDOWS[shot.window].height, `${shot.name}: height attribute`);
    assert.ok(img.attrs.alt?.length > 40, `${shot.name}: alt text that says what is in the picture`);
  }
});

test('the page shows no picture the capture script does not produce, and the folder holds no strays', () => {
  const produced = new Set([...SHOTS.map((s) => `${s.name}.webp`), `${OG.name}.png`]);
  for (const img of shotImgs) {
    assert.ok(produced.has(img.attrs.src.replace('./screenshots/', '')), `${img.attrs.src} is not a shot capture-screenshots.mjs makes`);
  }
  for (const f of readdirSync(join(PUBLIC, 'screenshots'))) {
    assert.ok(produced.has(f), `screenshots/${f} is not produced by the capture script`);
  }
});

test('every image has alt text; decorative ones say so with an empty alt', () => {
  for (const img of imgs) assert.ok('alt' in img.attrs, `<img src="${img.attrs.src}"> has no alt attribute`);
});

test('the social card is the 1× PNG the capture script writes, and the og tags describe it', () => {
  const file = join(PUBLIC, 'screenshots', `${OG.name}.png`);
  assert.ok(existsSync(file), `missing screenshots/${OG.name}.png`);
  const size = imageSize(file);
  const expect = pixels({ window: OG.window, scale: 1 });
  assert.equal(size.format, 'png');
  assert.deepEqual({ width: size.width, height: size.height }, expect);
  const og = (p) => TAGS.find((t) => t.tag === 'meta' && t.attrs.property === p)?.attrs.content;
  assert.equal(og('og:image'), `https://cubus.im/screenshots/${OG.name}.png`);
  assert.equal(Number(og('og:image:width')), expect.width);
  assert.equal(Number(og('og:image:height')), expect.height);
});

// ---- the copies ------------------------------------------------------------------------------

test('tokens.css and the icons are the app’s own, byte for byte', () => {
  const same = (a, b) => assert.ok(readFileSync(a).equals(readFileSync(b)), `${a} differs from ${b} — copy it again`);
  same(join(PUBLIC, 'tokens.css'), join(WEB, 'tokens.css'));
  for (const f of readdirSync(join(PUBLIC, 'icons'))) same(join(PUBLIC, 'icons', f), join(WEB, 'icons', f));
});

// ---- what the page says ----------------------------------------------------------------------

test('the download section points at the release page and the Homebrew cask by their real names', () => {
  assert.ok(html.includes('https://github.com/xiaolai/cubus/releases/latest'), 'the latest-release link');
  assert.ok(html.includes('brew install --cask xiaolai/tap/cubus'), 'the cask install line');
  assert.ok(html.includes('https://github.com/xiaolai/cubus/blob/main/PRIVACY.md'), 'the privacy statement link');
});

test('the page does not promise what does not ship', () => {
  // The web app is not hosted and the phones are not shipped (README.md); the page says so and
  // offers no store, no TestFlight, no "open in browser".
  assert.match(html, /The web app is not hosted yet/);
  assert.match(html, /not shipped/);
  for (const forbidden of ['apps.apple.com', 'play.google.com', 'testflight', 'Open in browser', 'Launch the app']) {
    assert.ok(!html.toLowerCase().includes(forbidden.toLowerCase()), `the page mentions ${forbidden}`);
  }
});

// ---- the workflow ----------------------------------------------------------------------------

test('deploy-site.yml publishes public/ from main, checks first, and pins every action', () => {
  const wf = readFileSync(WORKFLOW, 'utf8');
  assert.match(wf, /push:\n\s+branches: \[main\]\n\s+paths:\n\s+- 'apps\/site\/\*\*'\n\s+- '\.github\/workflows\/deploy-site\.yml'/);
  assert.match(wf, /pull_request:\n\s+branches: \[main\]\n\s+paths:\n\s+- 'apps\/site\/\*\*'/);
  assert.match(wf, /run: node --test apps\/site\/site\.test\.mjs/);
  assert.match(wf, /path: apps\/site\/public/);
  assert.match(wf, /if: github\.event_name != 'pull_request'\n\s+needs: check/, 'the deploy job waits for the check and skips pull requests');
  assert.match(wf, /^permissions:\n  contents: read$/m, 'read-only by default');
  for (const m of wf.matchAll(/uses: (\S+)/g)) {
    assert.match(m[1], /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `unpinned action: ${m[1]}`);
  }
});

test('the site’s package runs this file as its check, so pnpm check covers it', () => {
  const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.check, 'node --test site.test.mjs');
  assert.equal(pkg.scripts['check:fast'], 'node --test site.test.mjs');
});

// ---- the DNS -------------------------------------------------------------------------------

test('cubus.im.zone holds exactly GitHub Pages’ records, every one DNS-only', () => {
  // GitHub's published Pages addresses (docs: "Managing a custom domain for your GitHub Pages
  // site"). A zone file that named anything else would point the domain somewhere the site is not.
  const A = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];
  const AAAA = ['2606:50c0:8000::153', '2606:50c0:8001::153', '2606:50c0:8002::153', '2606:50c0:8003::153'];
  const zone = readFileSync(join(here, 'cubus.im.zone'), 'utf8');
  const records = zone.split('\n').filter((l) => l && !l.startsWith(';') && !l.startsWith('$'))
    .map((l) => {
      const m = l.match(/^(\S+)\t1\tIN\t(A|AAAA|CNAME)\t(\S+) ; cf_tags=cf-proxied:false$/);
      assert.ok(m, `a record that is not DNS-only, or not in the one shape the importer is given: ${l}`);
      return { name: m[1], type: m[2], data: m[3] };
    });
  assert.deepEqual(records.filter((r) => r.type === 'A').map((r) => r.data), A);
  assert.deepEqual(records.filter((r) => r.type === 'AAAA').map((r) => r.data), AAAA);
  assert.deepEqual(records.filter((r) => r.type === 'CNAME'), [{ name: 'www.cubus.im.', type: 'CNAME', data: 'xiaolai.github.io.' }]);
  for (const r of records.filter((x) => x.type !== 'CNAME')) assert.equal(r.name, 'cubus.im.', `an address record on ${r.name}`);
  assert.equal(records.length, A.length + AAAA.length + 1, 'a record the lists above do not account for');
  assert.match(zone, /^\$ORIGIN cubus\.im\.$/m);
});

test('README names the site and the workflow that publishes it', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.ok(readme.includes('apps/site/'), 'README does not mention apps/site/');
  assert.ok(readme.includes('deploy-site.yml'), 'README does not name the deploy workflow');
});
