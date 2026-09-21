// A course directory mounted beside the app, end to end — the path an author works on (ADR 0007).
//
// Nothing here installs a course through a module seam. A real directory is written to the OS temp dir,
// the dev server is started with `CUBUS_COURSE_DIR` pointing at it, and the app is left to find it the
// way it will in use: the page's `<meta name="cubus-course">`, `fetchCourse('course/')`, the shelf read
// from `index.json`, and each step's recording fetched from `/course/voice/…` and played to its end.
//
// It fails loudly without the browser: `pnpm exec playwright install webkit` (CI does this).
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { pace } from '../browser-wait.mjs';
import { startBrowserFixture } from './harness.mjs';

const SILENCE = new URL('../fixtures/silence.wav', import.meta.url);

/** A built course, as a course's build writes one: a shelf, a lesson per file, recordings beside them. */
function writeCourse() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cubus-mounted-course-')));
  mkdirSync(join(dir, 'voice', 'a-script'), { recursive: true });
  for (const line of ['l0', 'l1']) copyFileSync(SILENCE, join(dir, 'voice', 'a-script', `${line}.wav`));
  writeFileSync(join(dir, 'index.json'), JSON.stringify([{ id: 'a-script', title: 'A mounted lesson' }]));
  writeFileSync(join(dir, 'a-script.json'), JSON.stringify({
    schema: 2,
    start: { scramble: "R U R' U'" },
    steps: [
      { say: 'line 0', voice: 'voice/a-script/l0.wav' },
      { move: 'R', say: 'line 1', voice: 'voice/a-script/l1.wav' },
      { move: 'U', yours: true },
    ],
  }));
  return dir;
}

let fixture;
let courseDir;
const contexts = [];
before(async () => {
  courseDir = writeCourse();
  fixture = await startBrowserFixture({ env: { CUBUS_COURSE_DIR: courseDir } });
}, { timeout: 120_000 });
after(async () => {
  await Promise.allSettled(contexts.map((c) => c.close()));
  await fixture?.close();
  if (courseDir) rmSync(courseDir, { recursive: true, force: true });
});

test('a mounted course is found through the page, listed from its index, and played from its own files', async () => {
  const context = await fixture.browser.newContext({ viewport: { width: 1024, height: 768 } });
  contexts.push(context);
  const page = await context.newPage();
  pace(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  const fetched = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/course/')) fetched.push(new URL(r.url()).pathname); });

  await page.goto(`${fixture.base}/#/course`);
  await page.waitForFunction(() => document.querySelector('[data-open="a-script"]') !== null, null, { timeout: 20_000 });
  assert.match(await page.textContent('#courseCol'), /A mounted lesson/);
  assert.ok(fetched.includes('/course/index.json'), 'the shelf was not read from the mounted course');
  assert.ok(!fetched.includes('/course/a-script.json'), 'the shelf read a lesson it was only listing');

  await page.click('[data-open="a-script"]');
  await page.waitForFunction(() => document.querySelector('#slPlay') !== null);
  await page.click('#slPlay');
  // Both recordings play to their ends — fetched from the course, relative to the COURSE rather than the
  // page — and the lesson stops at the move that is the child's.
  await page.waitForFunction(() => document.querySelector('#slYours')?.hidden === false, null, { timeout: 20_000 });
  assert.ok(fetched.includes('/course/voice/a-script/l0.wav'), `the first recording was not fetched from the course: ${fetched}`);
  assert.ok(fetched.includes('/course/voice/a-script/l1.wav'), 'the second recording was not fetched from the course');
  assert.equal(await page.textContent('#slCount'), '3 / 3');
  assert.equal(await page.$eval('#slNotice', (e) => e.hidden), true, 'a recording failed');
  assert.deepEqual(errors.map(String), []);
});
