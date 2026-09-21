// Which episode is showing, and what happens to an answer nobody is waiting for any more.
//
// Two properties, and every case is one of them:
//
//   1. A refusal lands the learner on the CATALOGUE — never on `home` (which loses the screen) and
//      never on a blank one (which says nothing).
//   2. An answer commits only if it is still wanted. Two opens can overlap, and the trap
//      `walk-session.js` paid for is assigning the shown thing before checking freshness: the DOM
//      then describes one lesson while every closure that read it holds the other.
import assert from 'node:assert/strict';
import test from 'node:test';

import { state } from '../lib/app-state.js';
import {
  courseSource, createCourseSession, installCourseFromPage, pageCourseSession, resetCourseSession, useCourse,
} from '../lib/course-session.js';
import { createCourseSource } from '../lib/course-source.js';

const EPISODE = { cues: [{ say: 'line 0', start: 0, end: 1 }] };
const OTHER = { cues: [{ say: 'line 0', start: 0, end: 2 }] };

/** A promise somebody else resolves, so two loads can be held open at once on purpose. */
function deferred() {
  let settle;
  const promise = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  return { promise, ...settle };
}

/** A session over controllable bytes. `docs[id]` may be a document, an Error, or a deferred. */
function sessionOver(entries, docs = {}) {
  const views = [];
  const source = createCourseSource({
    list: async () => entries,
    read: async (id) => {
      const doc = docs[id];
      if (doc === undefined) return null;
      if (doc instanceof Error) throw doc;
      return doc?.promise ? doc.promise : doc;
    },
  });
  const session = createCourseSession({ source, onChange: (v) => views.push(v) });
  return { session, views };
}

test.beforeEach(() => { state.episode = null; });

test('an unknown id lands on the catalogue, not on home and not on a blank screen', async () => {
  const { session } = sessionOver([{ id: 'a-lesson' }, { id: 'b-lesson' }]);
  await session.load();
  await session.open('no-such-lesson');

  const v = session.view();
  assert.equal(v.showing, null); // nothing is being shown …
  assert.equal(state.episode, null);
  assert.equal(v.entries.length, 2); // … and the shelf is still there to look at
  assert.equal(v.refusal.reason, 'unknown');
  assert.equal(v.refusal.episode, 'no-such-lesson');
  assert.equal(v.loading, false);
});

test('a malformed id never reaches the catalogue', async () => {
  const asked = [];
  const source = createCourseSource({
    list: async () => [{ id: 'a-lesson' }],
    read: async (id) => { asked.push(id); return EPISODE; },
  });
  const session = createCourseSession({ source });
  await session.load();

  for (const bad of ['../../etc/passwd', 'A-Lesson', '', null]) {
    await session.open(bad);
    assert.equal(session.view().refusal.reason, 'unknown');
    assert.equal(session.view().showing, null);
  }
  assert.deepEqual(asked, []); // the reader was never touched
  assert.equal(session.view().entries.length, 1);
});

test('a lesson that does not validate is refused by name, and the shelf survives', async () => {
  const broken = { cues: [{ say: 'line 0', start: 5, end: 1 }] };
  const { session } = sessionOver([{ id: 'a-lesson' }, { id: 'b-lesson' }], { 'b-lesson': broken });
  await session.load();
  await session.open('b-lesson');

  const v = session.view();
  assert.equal(v.refusal.reason, 'malformed');
  assert.equal(v.refusal.episode, 'b-lesson');
  assert.match(v.refusal.message, /episode cue 0/); // it names the cue, not "invalid lesson"
  assert.equal(v.showing, null);
  assert.equal(v.entries.length, 2);
});

test('a requested episode survives the catalogue load that follows it', async () => {
  const { session } = sessionOver([{ id: 'a-lesson' }], { 'a-lesson': EPISODE });
  await session.open('a-lesson');
  assert.equal(session.view().showing, 'a-lesson');

  await session.load(); // the shelf is re-read …
  assert.equal(session.view().showing, 'a-lesson'); // … and the open lesson is still open
  assert.equal(session.view().episode, EPISODE);
  assert.equal(session.view().entries.length, 1);
});

test('the older of two overlapping opens never commits', async () => {
  const slow = deferred();
  const { session } = sessionOver(
    [{ id: 'a-lesson' }, { id: 'b-lesson' }],
    { 'a-lesson': slow, 'b-lesson': OTHER },
  );

  const first = session.open('a-lesson'); // in flight, unresolved
  await session.open('b-lesson'); // a newer ask arrives and finishes
  assert.equal(session.view().showing, 'b-lesson');

  slow.resolve(EPISODE); // the older answer arrives late …
  await first;

  // … and is dropped unshown. Committing before the freshness check is what would put `a-lesson`
  // here while the screen says `b-lesson`.
  assert.equal(session.view().showing, 'b-lesson');
  assert.equal(session.view().episode, OTHER);
  assert.equal(state.episode, 'b-lesson');
});

