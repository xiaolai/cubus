// The door a course comes through: what is on the shelf, and what happens when one lesson is bad.
//
// The property behind most of these cases: **the catalogue never reads an episode.** That single
// design decision is what makes a bad lesson refusable by name without emptying the shelf, and what
// keeps listing seventeen lessons from costing 70.6 MiB. Nearly every case below is that property
// seen from one more angle, so if it is ever traded away, several of them go red at once.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createCourseSource,
  CourseRefusal,
  EMPTY_COURSE,
  courseAudioRef,
  fetchCourse,
  isEpisodeId,
  resolveCourseAudio,
} from '../lib/course-source.js';

/** A real episode's cue structure, narration already replaced — the repo's own fixture. */
const EPISODE = JSON.parse(
  readFileSync(new URL('./fixtures/episode-structure.json', import.meta.url), 'utf8'),
);

/** cubus-im's ids, in its own shape. Seventeen, because that is how many lessons there are. */
const SEVENTEEN = Array.from({ length: 17 }, (_, i) => ({
  id: `${String(i + 1).padStart(2, '0')}-lesson-${i + 1}`,
}));

/** A source over plain objects, with a note of what the reader was actually asked for. */
function sourceOver(entries, docs = {}) {
  const asked = [];
  const source = createCourseSource({
    list: async () => entries,
    read: async (id) => {
      asked.push(id);
      if (docs[id] instanceof Error) throw docs[id];
      return docs[id] ?? null;
    },
  });
  return { source, asked };
}

test('a catalogue holds zero, one or seventeen episodes, and reads none of them', async () => {
  const empty = sourceOver([]);
  assert.deepEqual(await empty.source.catalogue(), []);

  const one = sourceOver([{ id: '11-the-middle-layer', title: 'The middle layer' }]);
  assert.deepEqual(
    (await one.source.catalogue()).map((e) => [e.id, e.title]),
    [['11-the-middle-layer', 'The middle layer']],
  );

  const many = sourceOver(SEVENTEEN);
  const listed = await many.source.catalogue();
  assert.equal(listed.length, 17);
  // THE POINT OF THE WHOLE DESIGN: seventeen entries, zero documents read.
  assert.deepEqual(many.asked, []);
  assert.deepEqual(one.asked, []);
});

test('an entry with no title is listed under its id, never under an invented one', async () => {
  const { source } = sourceOver([{ id: '03-holding-it-right' }]);
  const [entry] = await source.catalogue();
  assert.equal(entry.title, '03-holding-it-right');
});

test('a bad episode is refused by name, and the other sixteen stay on the shelf', async () => {
  // One lesson whose cue 0 is wrong, sixteen that are never read. The catalogue is asked AFTER the
  // refusal, because "does not remove the others" is a claim about what happens next.
  const broken = { cues: [{ say: 'line 0', start: 5, end: 1 }] };
  const { source } = sourceOver(SEVENTEEN, { '11-lesson-11': broken });

  const refusal = await assert.rejects(
    () => source.episode('11-lesson-11'),
    (err) => {
      assert.ok(err instanceof CourseRefusal);
      assert.equal(err.reason, 'malformed');
      assert.equal(err.episode, '11-lesson-11');
      // It names the episode AND keeps the validator's words, which name the cue. "invalid lesson"
      // is the sentence this refusal exists to never be.
      assert.match(err.message, /"11-lesson-11"/);
      assert.match(err.message, /episode cue 0/);
      assert.doesNotMatch(err.message, /invalid lesson/i);
      return true;
    },
  );
  assert.equal(refusal, undefined);

  assert.equal((await source.catalogue()).length, 17);
});

test('a valid episode comes back as the object that was checked', async () => {
  const { source } = sourceOver([{ id: '11-the-middle-layer' }], { '11-the-middle-layer': EPISODE });
  // `checkLesson` returns the SAME object by contract; a copy here would mean the caller holds a
  // different document from the one that was validated.
  assert.equal(await source.episode('11-the-middle-layer'), EPISODE);
});

