// The first-block table build under V8 (Node) and under JavaScriptCore (Playwright's WebKit), interleaved,
// so the ratio between the two engines survives a loaded machine better than either number does.
//
//   node bench/roux-engines.mjs [rounds]     # default 3
//
// An iPhone runs JavaScriptCore. No iPhone is attached here, so this measures the ENGINE half of the
// device estimate on this Mac; the hardware half is the estimate dev-docs/renderer-v2-plan.md records.

import { buildFirstBlock } from './roux-table-probe.mjs';
import { startBrowserFixture } from '../test/browser/harness.mjs';

const ROUNDS = Number(process.argv[2] ?? 3);
const fx = await startBrowserFixture({ engine: 'webkit' });
try {
  const page = await fx.browser.newPage();
  await page.goto(`${fx.base}/index.html`);
  const rows = [];
  for (let r = 0; r < ROUNDS; r++) {
    const v8 = buildFirstBlock();
    const jsc = await page.evaluate(async () => (await import('/bench/roux-table-probe.mjs')).buildFirstBlock());
    if (v8.reached !== jsc.reached || v8.checksum !== jsc.checksum) throw new Error('the two engines built different tables');
    rows.push({ v8: v8.ms, jsc: jsc.ms });
    console.log(`round ${r + 1}: V8 ${v8.ms.toFixed(0)} ms, JavaScriptCore ${jsc.ms.toFixed(0)} ms, ratio ${(jsc.ms / v8.ms).toFixed(2)} (both ${v8.reached} states, checksum ${v8.checksum})`);
  }
  const ratios = rows.map((x) => x.jsc / x.v8).sort((a, b) => a - b);
  console.log(`median JavaScriptCore / V8: ${ratios[Math.floor(ratios.length / 2)].toFixed(2)}`);
} finally {
  await fx.close();
}
