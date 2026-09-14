// What <cubus-cube> looks like, compared picture by picture with the goldens in
// test/fixtures/appearance/ — §3c of dev-docs/renderer-v2-plan.md, the instrument its experiment
// chose. Why goldens are sound here, what the tolerance is and what it cannot see: the header of
// appearance-goldens.mjs, where the numbers live beside the constants they set.
//
// A failing fixture writes the render and a diff (changed pixels red) beside each other in the
// system temp directory and names them. If the change is one you meant, re-pin with
// `node test/browser/appearance-goldens.mjs --write --yes` and commit the pictures with the reason.
import assert from 'node:assert/strict';
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { encodePng } from '../png.mjs';
import { BACKEND, CHANNEL_STEP, FIXTURES, GOLDENS, LAUNCH, TOLERANCE, compare, readGolden, render } from './appearance-goldens.mjs';
import { startBrowserFixture } from './harness.mjs';

let fixture; let page;

before(async () => {
  fixture = await startBrowserFixture({ engine: 'chromium', launch: LAUNCH });
  page = await fixture.browser.newPage({ deviceScaleFactor: 1, viewport: { width: 400, height: 400 } });
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
});

after(async () => { await fixture?.close(); });

test('every fixture has a golden, and every golden a fixture', () => {
  const onDisk = readdirSync(GOLDENS).filter((f) => f.endsWith('.png')).sort();
  const named = FIXTURES.map((f) => `${f.name}.png`).sort();
  assert.deepEqual(onDisk, named, 'a golden without a fixture is a picture nothing checks; a fixture without one checks nothing');
});

for (const f of FIXTURES) {
  test(`${f.name} looks as it did`, async () => {
    const shot = await render(page, f);
    // Compared on another rasteriser a golden says nothing, and the difference would read as a
    // regression. This is a failure, never a skip: a machine that cannot draw with SwiftShader is
    // not running the suite, and a skipped suite is not a green one.
    assert.match(shot.backend, BACKEND, `drawn by ${shot.backend}; the goldens were drawn with SwiftShader`);
    const result = compare(readGolden(f), shot);
    if (result.sizeMismatch) assert.fail(`${f.name}: ${result.sizeMismatch}`);
    if (result.changed > TOLERANCE) {
      const dir = join(tmpdir(), 'cubus-appearance');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${f.name}.actual.png`), encodePng(shot.w, shot.h, shot.rgba));
      writeFileSync(join(dir, `${f.name}.diff.png`), encodePng(shot.w, shot.h, result.diff));
      assert.fail(`${f.name}: ${result.changed} pixels moved by more than ${CHANNEL_STEP} step (tolerance ${TOLERANCE}, worst ${result.worst}). `
        + `Render and diff: ${join(dir, f.name)}.{actual,diff}.png`);
    }
  });
}
