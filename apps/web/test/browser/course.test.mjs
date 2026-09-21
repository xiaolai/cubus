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

/** One second of real audio with two captioned sections, for driving the transport through the screen. */
const TRANSPORT = {
  audio: 'test/fixtures/silence.wav',
  cues: [
    { say: 'line 0', start: 0, end: 0.4, section: 'the start' },
    { say: 'line 1', start: 0.5, end: 0.9, section: 'later on' },
  ],
};

test("the episode's transport is wired through the screen: scrub, sections, Play and Pause, and leaving mid-play", async () => {
  // The transport's parts were tested apart -- the audio adapter on its own, the binder over fakes -- and
  // never through the mounted screen, where a wrong id or a handler bound to the wrong element is invisible
  // to both (audit, 2026-09-21). Every control here is the real one, on the real element, in the engine.
  const { page, context, errors } = await open({ entries: [{ id: 'wired', title: 'Wired' }], docs: { wired: TRANSPORT } });
  await toCourse(page);
  await page.click('[data-open="wired"]');
  await page.waitForFunction(() => {
    const a = document.querySelector('audio');
    return a && Number.isFinite(a.duration) && a.duration > 0;
  }, { timeout: 15_000 });
  const audio = () => page.$eval('audio', (a) => ({ at: a.currentTime, paused: a.paused, ended: a.ended }));
  await page.click('#epCaptions');

  // The scrubber seeks, while paused, and the caption follows the place it was moved to.
  await page.$eval('#epScrub', (s) => {
    s.value = '600';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const scrubbed = await audio();
  assert.ok(Math.abs(scrubbed.at - 0.6) < 0.05, `the scrubber did not seek: at ${scrubbed.at}`);
  assert.equal(scrubbed.paused, true, 'scrubbing started playback');
  await page.waitForFunction(() => document.querySelector('#epCaption')?.textContent === 'line 1');

  // A section jumps there and keeps the lesson stopped when it was stopped.
  await page.click('#sectionsBox summary');
  await page.click('[data-seek="0"]');
  const jumped = await audio();
  assert.ok(jumped.at < 0.05, `the section did not jump to its start: at ${jumped.at}`);
  assert.equal(jumped.paused, true, 'a section press started playback');
  await page.waitForFunction(() => document.querySelector('#epCaption')?.textContent === 'line 0');

  // Play plays and Pause pauses, and the control says which it is -- to a screen reader and in its tooltip.
  await page.click('#epPlay');
  await page.waitForFunction(() => document.querySelector('audio')?.paused === false);
  assert.equal(await page.$eval('#epPlay', (b) => b.getAttribute('aria-label')), 'Pause the lesson');
  assert.equal(await page.$eval('#epPlay', (b) => b.getAttribute('title')), 'Pause the lesson');
  await page.click('#epPlay');
  await page.waitForFunction(() => document.querySelector('audio')?.paused === true);
  // PAUSED, not finished: a clip that played to its end is paused too, so a Pause that did nothing passed.
  assert.equal((await audio()).ended, false, 'Pause did not pause -- the clip ran to its end');
  await page.waitForFunction(() => document.querySelector('#epPlay')?.getAttribute('title') === 'Play the lesson');

  // Leaving while a play is starting stops it, and says nothing to a screen that has gone.
  await page.click('#epPlay');
  await page.click('#epBack');
  await page.waitForFunction(() => document.querySelector('[data-open="wired"]') !== null);
  const left = await page.$$eval('audio', (els) => els.map((a) => a.paused));
  assert.ok(left.every(Boolean), 'a recording went on playing after the lesson was left');
  assert.deepEqual(errors.map(String), []);
  await context.close();
});

test('a play that answers late, through the mounted screen: a refusal explained, a stale one dropped, and nothing said after leaving', async () => {
  // The transport's generations were tested over fakes (lesson-views.test.mjs); this is the same question
  // asked of the real screen, with the media element's own `play()` answering when the test says.
  const { page, context, errors } = await open({ entries: [{ id: 'late', title: 'Late' }], docs: { late: TRANSPORT } });
  await toCourse(page);
  await page.click('[data-open="late"]');
  await page.waitForFunction(() => document.querySelector('#epPlay') !== null && !document.querySelector('#epPlay').disabled);
  await page.evaluate(() => {
    window.__plays = [];
    HTMLMediaElement.prototype.play = function play() { return new Promise((resolve, reject) => window.__plays.push({ resolve, reject })); };
    window.__refuse = (i) => window.__plays[i].reject(new DOMException('refused by the test', 'NotAllowedError'));
  });
  const notice = () => page.$eval('#epNotice', (n) => (n.hidden ? '' : n.textContent.trim()));
  const settle = () => page.evaluate(() => new Promise((r) => setTimeout(r, 50)));

  // A refusal that arrives late is still explained.
  await page.click('#epPlay');
  await page.evaluate(() => window.__refuse(0));
  await page.waitForFunction(() => document.querySelector('#epNotice')?.hidden === false);
  assert.match(await notice(), /would not start the sound/);

  // A second press while the first is unanswered: the newer one succeeds, the older one's refusal comes
  // after it, and the screen does not believe the older one.
  await page.click('#epPlay');           // request 1
  await page.click('#epPlay');           // request 2, before 1 answered
  assert.equal(await notice(), '', 'a new press did not clear the old notice');
  await page.evaluate(() => { window.__plays[2].resolve(); window.__refuse(1); });
  await settle();
  assert.equal(await notice(), '', "an older press's late refusal overwrote a newer press that worked");

  // Leaving while a play is unanswered: its refusal, arriving after, reaches nothing — not the screen now
  // showing, and not the one that was left. The old notice is KEPT, detached, so the second half can be asked:
  // with the mount's `transport.invalidate()` removed, only a retained element shows the refusal still arriving
  // (verify pass, 2026-09-21).
  await page.evaluate(() => {
    const n = document.querySelector('#epNotice');
    n.hidden = true;
    n.querySelector('#epNoticeText').textContent = '';
    window.__leftNotice = n;
  });
  await page.click('#epPlay');
  await page.click('#epBack');
  await page.waitForFunction(() => document.querySelector('[data-open="late"]') !== null);
  await page.evaluate(() => window.__refuse(window.__plays.length - 1));
  await settle();
  assert.equal(await page.$('#epNotice'), null, 'the lesson screen came back');
  assert.doesNotMatch(await page.textContent('#stage'), /would not start/, 'a refusal from a lesson that was left reached the shelf');
  assert.deepEqual(
    await page.evaluate(() => ({ hidden: window.__leftNotice.hidden, text: window.__leftNotice.textContent.trim() })),
    { hidden: true, text: '' },
    'a refusal from a lesson that was left was still delivered to its screen',
  );
  assert.deepEqual(errors.map(String), []);
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

// ---- Script lessons (ADR 0007) ------------------------------------------------------------------
//
// A script is played a STEP at a time, each step as long as its own recording. The recordings here are
// the one-second silent fixture the episode cases use, so a step really plays to its end in the engine
// and the lesson really moves on because the media said `ended` — not because a test said so.

const CLIP = 'test/fixtures/silence.wav';
const SCRIPT = {
  schema: 2,
  start: { scramble: "R U R' U'" },
  steps: [
    { section: 'part 0', say: 'line 0', voice: CLIP },
    { move: 'R', say: 'line 1', voice: CLIP },
    { move: 'U', yours: true, say: 'line 2', voice: CLIP },
    { round: { say: 'line 3', voice: CLIP, ask: 'whereIs:UF', choose: 2 } },
    { say: 'line 4', voice: 'missing/not-recorded.wav' },
  ],
};

/** Open a script lesson from the shelf, and wait for its controls. */
async function openScript(docs = { 'a-script': SCRIPT }) {
  const opened = await open({ entries: [{ id: 'a-script', title: 'A script lesson' }], docs });
  await toCourse(opened.page);
  await opened.page.click('[data-open="a-script"]');
  await opened.page.waitForFunction(() => document.querySelector('#slLeave') !== null);
  return opened;
}

const visible = (page, sel) => page.waitForFunction((s) => {
  const el = document.querySelector(s);
  return el !== null && !el.hidden;
}, sel, { timeout: 20_000 });

test('a script opens into the step player, and does not start talking because it was opened', async () => {
  const { page, context, errors } = await openScript();
  assert.equal(await page.$$eval('.primary #slCube', (e) => e.length), 1, 'the cube is not the primary region');
  assert.ok(await page.$('.aux #slPlay'), 'there is no play control under the cube');
  assert.equal(await page.textContent('#slCount'), '1 / 5');
  const media = await page.$$eval('audio', (els) => els.map((a) => ({ paused: a.paused, autoplay: a.autoplay, src: a.getAttribute('src') })));
  assert.equal(media.length, 1, `expected one media element, found ${media.length}`);
  assert.deepEqual(media[0], { paused: true, autoplay: false, src: null }, 'a recording was asked for before Play');
  assert.equal(await page.$eval('#slAsk', (e) => e.hidden), true);
  assert.equal(await page.$eval('#slYours', (e) => e.hidden), true);
  assert.equal(await page.$eval('#slCaptionBox', (e) => e.hidden), true, 'captions started on');
  assert.deepEqual(errors.map(String), []);
  await context.close();
});

test('a script plays step by step on its recordings, and waits for the child\'s move', async () => {
  const { page, context, errors } = await openScript();
  await page.click('#slPlay');
  // Two one-second steps, played to their ends by the engine, and then the move that is the child's.
  await visible(page, '#slYours');
  assert.equal(await page.textContent('#slCount'), '3 / 5');
  assert.match(await page.textContent('#slStatusBox'), /YOUR TURN/);
  // Waiting, and still waiting: the lesson does not make the child's move for them.
  await page.waitForTimeout(1500);
  assert.equal(await page.textContent('#slCount'), '3 / 5', 'the lesson went on without the child');
  await page.click('#slDone');
  await visible(page, '#slAsk');
  assert.equal(await page.textContent('#slCount'), '4 / 5');
  assert.equal(await page.$eval('[data-face="U"]', (b) => b.disabled), false, 'the faces cannot be picked');
  assert.deepEqual(errors.map(String), []);
  await context.close();
});

test('a smart cube\'s turn makes the child\'s move, and a wrong one is said to be wrong', async () => {
  const { page, context } = await openScript();
  await page.click('#slPlay');
  await visible(page, '#slYours');
  await page.evaluate(() => window.cubusFeed.move({ notation: 'F' }));
  await page.waitForFunction(() => /different turn/.test(document.querySelector('#slStatus')?.textContent ?? ''));
  assert.equal(await page.textContent('#slCount'), '3 / 5', 'a wrong turn let the lesson go on');
  await page.evaluate(() => window.cubusFeed.move({ notation: "F'" }));
  await page.evaluate(() => window.cubusFeed.move({ notation: 'U' }));
  await visible(page, '#slAsk');
  assert.equal(await page.textContent('#slCount'), '4 / 5');
  await context.close();
});

test('a question is answered on the screen, and a recording that is missing is said to be missing', async () => {
  const { page, context } = await openScript();
  // The answer, worked out from the cube the way the round works it out — never written beside it.
  const faces = await page.evaluate(async (doc) => {
    const [{ buildScript }, { answerAt }] = await Promise.all([import('/lib/script-view.js'), import('/lib/script-rounds.js')]);
    const built = buildScript(doc);
    return answerAt(built, built.positions.find((p) => p.step === 3).index).faces;
  }, SCRIPT);
  await page.click('#slPlay');
  await visible(page, '#slYours');
  await page.click('#slDone');
  await visible(page, '#slAsk');
  await page.click(`[data-face="${faces[0]}"]`);
  await page.click(`[data-face="${faces[1]}"]`);
  await page.waitForFunction(() => /That is it/.test(document.querySelector('#slStatus')?.textContent ?? ''));
  // The last step names a file the course does not have. The lesson stops there and says so, naming
  // the step and the file for whoever wrote it — it does not skip past in silence.
  await visible(page, '#slNotice');
  assert.equal(await page.textContent('#slCount'), '5 / 5');
  assert.match(await page.textContent('#slNoticeText'), /may be missing/);
  assert.match(await page.textContent('#slNoticeDetail'), /step 5 · missing\/not-recorded\.wav/);
  await context.close();
});

test('a lesson\'s figure is drawn over its cube, and counts up to itself', async () => {
  // The `number` cue, which the Course screen did not draw until the numbers lesson needed it. In a real
  // engine, over a real cube, with the element's own frames driving the count.
  const { page, context, errors } = await openScript({
    'a-script': {
      schema: 2,
      steps: [
        { say: 'line 0', voice: CLIP, number: '43,252,003,274,489,856,000', counting: true },
        { say: 'line 1', voice: CLIP, number: '20' },
      ],
    },
  });
  assert.equal(await page.$eval('#slNumber', (e) => e.hidden), true, 'a figure was shown before the lesson started');
  await page.click('#slPlay');
  await page.waitForFunction(() => document.querySelector('#slNumber')?.hidden === false);
  // It lands on every digit — the reason the whole thing is held as a BigInt.
  await page.waitForFunction(
    () => document.querySelector('#slNumber')?.textContent === '43,252,003,274,489,856,000',
    null,
    { timeout: 20_000 },
  );
  // Over the cube, inside the primary region, and taking no presses from it.
  const placed = await page.evaluate(() => {
    const n = document.querySelector('#slNumber').getBoundingClientRect();
    const primary = document.querySelector('.primary').getBoundingClientRect();
    return {
      inside: n.top >= primary.top - 1 && n.bottom <= primary.bottom + 1 && n.left >= primary.left - 1 && n.right <= primary.right + 1,
      events: getComputedStyle(document.querySelector('#slNumber')).pointerEvents,
    };
  });
  assert.equal(placed.inside, true, 'the figure is drawn outside the cube\'s own region');
  assert.equal(placed.events, 'none', 'the figure can swallow a press meant for the cube');
  await page.waitForFunction(() => document.querySelector('#slNumber')?.textContent === '20', null, { timeout: 20_000 });
  assert.deepEqual(errors.map(String), []);
  await context.close();
});

test('a lesson can show a picture and a silent clip where the cube is, and give the cube back', async () => {
  // ADR 0007: the parts of a course that are not about a cube — a photograph of the first prototype, a few
  // seconds of a hand turning one. Real files, in a real engine, over the real cube.
  const { page, context, errors } = await openScript({
    'a-script': {
      schema: 2,
      steps: [
        { say: 'line 0', voice: CLIP, image: { src: 'test/fixtures/picture.png', alt: 'A red square' } },
        { say: 'line 1', voice: CLIP, image: null, clip: { src: 'test/fixtures/clip.mp4', alt: 'A green square' } },
        { say: 'line 2', voice: CLIP, clip: null },
      ],
    },
  });
  assert.equal(await page.$eval('#slMedia', (e) => e.hidden), true, 'a picture was shown before the lesson started');
  await page.click('#slPlay');

  await visible(page, '#slMedia');
  const picture = await page.evaluate(() => {
    const img = document.querySelector('#slMedia img');
    const layer = document.querySelector('#slMedia').getBoundingClientRect();
    const primary = document.querySelector('.primary').getBoundingClientRect();
    return {
      alt: img?.alt, complete: img?.complete, width: img?.naturalWidth,
      covers: Math.abs(layer.width - primary.width) < 2 && Math.abs(layer.height - primary.height) < 2,
    };
  });
  assert.equal(picture.alt, 'A red square', 'the picture is not described to a child who cannot see it');
  assert.equal(picture.complete && picture.width > 0, true, `the picture did not load (${JSON.stringify(picture)})`);
  assert.equal(picture.covers, true, 'the picture does not fill the cube\'s region');

  // The clip: silent, looping, and moving by itself.
  await page.waitForFunction(() => document.querySelector('#slMedia video') !== null, null, { timeout: 20_000 });
  const clip = await page.evaluate(async () => {
    const v = document.querySelector('#slMedia video');
    const at = v.currentTime;
    await new Promise((r) => setTimeout(r, 600));
    return { muted: v.muted, loop: v.loop, label: v.getAttribute('aria-label'), moved: v.currentTime > at, paused: v.paused };
  });
  assert.deepEqual(
    { muted: clip.muted, loop: clip.loop, label: clip.label },
    { muted: true, loop: true, label: 'A green square' },
    'a clip with sound would talk over the narration',
  );
  assert.equal(clip.moved || !clip.paused, true, 'the clip never started');

  // And the cube comes back when the lesson clears it.
  await page.waitForFunction(() => document.querySelector('#slMedia')?.hidden === true, null, { timeout: 20_000 });
  assert.equal(await page.$eval('#slNotice', (e) => e.hidden), true, 'something failed to load');
  assert.deepEqual(errors.map(String), []);
  await context.close();
});

test('a picture the course door refuses is said, and the cube stays visible', async () => {
  const { page, context } = await openScript({
    'a-script': {
      schema: 2,
      steps: [{ say: 'line 0', voice: CLIP, image: { src: '../outside-the-course.png', alt: 'Somewhere else' } }],
    },
  });
  await page.click('#slPlay');
  await visible(page, '#slNotice');
  assert.equal(await page.$eval('#slMedia', (e) => e.hidden), true, 'a refused picture left a blank panel over the cube');
  assert.match(await page.textContent('#slNoticeText'), /outside the course/);
  assert.match(await page.textContent('#slNoticeDetail'), /outside-the-course\.png/);
  await context.close();
});

test('leaving a script lesson stops its recording and returns to the shelf', async () => {
  const { page, context } = await openScript();
  await page.click('#slPlay');
  await page.click('#slLeave');
  await page.waitForFunction(() => document.querySelector('[data-open="a-script"]') !== null);
  assert.equal(await page.$$eval('audio', (els) => els.length), 0, 'the lesson\'s media element outlived it');
  assert.equal(await page.evaluate(async () => (await import('/lib/app-state.js')).state.episode), null);
  await context.close();
});

test('a script lesson rebuilt in place, or returned to, is where the child left it -- a half-made move included', async () => {
  // Every mount built a fresh lesson, so a rebuild put the child back at the first step: 2 / 3 became 1 / 3
  // after `renderScreen()` (audit, 2026-09-21). Episodes kept their place through the parked media element;
  // scripts had nothing.
  const { page, context, errors } = await openScript();
  await page.click('#slPlay');
  await visible(page, '#slYours');
  await page.evaluate(() => window.cubusFeed.move({ notation: 'F' }));        // off the sequence
  await page.waitForFunction(() => /different turn/.test(document.querySelector('#slStatus')?.textContent ?? ''));

  await page.evaluate(async () => (await import('/lib/screen-shell.js')).renderScreen());
  await visible(page, '#slYours');
  assert.equal(await page.textContent('#slCount'), '3 / 5', 'a rebuild in place restarted the lesson');
  assert.match(await page.textContent('#slStatus'), /different turn/, 'the rebuild forgot the turn that took the cube off');

  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await page.waitForFunction(() => document.querySelector('#slLeave') === null);
  await page.evaluate(() => { window.location.hash = '#/course'; });
  await visible(page, '#slYours');
  assert.equal(await page.textContent('#slCount'), '3 / 5', 'returning restarted the lesson');
  assert.deepEqual(await page.$$eval('audio', (els) => els.map((a) => a.paused)), [true], 'a restored lesson started talking');

  // The restored lesson knows the cube is astray: undoing the wrong turn and making the right one goes on.
  await page.evaluate(() => window.cubusFeed.move({ notation: "F'" }));
  await page.evaluate(() => window.cubusFeed.move({ notation: 'U' }));
  await visible(page, '#slAsk');
  assert.equal(await page.textContent('#slCount'), '4 / 5');
  assert.deepEqual(errors.map(String), []);
  await context.close();
});

test('a course replaced under a script lesson retires the lesson, and the new course is what is shown', async () => {
  // The old course's lesson stayed on screen and resolved its next recording against the NEW course (audit,
  // 2026-09-21), because replacing the course silenced the only channel that could have told the screen.
  const { page, context, errors } = await openScript();
  await page.click('#slPlay');
  await visible(page, '#slYours');
  await page.evaluate(async () => {
    const [{ useCourse }, { createCourseSource }] = await Promise.all([import('/lib/course-session.js'), import('/lib/course-source.js')]);
    useCourse(createCourseSource({ list: async () => [{ id: 'another', title: 'Another course' }], read: async () => null }));
  });
  await page.waitForFunction(() => document.querySelector('[data-open="another"]') !== null);
  assert.equal(await page.$('#slLeave'), null, 'the old course\'s lesson is still on screen');
  assert.equal(await page.$$eval('audio', (els) => els.length), 0, 'the old course\'s recording outlived its course');
  assert.equal(await page.evaluate(async () => (await import('/lib/app-state.js')).state.episode), null);
  assert.deepEqual(errors.map(String), []);
  await context.close();
});