test('a refusal belonging to a superseded open is swallowed', async () => {
  const slow = deferred();
  const { session } = sessionOver(
    [{ id: 'a-lesson' }, { id: 'b-lesson' }],
    { 'a-lesson': slow, 'b-lesson': OTHER },
  );

  const first = session.open('a-lesson');
  await session.open('b-lesson');
  slow.reject(new Error('the disk went away'));
  await first;

  // The newer open is untouched: an old failure must not tear down a screen it no longer owns.
  assert.equal(session.view().showing, 'b-lesson');
  assert.equal(session.view().refusal, null);
});

test('close cancels a load in flight and goes back to the shelf', async () => {
  const slow = deferred();
  const { session } = sessionOver([{ id: 'a-lesson' }], { 'a-lesson': slow });

  const opening = session.open('a-lesson');
  session.close();
  assert.equal(session.view().showing, null);
  assert.equal(session.view().loading, false);

  slow.resolve(EPISODE);
  await opening;
  assert.equal(session.view().showing, null); // the cancelled load never puts a lesson on screen
  assert.equal(state.episode, null);
});

test('a shelf that cannot be read is a reason, not a throw', async () => {
  const source = createCourseSource({
    list: async () => { throw new Error('the disk went away'); },
    read: async () => null,
  });
  const session = createCourseSession({ source });
  await session.load(); // does not reject

  assert.deepEqual(session.view().entries, []);
  // A SHELF problem, recorded as one. It used to go through the episode refusal, which also clears
  // the open lesson — see the next case.
  assert.match(session.view().listError.message, /the disk went away/);
  assert.equal(session.view().refusal, null);
  assert.equal(session.view().loading, false);
});

test('a failed shelf refresh does not eject the lesson being watched', async () => {
  // `load()`'s contract says a refresh is about the LIST. It went through `refuse()` on failure,
  // which clears `state.episode` — so the shelf briefly failing threw a child out of the lesson
  // they were in the middle of.
  let shelfWorks = true;
  const source = createCourseSource({
    list: async () => { if (!shelfWorks) throw new Error('the shelf went away'); return [{ id: 'a-lesson' }]; },
    read: async () => EPISODE,
  });
  const session = createCourseSession({ source });
  await session.load();
  await session.open('a-lesson');
  assert.equal(session.view().showing, 'a-lesson', 'precondition: a lesson is open');

  shelfWorks = false;
  await session.load();

  assert.equal(session.view().showing, 'a-lesson', 'the failed refresh ejected the open lesson');
  assert.equal(session.view().episode, EPISODE);
  assert.ok(session.view().listError, 'and the shelf problem is still reported');
});

test('a recovered shelf clears the failure it reported', async () => {
  let shelfWorks = false;
  const source = createCourseSource({
    list: async () => { if (!shelfWorks) throw new Error('the shelf went away'); return [{ id: 'a-lesson' }]; },
    read: async () => EPISODE,
  });
  const session = createCourseSession({ source });
  await session.load();
  assert.ok(session.view().listError, 'precondition: it failed');
  shelfWorks = true;
  await session.load();
  assert.equal(session.view().listError, null, 'the recovered shelf still showed the old failure');
  assert.equal(session.view().entries.length, 1);
});

test('the older of two overlapping shelf reads never wins', async () => {
  // Catalogue reads used to capture the generation WITHOUT advancing it, so both were current and
  // whichever finished last won — regardless of which was asked for last.
  const first = deferred();
  const second = deferred();
  const queue = [first, second];
  const source = createCourseSource({ list: () => queue.shift().promise, read: async () => null });
  const session = createCourseSession({ source });

  const a = session.load();
  const b = session.load();
  second.resolve([{ id: 'new-lesson' }]);
  first.resolve([{ id: 'old-lesson' }]);
  await Promise.all([a, b]);

  assert.deepEqual(session.view().entries.map((e) => e.id), ['new-lesson']);
});

test('a malformed open does not leave the shelf stuck on Looking', async () => {
  // The bump that supersedes a pending open also has to clear `opening` — the superseded one can no
  // longer do it, and the shelf sat on "Looking…" for ever with the refusal hidden behind it.
  const slow = deferred();
  const source = createCourseSource({
    list: async () => [{ id: 'a-lesson' }],
    read: async () => slow.promise,
  });
  const session = createCourseSession({ source });
  const pending = session.open('a-lesson');
  assert.equal(session.view().loading, true, 'precondition: it is loading');

  await session.open('NOT AN ID');
  assert.equal(session.view().loading, false, 'the shelf is still saying "Looking…"');
  assert.equal(session.view().refusal.reason, 'unknown');

  slow.resolve(EPISODE);
  await pending;
  assert.equal(session.view().showing, null, 'the superseded open committed anyway');
});

