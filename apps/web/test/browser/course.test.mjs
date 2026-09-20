// The Course screen in a real engine: what it shows with no course, and what it never does.
//
// The case that matters most here is the one about the TOOLBAR. ADR 0006 decision 3 forbids "has
// the course" from becoming an axis every screen answers, and the amendment in revision 3 keeps the
// tab hidden by default — a FIXED default, which is the whole distinction. So the assertion is not
// "the tab is hidden": it is that the toolbar is **identical** with a course installed and without
// one. A screen that started showing its tab once a course appeared would pass a hidden-by-default
// check and still be the mode this record forbids.
//
// It fails loudly without the browser: `pnpm exec playwright install webkit` (CI does this).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { pace } from '../browser-wait.mjs';
import { startBrowserFixture } from './harness.mjs';

let fixture;
/** Every context this suite opened, closed whatever happened — see `open`. */
const contexts = [];
before(async () => { fixture = await startBrowserFixture(); }, { timeout: 120_000 });
after(async () => {
  await Promise.allSettled(contexts.map((c) => c.close()));
  await fixture?.close();
});

/**
 * An episode with two cues and a section — a real document, so `checkLesson` accepts it.
 *
 * Its audio is a RELATIVE reference to a real, decodable file the dev server serves. It used to be
 * `/test-lesson.m4a`: absolute, therefore refused by `courseAudioRef`, therefore `playable: false`
 * — so every case below that believed it was exercising a playing lesson was in fact exercising the
 * disabled, audio-less screen, and would have passed with the transport entirely broken.
 */
const EPISODE = {
  audio: 'test/fixtures/silence.wav',
  cues: [
    { say: 'line 0', start: 0, end: 4, section: 'section at 0' },
    { say: 'line 1', start: 4.5, end: 9 },
  ],
};

/** The same lesson with no audio beside it: the screen must say so rather than offer dead controls. */
const SILENT = { cues: [{ say: 'line 0', start: 0, end: 4 }] };

/**
 * Open the app, optionally installing a course first.
 *
 * The source is installed through `useCourse` — the same seam a delivery mechanism would use —
 * BEFORE the Course screen is navigated to, because a screen builds its session on mount.
 */