test('the three refusals are three different facts', async () => {
  const boom = new Error('the disk went away');
  const { source, asked } = sourceOver(
    [{ id: 'a-lesson' }, { id: 'b-lesson' }],
    { 'b-lesson': boom },
  );

  await assert.rejects(() => source.episode('a-lesson'), (err) => {
    assert.equal(err.reason, 'unknown'); // the reader had nothing
    return true;
  });
  await assert.rejects(() => source.episode('b-lesson'), (err) => {
    assert.equal(err.reason, 'unreadable'); // the reader threw
    assert.equal(err.cause, boom); // and the cause survives, so a log says what broke
    return true;
  });
  assert.deepEqual(asked, ['a-lesson', 'b-lesson']);
});

test('a malformed id is refused before the reader is touched', async () => {
  const { source, asked } = sourceOver([{ id: 'a-lesson' }]);
  for (const bad of ['../../etc/passwd', 'a lesson', 'A-Lesson', '', '-leading', 'trailing-', null, 7]) {
    await assert.rejects(() => source.episode(bad), (err) => {
      assert.ok(err instanceof CourseRefusal);
      assert.equal(err.reason, 'unknown');
      return true;
    });
  }
  // Nothing was ever asked for: the shape check is what makes traversal unrepresentable rather
  // than merely guarded against downstream.
  assert.deepEqual(asked, []);
});

test('isEpisodeId agrees with what cubus-im actually names its lessons', () => {
  assert.ok(isEpisodeId('11-the-middle-layer'));
  assert.ok(isEpisodeId('01-what-is-this-thing'));
  assert.equal(isEpisodeId('11-the-middle-layer/../x'), false);
  assert.equal(isEpisodeId('..'), false);
});

test('a catalogue that contradicts itself is refused whole', async () => {
  const twice = sourceOver([{ id: 'a-lesson' }, { id: 'a-lesson' }]);
  await assert.rejects(() => twice.source.catalogue(), /names "a-lesson" twice/);

  const notAList = createCourseSource({ list: async () => ({ a: 1 }), read: async () => null });
  await assert.rejects(() => notAList.catalogue(), /did not come back as a list/);

  const noId = sourceOver([{ title: 'no id here' }]);
  await assert.rejects(() => noId.source.catalogue(), /has no usable id/);
});

test('a source needs a reader, and says so', () => {
  assert.throws(() => createCourseSource(), /needs a reader/);
  assert.throws(() => createCourseSource({ list: () => [] }), /needs a reader/);
});

test('EMPTY_COURSE is a real source: an empty shelf and an honest refusal', async () => {
  assert.deepEqual(await EMPTY_COURSE.catalogue(), []);
  await assert.rejects(() => EMPTY_COURSE.episode('11-the-middle-layer'), (err) => {
    assert.equal(err.reason, 'unknown');
    return true;
  });
});

test('fetchCourse tells a missing episode apart from a broken server', async () => {
  const replies = new Map([
    ['http://localhost/course/index.json', { ok: true, status: 200, json: async () => [{ id: 'a-lesson' }] }],
    ['http://localhost/course/a-lesson.json', { ok: true, status: 200, json: async () => EPISODE }],
    ['http://localhost/course/gone-lesson.json', { ok: false, status: 404, json: async () => null }],
    ['http://localhost/course/broken-lesson.json', { ok: false, status: 500, json: async () => null }],
  ]);
  const reader = fetchCourse({
    base: 'http://localhost/course',
    fetch: async (url) => replies.get(String(url)) ?? { ok: false, status: 404, json: async () => null },
  });
  const source = createCourseSource(reader);

  assert.deepEqual((await source.catalogue()).map((e) => e.id), ['a-lesson']);
  assert.equal(await source.episode('a-lesson'), EPISODE);

  await assert.rejects(() => source.episode('gone-lesson'), (err) => {
    assert.equal(err.reason, 'unknown'); // a 404 is "no such episode"
    return true;
  });
  await assert.rejects(() => source.episode('broken-lesson'), (err) => {
    assert.equal(err.reason, 'unreadable'); // a 500 is "something is wrong"
    return true;
  });
});