test('a retired session cannot write over the course that replaced it', async () => {
  const slow = deferred();
  const source = createCourseSource({ list: async () => [{ id: 'old-lesson' }], read: async () => slow.promise });
  const seen = [];
  const session = createCourseSession({ source, onChange: (v) => seen.push(v) });
  const pending = session.open('old-lesson');

  session.invalidate();
  const after = seen.length;
  slow.resolve(EPISODE);
  await pending;

  assert.equal(state.episode, null, 'a retired session still wrote the global episode id');
  assert.equal(seen.length, after, 'a retired session still notified its listener');
});

test('installing a course through useCourse retires the page session that was holding the old one', async () => {
  // THROUGH `useCourse`, not by calling `invalidate()` by hand. The hand-called version tested that
  // `invalidate` works and said nothing about whether anything CALLS it: an audit removed
  // `pageSession?.invalidate()` from `useCourse()` and all fifteen cases passed. The wiring is the
  // finding, so the wiring is what this drives.
  resetCourseSession();
  const slow = deferred();
  useCourse(createCourseSource({
    list: async () => [{ id: 'old-lesson' }],
    read: async () => slow.promise,
  }));
  const seen = [];
  const session = pageCourseSession((v) => seen.push(v));
  const pending = session.open('old-lesson');
  assert.equal(session.view().loading, true, 'precondition: the old course has a load in flight');

  // A new course arrives while that open is still pending.
  useCourse(createCourseSource({ list: async () => [{ id: 'new-lesson' }], read: async () => OTHER }));
  const after = seen.length;

  slow.resolve(EPISODE);
  await pending;

  assert.equal(state.episode, null, 'the replaced course still committed its answer');
  assert.equal(seen.length, after, 'the replaced course still notified the screen');
  resetCourseSession();
});

test('the view reports loading while it loads, and stops when it stops', async () => {
  const slow = deferred();
  const { session, views } = sessionOver([{ id: 'a-lesson' }], { 'a-lesson': slow });

  const opening = session.open('a-lesson');
  assert.equal(session.view().loading, true);
  slow.resolve(EPISODE);
  await opening;
  assert.equal(session.view().loading, false);
  // The screen is told, rather than having to poll: at least one change per edge.
  assert.ok(views.some((v) => v.loading === true));
  assert.ok(views.some((v) => v.loading === false));
});

test('a session needs a source', () => {
  assert.throws(() => createCourseSession(), /needs a source/);
});

// ADR 0007: the Course screen plays scripts as well as episodes. It refused them by name until then,
// because the only thing it could mount was the episode player; a script is now opened like any lesson,
// and the SCREEN chooses the player from the document's own `schema` (`checkLesson`'s one door).
test('a script opens like an episode, and a script that does not validate is refused by name', async () => {
  const script = { schema: 2, steps: [{ say: 'line 0', voice: 'voice/l0.m4a' }, { move: 'R', yours: true }] };
  const broken = { schema: 2, steps: [{ move: 'R', yours: 'yes' }] };
  const { session } = sessionOver([{ id: 'a-lesson' }, { id: 'b-lesson' }], { 'a-lesson': script, 'b-lesson': broken });
  await session.load();
  await session.open('a-lesson');
  assert.equal(session.view().showing, 'a-lesson');
  assert.equal(session.view().episode, script, 'the document shown is the one that was checked');
  assert.equal(session.view().refusal, null);

  await session.open('b-lesson');
  assert.equal(session.view().showing, null);
  assert.equal(session.view().refusal.reason, 'malformed');
  assert.match(session.view().refusal.message, /script step 0: `yours` is true or absent/);
  assert.equal(session.view().entries.length, 2, 'a bad script emptied the shelf');
});

// ---- The course the PAGE says it has (ADR 0007) ---------------------------------------------------
//
// A server that has a course beside the app says so in the page's head, and the app installs it at
// start. Never by probing `course/index.json`: a packaged build answers a missing file with index.html,
// so a probe would report a broken shelf where there is simply no course.

/** A document with, or without, the course tag — the only part of a document this reads. */
const pageWith = (content) => ({
  querySelector: (sel) => (sel === 'meta[name="cubus-course"]' && content !== undefined
    ? { getAttribute: (name) => (name === 'content' ? content : null) }
    : null),
});

test('a page with no course tag installs nothing, and the empty course stands', async (t) => {
  t.after(() => useCourse(null));
  useCourse(null);   // from nothing: an earlier case in this file installs a course of its own
  const made = [];
  assert.equal(installCourseFromPage(pageWith(undefined), { make: (base) => { made.push(base); } }), false);
  assert.deepEqual(made, []);
  assert.deepEqual([...await courseSource.catalogue()], []);
});

