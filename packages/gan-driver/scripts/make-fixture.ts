// Build a raw fixture JSON from a blew .kv capture.
// Usage: make-fixture <capture.kv> <fixtureName> <note>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , kvFile, name, note] = process.argv;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkts: { ts: string | null; enc: string }[] = [];
for (const line of readFileSync(kvFile, 'utf8').split('\n')) {
  const v = line.match(/value=([0-9a-fA-F]{40})/);
  const t = line.match(/ts=([^ ]+)/);
  if (v) pkts.push({ ts: t ? t[1] : null, enc: v[1] });
}
const out = join(ROOT, 'tests', 'fixtures', `${name}.raw.json`);
writeFileSync(
  out,
  JSON.stringify(
    {
      device: 'GAN16ui_C8D3',
      mac: '54:6C:50:89:C8:D3',
      note,
      protocol: 'gen4',
      count: pkts.length,
      packets: pkts,
    },
    null,
    2,
  ),
);
console.log('wrote', name, pkts.length, 'packets');