test('fetchCourse cannot be talked out of its own directory', async () => {
  const seen = [];
  const reader = fetchCourse({
    base: 'http://localhost/course',
    fetch: async (url) => {
      seen.push(String(url));
      return { ok: false, status: 404, json: async () => null };
    },
  });
  await reader.read('11-the-middle-layer');
  assert.deepEqual(seen, ['http://localhost/course/11-the-middle-layer.json']);

  // A base without a trailing slash must not let `index.json` replace the last path segment.
  const bare = fetchCourse({ base: 'http://localhost/deep/course', fetch: async (url) => {
    seen.push(String(url));
    return { ok: true, status: 200, json: async () => [] };
  } });
  await bare.list();
  assert.equal(seen.at(-1), 'http://localhost/deep/course/index.json');
});

test('an empty course is not an error, however it is delivered', async () => {
  // A server with no index at all yields an empty shelf, not a broken app: this is exactly the
  // state a build with no course installed is in, and it is ordinary.
  const reader = fetchCourse({
    base: 'http://localhost/course',
    fetch: async () => ({ ok: false, status: 404, json: async () => null }),
  });
  assert.deepEqual(await createCourseSource(reader).catalogue(), []);
});

test('a relative base resolves against the document, not a hardcoded host', async () => {
  // `new URL('/course/', 'http://localhost')` silently rewrote a relative base onto localhost with
  // NO PORT — so a dev server on :15173 and every deployed origin fetched the wrong place, and the
  // shelf came back empty with nothing to explain it.
  const seen = [];
  const reader = fetchCourse({
    base: '/course',
    baseURI: 'http://example.test:15173/app/index.html',
    fetch: async (url) => { seen.push(String(url)); return { ok: true, status: 200, json: async () => [] }; },
  });
  await reader.list();
  assert.equal(seen[0], 'http://example.test:15173/course/index.json');
});

test('a relative base with nothing to resolve against is refused, never guessed at', () => {
  assert.throws(
    () => fetchCourse({ base: '/course', baseURI: null, fetch: async () => ({ ok: true, status: 200, json: async () => [] }) }),
    /relative base and there is no document/,
  );
});

test('a body that decoded to null is a broken file, not an empty shelf', async () => {
  // A 404 and a 200 carrying `null` are different facts. Merging them reported a malformed index as
  // "no course installed", which is the most misleading thing this screen could say.
  const reader = fetchCourse({
    base: 'http://localhost/course',
    fetch: async () => ({ ok: true, status: 200, json: async () => null }),
  });
  await assert.rejects(() => createCourseSource(reader).catalogue(), /did not come back as a list/);
  await assert.rejects(() => reader.read('a-lesson'), /decoded to null/);
});

test('a fetch that never answers is bounded rather than left hanging', async () => {
  // Without a bound the shelf sits on "Looking…" for ever. The signal is what the source passes;
  // asserting it is passed is the checkable half, since a real stall cannot be waited out here.
  let sawSignal = false;
  const reader = fetchCourse({
    base: 'http://localhost/course',
    timeoutMs: 25,
    fetch: async (url, init) => {
      sawSignal = Boolean(init?.signal);
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })));
      });
    },
  });
  await assert.rejects(() => reader.list(), /did not answer within 25ms/);
  assert.ok(sawSignal, 'no abort signal reached the fetch');
});

test('fetchCourse refuses to be built without what it needs', () => {
  assert.throws(() => fetchCourse(), /needs a base URL/);
  assert.throws(() => fetchCourse({ base: 'http://localhost/course', fetch: null }), /needs a fetch/);
});

/**
 * Every module a file actually depends on — static, side-effect-only, dynamic AND re-exported.
 *
 * Specifiers rather than a text search, because the claim is that nothing READS the course, and a
 * comment naming the module is not a read. `app-state.js` documents that `course-session.js` is the
 * only writer of `state.episode`, which is exactly the kind of sentence worth keeping; a scan over
 * raw text would force it out to stay green, and a guard that edits comments is a bad guard.
 *
 * Both quote styles and `export … from` are covered. The first version of this helper read single
 * quotes and `import` alone — so a double-quoted import, or a re-export, would have carried a
 * course dependency straight past the architectural gate this file exists to hold.
 */