test('a page naming a directory beside the app installs the course from there', async (t) => {
  t.after(() => useCourse(null));
  const made = [];
  const source = createCourseSource({ list: async () => [{ id: 'a-lesson' }], read: async () => null });
  assert.equal(installCourseFromPage(pageWith('course/'), { make: (base) => { made.push(base); return source; } }), true);
  assert.deepEqual(made, ['course/']);
  assert.equal(courseSource, source);
});

test('a course tag that names anything but a directory beside the app is refused ON THE SHELF', async (t) => {
  t.after(() => useCourse(null));
  for (const bad of ['https://example.test/course/', '//example.test/c/', '/course/', '../course/', 'course', 'a/../b/', '', 'course/\n']) {
    const made = [];
    assert.equal(installCourseFromPage(pageWith(bad), { make: (base) => { made.push(base); } }), true);
    assert.deepEqual(made, [], `${JSON.stringify(bad)} was used as a course location`);
    // Loud, and where the author will look: the shelf says the lessons did not load, and why.
    await assert.rejects(courseSource.catalogue(), /names its course as .* which is not a directory beside the app/);
  }
});

// The 2026-09-21 audit of the course-player branch: a session's lifecycle, asked seven more questions.

test('a retired session, still held by a reference, can neither open nor close anything', async (t) => {
  t.after(() => { state.episode = null; });
  const old = createCourseSession({ source: createCourseSource({ list: async () => [], read: async () => EPISODE }) });
  old.invalidate();
  state.episode = 'kept';
  await old.open('a-lesson');
  assert.equal(state.episode, 'kept', 'a retired session committed an episode');
  old.close();
  assert.equal(state.episode, 'kept', "a retired session cleared another session's selection");
});

test('a reset retires the session, so an open in flight cannot land on the next one', async (t) => {
  t.after(() => { resetCourseSession(); useCourse(null); });
  const gate = deferred();
  useCourse(createCourseSource({ list: async () => [], read: async () => { await gate.promise; return EPISODE; } }));
  const pending = pageCourseSession().open('a-lesson');
  resetCourseSession();
  const heard = [];
  pageCourseSession((view) => heard.push(view.showing));
  gate.resolve();
  await pending;
  assert.equal(state.episode, null, 'the old open wrote the episode after the reset');
  assert.deepEqual(heard, [], "the old open notified the next session's listener");
});

test("replacing the course clears the replaced course's selection", async (t) => {
  t.after(() => { resetCourseSession(); useCourse(null); });
  useCourse(createCourseSource({ list: async () => [], read: async () => EPISODE }));
  await pageCourseSession().open('a-lesson');
  assert.equal(state.episode, 'a-lesson');
  useCourse(null);
  assert.equal(pageCourseSession().view().showing, null, "the new course showed the old course's lesson id");
});

test('a screen that throws while drawing cannot stop a read or leave the shelf loading', async (t) => {
  const was = console.error;
  const reported = [];
  console.error = (...args) => reported.push(args.map(String).join(' '));
  t.after(() => { console.error = was; state.episode = null; });
  let reads = 0;
  const source = createCourseSource({ list: async () => { reads += 1; return []; }, read: async () => EPISODE });
  const session = createCourseSession({ source, onChange: () => { throw new Error('drawing failed'); } });
  await session.load();
  assert.equal(reads, 1, 'the throwing listener stopped the read from starting');
  assert.equal(session.view().loading, false, 'the shelf was left loading');
  await assert.doesNotReject(session.open('a-lesson'), 'a failing notification rejected the open');
  assert.ok(reported.some((line) => /failed while drawing/.test(line)), 'the listener failure went unreported');
});

test('the page installs its course against its OWN address, not the global document', async (t) => {
  const was = globalThis.fetch;
  t.after(() => { globalThis.fetch = was; useCourse(null); });
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(String(url)); return { ok: true, status: 200, json: async () => [] }; };
  installCourseFromPage({ ...pageWith('course/'), baseURI: 'https://app.test/deep/index.html' });
  await courseSource.catalogue();
  assert.deepEqual(seen, ['https://app.test/deep/course/index.json']);
});

test('a course tag with no location is refused on the shelf, never mistaken for no tag', async (t) => {
  t.after(() => useCourse(null));
  assert.equal(installCourseFromPage(pageWith(null)), true, 'a declared course with no location was ignored');
  await assert.rejects(courseSource.catalogue(), /names no location/);
});

test('a failure opening one lesson is reported against THAT lesson, not the one on show', async (t) => {
  t.after(() => { state.episode = null; });
  const source = {
    catalogue: async () => [],
    episode: async (id) => { if (id === 'b-lesson') throw new Error('the disk is full'); return EPISODE; },
  };
  const session = createCourseSession({ source });
  await session.open('a-lesson');
  await session.open('b-lesson');
  assert.equal(session.view().refusal?.episode, 'b-lesson');
});