async function open({ entries = null, docs = {} } = {}) {
  const context = await fixture.browser.newContext({ viewport: { width: 1024, height: 768 } });
  // Registered BEFORE anything can fail: a context closed only on the success path leaks a browser
  // context per failed assertion, and they accumulate until the whole suite tears down.
  contexts.push(context);
  const page = await context.newPage();
  pace(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.goto(`${fixture.base}/#/home`);
  await page.waitForSelector('.screen.active');

  if (entries) {
    await page.evaluate(async ({ list, documents }) => {
      const [{ useCourse }, { createCourseSource }] = await Promise.all([
        import('/lib/course-session.js'),
        import('/lib/course-source.js'),
      ]);
      useCourse(createCourseSource({
        list: async () => list,
        read: async (id) => documents[id] ?? null,
      }));
    }, { list: entries, documents: docs });
  }
  return { page, context, errors };
}

/** Go to the Course screen and wait for it to be the one on show. */
async function toCourse(page) {
  await page.evaluate(() => { window.location.hash = '#/course'; });
  await page.waitForFunction(() => document.querySelector('#courseCol') !== null);
  // The session loads its catalogue asynchronously; wait for the load to have settled rather than
  // for a fixed time, so a slow machine does not read a half-painted column.
  await page.waitForFunction(() => {
    const col = document.querySelector('#courseCol');
    return col !== null && !col.textContent.includes('Looking');
  });
}

test('with no course installed the screen exists and says so', async () => {
  const { page, context, errors } = await open();
  await toCourse(page);

  const text = await page.textContent('#courseCol');
  assert.match(text, /NO COURSE INSTALLED/);
  // It says what is true and what still works — and it does not apologise or promise.
  assert.match(text, /not part of the app/);
  assert.doesNotMatch(text, /sorry|coming soon|will be available/i);
  // The screen is REACHED, not redirected away from: a course-less build must not lose the screen.
  assert.equal(await page.evaluate(() => window.location.hash), '#/course');
  assert.deepEqual(errors.map(String), []);
  await context.close();
});

test('the toolbar is identical with a course and without one', async () => {
  const bare = await open();
  await toCourse(bare.page);
  const withoutCourse = await bare.page.$$eval('[data-nav]', (bs) => bs.map((b) => b.dataset.nav));
  await bare.context.close();

  const full = await open({ entries: [{ id: 'a-lesson', title: 'A lesson' }], docs: { 'a-lesson': EPISODE } });
  await toCourse(full.page);
  const withCourse = await full.page.$$eval('[data-nav]', (bs) => bs.map((b) => b.dataset.nav));
  await full.context.close();

  // THE MODE TEST. Not "course is hidden" — identical. A toolbar that grew a tab when a course
  // appeared would be nav visibility consulting the catalogue, which is the axis ADR 0006 forbids.
  assert.deepEqual(withCourse, withoutCourse);
  assert.ok(!withoutCourse.includes('course'), 'the Course tab is hidden by default, like Trainer and Drill');
});

test('a course on the shelf is listed, and an episode opens into the player', async () => {
  const { page, context, errors } = await open({
    entries: [{ id: 'a-lesson', title: 'A lesson' }, { id: 'b-lesson', title: 'Another' }],
    docs: { 'a-lesson': EPISODE },
  });
  await toCourse(page);

  assert.match(await page.textContent('#courseCol'), /A lesson/);
  await page.click('[data-open="a-lesson"]');
  await page.waitForFunction(() => document.querySelector('#epBack') !== null);

  // The lesson composition, not the shelf: a locked cube, and a transport under it.
  assert.equal(await page.$$eval('.primary #episodeCube', (e) => e.length), 1);
  assert.equal(await page.$$eval('.aux .transport', (e) => e.length), 1);
  assert.ok(await page.$('#epPlay'), 'there is a play control');
  assert.deepEqual(errors.map(String), []);
  await context.close();
});

test('a lesson is playable, and does not start talking because it was opened', async () => {
  const { page, context } = await open({
    entries: [{ id: 'a-lesson', title: 'A lesson' }],
    docs: { 'a-lesson': EPISODE },
  });
  await toCourse(page);
  await page.click('[data-open="a-lesson"]');
  await page.waitForFunction(() => document.querySelector('#epBack') !== null);

  // PLAYABLE, first. Without this the rest of the case is about a disabled screen — which is
  // exactly what it used to be, because the fixture's audio reference was refused.
  assert.equal(await page.$eval('#epPlay', (b) => b.disabled), false, 'Play is disabled — the audio reference was refused');
  assert.doesNotMatch(await page.textContent('.aside'), /no audio with it/);

  // THE REAL ELEMENT, counted. This assertion used to read `document.querySelectorAll('audio')`
  // while the screen kept its element detached — so the list was empty and `[].every(...)` was
  // vacuously true. Adding autoplay would have passed. The element is attached now, so the obvious
  // question can actually be asked.
  const media = await page.$$eval('audio', (els) => els.map((a) => ({
    paused: a.paused, autoplay: a.autoplay, src: a.getAttribute('src'), muted: a.muted,
  })));
  assert.equal(media.length, 1, `expected exactly one media element, found ${media.length}`);
  assert.equal(media[0].paused, true, 'the lesson started talking on its own');
  assert.equal(media[0].autoplay, false, 'the element carries autoplay');
  assert.match(media[0].src, /silence\.wav$/, 'the element was handed a different source');

  // And it really loaded: a duration the screen could not know without the media arriving.
  await page.waitForFunction(() => {
    const a = document.querySelector('audio');
    return a && Number.isFinite(a.duration) && a.duration > 0;
  }, { timeout: 15_000 });
  assert.match(await page.textContent('#epTime'), /0:0\d \/ 0:0\d/, 'the total never arrived from metadata');
  await context.close();
});

test('captions are off until they are asked for, and the cube is not resized by them', async () => {
  const { page, context } = await open({
    entries: [{ id: 'a-lesson', title: 'A lesson' }],
    docs: { 'a-lesson': EPISODE },
  });
  await toCourse(page);
  await page.click('[data-open="a-lesson"]');
  await page.waitForFunction(() => document.querySelector('#epCaptions') !== null);

  // Reading must never be required to proceed — so text starts hidden and is a deliberate ask.
  assert.equal(await page.$eval('#epCaptionBox', (e) => e.hidden), true);
  assert.equal(await page.$eval('#epCaptions', (e) => e.getAttribute('aria-pressed')), 'false');

  const before = await page.$eval('#episodeCube', (e) => e.getBoundingClientRect().width);
  await page.click('#epCaptions');
  await page.waitForFunction(() => document.querySelector('#epCaptionBox')?.hidden === false);
  const after = await page.$eval('#episodeCube', (e) => e.getBoundingClientRect().width);
  assert.equal(after, before, 'turning captions on resized the cube');
  await context.close();
});

test('sections are offered collapsed, not as a menu to answer first', async () => {
  const { page, context } = await open({
    entries: [{ id: 'a-lesson', title: 'A lesson' }],
    docs: { 'a-lesson': EPISODE },
  });
  await toCourse(page);
  await page.click('[data-open="a-lesson"]');
  await page.waitForFunction(() => document.querySelector('#sectionsBox') !== null);

  assert.equal(await page.$eval('#sectionsBox', (e) => e.open), false, 'sections started open');
  assert.equal(await page.$$eval('[data-seek]', (bs) => bs.length), 1, 'the episode has one section');
  await context.close();
});

test('a lesson with no audio says so rather than offering dead controls', async () => {
  const { page, context } = await open({
    entries: [{ id: 'a-lesson', title: 'A lesson' }],
    docs: { 'a-lesson': SILENT },
  });
  await toCourse(page);
  await page.click('[data-open="a-lesson"]');
  await page.waitForFunction(() => document.querySelector('#epBack') !== null);

  assert.equal(await page.$eval('#epPlay', (e) => e.disabled), true);
  assert.match(await page.textContent('.aside'), /no audio with it/);
  await context.close();
});

test('an episode the course cannot open is refused ON THE SCREEN, and the shelf survives', async () => {
  // THROUGH THE MOUNTED SCREEN. This used to build a session of its own with no listener and read
  // its view object — so the refusal never reached the DOM, and deleting the screen's refusal
  // rendering entirely would have left the case green.
  const { page, context } = await open({
    entries: [{ id: 'a-lesson', title: 'A lesson' }, { id: 'gone-lesson', title: 'A missing lesson' }],
    docs: { 'a-lesson': EPISODE }, // `gone-lesson` has no document
  });
  await toCourse(page);
  await page.click('[data-open="gone-lesson"]');
  await page.waitForFunction(() => /DID NOT OPEN/.test(document.querySelector('#courseCol')?.textContent ?? ''));

  const col = await page.textContent('#courseCol');
  assert.match(col, /not in this course/, 'the screen does not say what went wrong');
  assert.match(col, /A lesson/, 'the shelf was lost along with the refusal');
  assert.equal(await page.$$eval('[data-open]', (bs) => bs.length), 2, 'the other lessons are still openable');
  assert.equal(await page.evaluate(() => window.location.hash), '#/course', 'it fell through to another screen');
  await context.close();
});

test('a lesson that will not validate names the cue, on the screen', async () => {
  const { page, context } = await open({
    entries: [{ id: 'bad-lesson', title: 'A broken lesson' }],
    docs: { 'bad-lesson': { cues: [{ say: 'line 0', start: 5, end: 1 }] } },
  });
  await toCourse(page);
  await page.click('[data-open="bad-lesson"]');
  await page.waitForFunction(() => /DID NOT OPEN/.test(document.querySelector('#courseCol')?.textContent ?? ''));

  // The validator's own words reach the person, because "invalid lesson" is not actionable.
  assert.match(await page.textContent('#courseCol'), /episode cue 0/);
  await context.close();
});

test('a lesson RETURNED TO is the same lesson, at the same place', async () => {
  // The old version of this navigated away and stopped, so a broken remount — or one that simply
  // restarted the lesson from zero — would have passed. Coming back is the half that matters.
  const { page, context } = await open({
    entries: [{ id: 'a-lesson', title: 'A lesson' }],
    docs: { 'a-lesson': EPISODE },
  });
  await toCourse(page);
  await page.click('[data-open="a-lesson"]');
  await page.waitForFunction(() => document.querySelector('#epBack') !== null);
  await page.waitForFunction(() => {
    const a = document.querySelector('audio');
    return a && Number.isFinite(a.duration) && a.duration > 0;
  }, { timeout: 15_000 });

  // Put it part-way through, the way a scrubber would.
  await page.evaluate(() => { document.querySelector('audio').currentTime = 0.5; });
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await page.waitForFunction(() => document.querySelector('#epBack') === null);

  await page.evaluate(() => { window.location.hash = '#/course'; });
  await page.waitForFunction(() => document.querySelector('#epBack') !== null);

  const back = await page.$$eval('audio', (els) => els.map((a) => ({ at: a.currentTime, src: a.getAttribute('src') })));
  assert.equal(back.length, 1, 'returning built a second media element');
  assert.ok(back[0].at >= 0.4, `the lesson restarted: came back at ${back[0].at}`);
  assert.equal(await page.evaluate(async () => (await import('/lib/app-state.js')).state.episode), 'a-lesson');
  await context.close();
});

test('text a course document supplies is drawn as text, never as markup', async () => {
  // The new rendering boundary had no hostile coverage at all: titles, section labels and refusal
  // detail were only ever tested with harmless strings, so removing the escaping would not have
  // failed anything here.
  const nasty = '<img src=x onerror="window.__pwned=1">';
  const { page, context, errors } = await open({
    entries: [{ id: 'a-lesson', title: `Lesson ${nasty}` }],
    docs: {
      'a-lesson': {
        audio: 'test/fixtures/silence.wav',
        cues: [{ say: 'line 0', start: 0, end: 4, section: `Part ${nasty}` }],
      },
    },
  });
  await toCourse(page);
  assert.match(await page.textContent('#courseCol'), /onerror/, 'the hostile title is not shown as text');
  assert.equal(await page.$$eval('#courseCol img', (els) => els.length), 0, 'the shelf built an element from it');

  await page.click('[data-open="a-lesson"]');
  await page.waitForFunction(() => document.querySelector('#epBack') !== null);
  assert.equal(await page.$$eval('.aside img', (els) => els.length), 0, 'the lesson screen built an element from it');
  assert.match(await page.textContent('.aside'), /onerror/, 'the hostile section label is not shown as text');
  assert.equal(await page.evaluate(() => window.__pwned), undefined, 'injected script ran');
  assert.deepEqual(errors.map(String), []);
  await context.close();
});

test('the open episode survives the load that follows it', async () => {
  const { page, context } = await open({
    entries: [{ id: 'a-lesson', title: 'A lesson' }],
    docs: { 'a-lesson': EPISODE },
  });
  await toCourse(page);
  await page.click('[data-open="a-lesson"]');
  await page.waitForFunction(() => document.querySelector('#epBack') !== null);

  // A rebuild of the screen — which is what any navigation back to it does — must find the
  // episode still open, because the id lives in app state rather than in the screen's closure.
  await page.evaluate(() => { window.location.hash = '#/home'; });
  await page.waitForFunction(() => document.querySelector('#courseCol') === null);
  const stillOpen = await page.evaluate(async () => (await import('/lib/app-state.js')).state.episode);
  assert.equal(stillOpen, 'a-lesson');
  await context.close();
});

test('going back to the shelf clears what was showing', async () => {
  const { page, context } = await open({
    entries: [{ id: 'a-lesson', title: 'A lesson' }],
    docs: { 'a-lesson': EPISODE },
  });
  await toCourse(page);
  await page.click('[data-open="a-lesson"]');
  await page.waitForFunction(() => document.querySelector('#epBack') !== null);
  await page.click('#epBack');
  await page.waitForFunction(() => document.querySelector('[data-open="a-lesson"]') !== null);

  assert.equal(await page.evaluate(async () => (await import('/lib/app-state.js')).state.episode), null);
  await context.close();
});