const specifiersOf = (src) => [
  ...src.matchAll(/^\s*(?:import|export)\s+(?:[^;'"]*\s+from\s+)?['"]([^'"]+)['"]/gm),
  ...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g),
].map((m) => m[1]);

const READS_COURSE = /course-source\.js|course-session\.js/;

/** Every `.js` under `lib/screens/`, nested parts included. */
function screenModules(dir = new URL('../lib/screens/', import.meta.url), prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...screenModules(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`));
    else if (entry.name.endsWith('.js')) out.push({ name: `${prefix}${entry.name}`, url: new URL(entry.name, dir) });
  }
  return out;
}

test('no nav code path reads the course', () => {
  // The toolbar must not be able to consult the catalogue even by accident. `screen-shell.js`
  // draws the nav and `app-settings.js` decides what is hidden; neither may reach the course at
  // all, which is what keeps the tab's default FIXED rather than dependent on what is installed.
  for (const path of ['../lib/screen-shell.js', '../lib/app-settings.js', '../lib/app-state.js']) {
    const deps = specifiersOf(readFileSync(new URL(path, import.meta.url), 'utf8'));
    assert.ok(!deps.some((d) => READS_COURSE.test(d)), `${path} must not read the course`);
  }
});

test('only the course screen imports the course', () => {
  // ADR 0006 decision 3 as a grep: no screen but this one learns the word. A second screen importing
  // it is how "has the course" spreads.
  //
  // NESTED MODULES INCLUDED. The first version read the top level of `lib/screens/` only, so every
  // screen's own parts — `screens/cube/*`, `screens/scan/*`, `screens/settings/*` — were invisible
  // to it, and a course dependency moved one directory down would have escaped the gate entirely.
  const allowed = new Set(['course.js', 'course/episode-view.js']);
  const seen = [];
  for (const { name, url } of screenModules()) {
    seen.push(name);
    if (allowed.has(name)) continue;
    const deps = specifiersOf(readFileSync(url, 'utf8'));
    assert.ok(!deps.some((d) => READS_COURSE.test(d)), `lib/screens/${name} must not import the course`);
  }
  // The walk must actually have reached the nested parts, or this case checks a handful of files
  // and reports the whole tree.
  assert.ok(seen.some((n) => n.includes('/')), 'the scan never descended into a screen\'s own parts');
  assert.ok(seen.length > 15, `only ${seen.length} screen modules were scanned`);
});

test('the dependency scanner sees both quote styles, re-exports and dynamic imports', () => {
  // Its own acceptance. A scanner that missed a form would report a clean tree while the dependency
  // it was looking for sat in plain sight.
  const sample = [
    "import a from './single.js';",
    'import b from "./double.js";',
    "import './side-effect.js';",
    'export { c } from "./re-export.js";',
    "const d = await import('./dynamic.js');",
    // A REAL sibling on purpose: `no-dangling-pointers.test.mjs` reads comments for module names
    // and refuses one that does not exist, so a made-up path here fails a different guard than the
    // one this sample is about. What is being checked is that a COMMENTED import is not collected.
    "// import './app-source.mjs';",
  ].join('\n');
  const found = specifiersOf(sample);
  for (const want of ['./single.js', './double.js', './side-effect.js', './re-export.js', './dynamic.js']) {
    assert.ok(found.includes(want), `the scanner missed ${want}`);
  }
  assert.ok(!found.includes('./app-source.mjs'), 'the scanner collected a commented-out import');
});

test('an audio reference a course document chooses cannot reach off-origin', () => {
  // A course document is untrusted input and this value is assigned to a media element that
  // PRELOADS, so an absolute URL, a protocol-relative host, or a `data:` URL would let a file
  // choose what the app fetches merely by being opened. ADR 0006 decision 4 defers where a course
  // comes from; it does not hand that choice to the document.
  for (const bad of [
    'https://example.test/track.m4a',
    '//example.test/track.m4a',
    'data:audio/mp4;base64,AAAA',
    'javascript:alert(1)',
    '/etc/passwd.m4a',
    // These two beat the first attempt, which blacklisted schemes and leading slashes. A browser
    // treats backslashes as slashes, and `trim()` does not touch a newline in the MIDDLE of a
    // string while a URL parser ignores it — so both resolved to external HTTPS. The rule is an
    // allow-list now, because enumerating what may not appear in a path is a losing game.
    '\\\\external.test\\track.m4a',
    'ht\ntps://external.test/track.m4a',
    '../../secret.m4a',
  ]) {
    assert.equal(courseAudioRef({ audio: bad }), '', `${bad} was accepted`);
  }
  // An ENCODED separator too: `%2F` is not a separator to `new URL`, so `..%2F..%2Fx` looks
  // contained — but a server that percent-decodes before resolving sees `../../x`.
  assert.equal(courseAudioRef({ audio: '..%2F..%2Fsecret.m4a' }), '');
  assert.equal(courseAudioRef({ audio: 'a%5C..%5Cb.m4a' }), '');

  assert.equal(courseAudioRef({ audio: '11-the-middle-layer.m4a' }), '11-the-middle-layer.m4a');
  assert.equal(courseAudioRef({ audio: 'audio/lesson-11.m4a' }), 'audio/lesson-11.m4a', 'a sub-directory is ordinary');
  // AND THE OTHER DIRECTION, which the first allow-list got wrong: these are all legitimate
  // references inside the course's own directory, and rejecting them made the screen say a lesson
  // had no audio — a false statement produced by a guard being too clever.
  assert.equal(courseAudioRef({ audio: './audio/lesson.m4a' }), './audio/lesson.m4a');
  assert.equal(courseAudioRef({ audio: 'audio/my lesson.m4a' }), 'audio/my lesson.m4a');
  assert.equal(courseAudioRef({ audio: 'audio/my%20lesson.m4a' }), 'audio/my%20lesson.m4a');
  assert.equal(courseAudioRef({ audio: '音声/授業.m4a' }), '音声/授業.m4a');
  assert.equal(courseAudioRef({ audio: 'lesson.m4a?v=2' }), 'lesson.m4a?v=2');
  assert.equal(courseAudioRef({ audio: '   ' }), '');
  assert.equal(courseAudioRef({}), '');
});

test('a course-relative reference resolves against the COURSE, not the page', async () => {
  // An app at `/index.html` with its course at `/course/` requested `/audio/lesson.m4a` — the wrong
  // file, and outside the course directory. Only the reader knows where the course is, so the
  // resolution is asked of it.
  const reader = fetchCourse({
    base: 'http://host.test/course',
    fetch: async () => ({ ok: true, status: 200, json: async () => [] }),
  });
  const source = createCourseSource(reader);
  assert.equal(resolveCourseAudio(source, { audio: 'audio/lesson.m4a' }), 'http://host.test/course/audio/lesson.m4a');
  assert.equal(resolveCourseAudio(source, { audio: 'https://evil.test/a.m4a' }), '', 'a refused reference stays refused');

  // A reader with no opinion hands the reference back — what a course beside the page wants.
  const bare = createCourseSource({ list: async () => [], read: async () => null });
  assert.equal(resolveCourseAudio(bare, { audio: 'audio/lesson.m4a' }), 'audio/lesson.m4a');
});

test('a timeout says it timed out, even without AbortSignal.timeout', async () => {
  // `new Error('TimeoutError')` has `name === 'Error'`, so the handler's name check missed it and a
  // deadline was reported as "could not be reached" — losing the one diagnostic the branch exists
  // to produce.
  const nativeTimeout = AbortSignal.timeout;
  // `defineProperty`, not assignment: the property is non-writable, and this is the only way to
  // stand in for a platform that has not got it. Restored in `finally` whatever happens.
  Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true });
  try {
    const reader = fetchCourse({
      base: 'http://localhost/course',
      timeoutMs: 20,
      fetch: async (url, init) => new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal.reason));
      }),
    });
    await assert.rejects(() => reader.list(), /did not answer within 20ms/);
  } finally {
    Object.defineProperty(AbortSignal, 'timeout', { value: nativeTimeout, configurable: true });
  }
});

test('the bound covers the body, not just the headers', async () => {
  // A response that opens promptly and then stalls mid-stream is exactly the hang this exists to
  // prevent; clearing the timer once the headers arrived left it unbounded.
  const reader = fetchCourse({
    base: 'http://localhost/course',
    timeoutMs: 20,
    fetch: async (url, init) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('body aborted')));
      }),
    }),
  });
  await assert.rejects(() => reader.list(), /body aborted/);
});

test('the course door knows nothing about screens', () => {
  const src = readFileSync(new URL('../lib/course-source.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]);
  // It validates and it fetches. Anything else — a screen, the shell, app state — would make this
  // app code filed where the source scans cannot see it (test/app-source.mjs's rule).
  assert.deepEqual(imports, ['./lesson-format.js']);
});
