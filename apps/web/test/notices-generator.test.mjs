// The notices generator's own decisions, tested where they can go wrong.
//
// `pnpm notices --check` compares the committed file with what the generator produces now, which
// proves the two agree and nothing about whether either is right: a generator that drops a
// transitive package, reads `MIT OR (Apache-2.0 AND GPL-3.0-only)` as a refusal or files a BSD text
// as MIT regenerates the same wrong file every time. So each decision is tested here on fixtures
// built to break it, and the committed file is held to the real bundles and the Android lockfile
// without cargo. (Found by audit, 2026-09-14: all of the above, with every existing test green.)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  androidLockedModules, bundleBuilds, checkOrtNotices, chooseLicences, identifyLicences, licensePackage,
  ortNoticesFile, packagesInBundle, parseSpdx, selectLicenceFiles, textTable,
} from '../../../scripts/make-third-party-notices.mjs';
import { licencesOf, readPom } from '../../../scripts/android-licences.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname;
const notices = readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');

/** A throwaway tree: `files` is { 'relative/path': contents }. */
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'cubus-notices-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return root;
}

const MIT_TEXT = (holder) => `MIT License\n\nCopyright (c) ${holder}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.`;
const APACHE_TEXT = 'Apache License\nVersion 2.0, January 2004\n\nTERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION\n\n1. Definitions.';
const BSD3_TEXT = 'Copyright (c) 2016 Dropbox, Inc.\n\nRedistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:\n\n3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products.';

// ---- licence expressions ------------------------------------------------------------------------

test('an expression is parsed with its grouping, and an accepted alternative is found inside a group', () => {
  // Each of these was refused by the word-splitting parser, which dropped the parentheses and then
  // demanded an accepted licence on BOTH sides of every AND.
  for (const expr of ['MIT OR (Apache-2.0 AND GPL-3.0-only)', '(GPL-3.0-only AND BSD-3-Clause) OR MIT', 'MIT OR (GPL-3.0-only AND MIT)']) {
    assert.deepEqual(chooseLicences(expr), ['MIT'], expr);
  }
  assert.deepEqual(chooseLicences('(MIT OR Apache-2.0) AND Unicode-3.0'), ['MIT', 'Unicode-3.0']);
  assert.deepEqual(chooseLicences('IJG AND Zlib AND BSD-3-Clause'), ['IJG', 'Zlib', 'BSD-3-Clause']);
  assert.deepEqual(chooseLicences('MIT/Apache-2.0'), ['MIT'], 'Cargo\'s legacy slash is OR');
  assert.equal(chooseLicences('GPL-3.0-only'), null, 'no accepted alternative is a refusal, not a guess');
});

test('an exception is part of its licence: an unknown one is refused, a known one is kept in the name', () => {
  // The old parser deleted everything from WITH onwards: any exception at all became plain Apache.
  assert.equal(chooseLicences('Apache-2.0 WITH MadeUp-exception'), null);
  assert.equal(chooseLicences('MIT WITH Not-A-Real-Exception'), null);
  assert.deepEqual(chooseLicences('Apache-2.0 WITH LLVM-exception'), ['Apache-2.0 WITH LLVM-exception']);
  assert.deepEqual(chooseLicences('Apache-2.0 WITH MadeUp-exception OR MIT'), ['MIT'], 'the other alternative still stands');
});

test('a malformed expression is refused with the reason, never read as something close to it', () => {
  for (const [expr, why] of [['MIT AND', /ends where a licence was expected/], ['(MIT', /parenthesis is not closed/],
    ['MIT OR OR Apache-2.0', /"OR" stands where a licence was expected/], ['MIT Apache-2.0', /follows a complete expression/],
    ['(MIT OR Apache-2.0) WITH LLVM-exception', /WITH follows a group/]]) {
    assert.throws(() => parseSpdx(expr), why, expr);
  }
});

test('the alternative a package carries the text of is the one it is used under', () => {
  // brotli-decompressor is "BSD-3-Clause/MIT" and ships only the BSD text: used under MIT it would
  // travel with no licence text of its own.
  assert.deepEqual(chooseLicences('BSD-3-Clause/MIT', { carried: ['BSD-3-Clause'] }), ['BSD-3-Clause']);
  assert.deepEqual(chooseLicences('BSD-3-Clause/MIT', { carried: [] }), ['MIT'], 'with nothing carried, preference decides');
  assert.deepEqual(chooseLicences('MIT OR Apache-2.0', { carried: ['MIT', 'Apache-2.0'] }), ['MIT']);
});

// ---- licence and notice files -------------------------------------------------------------------

test('a text is identified by what it says, whatever it is called and however it is wrapped', () => {
  assert.deepEqual(identifyLicences(MIT_TEXT('A')), ['MIT']);
  assert.deepEqual(identifyLicences(BSD3_TEXT), ['BSD-3-Clause']);
  assert.deepEqual(identifyLicences(APACHE_TEXT), ['Apache-2.0']);
  // bytemuck's X11 wording of the MIT condition is still MIT, and not MIT-0.
  assert.deepEqual(identifyLicences(MIT_TEXT('B').replace('this permission notice shall', 'this permission notice (including the next paragraph) shall')), ['MIT']);
  // untrusted ships ISC as `//` comment lines.
  const isc = '// Permission to use, copy, modify, and/or distribute this software for any\n// purpose with or without fee is hereby granted, provided that the above\n// copyright notice and this permission notice appear in all copies.';
  assert.deepEqual(identifyLicences(isc), ['ISC']);
  assert.deepEqual(identifyLicences('This project is dual-licensed under the Unlicense and MIT licenses.'), []);
});

test('a package keeps its notices and the texts of what it is used under, and only drops an unused alternative', () => {
  const files = [
    { file: 'LICENSE-MIT', text: MIT_TEXT('Carl Lerche') },
    { file: 'LICENSE-APACHE', text: APACHE_TEXT },
    { file: 'NOTICE', text: 'This product includes software developed by someone.' },
    { file: 'COPYING', text: 'This project is dual-licensed under the Unlicense and MIT licenses.' },
  ];
  const { kept, covered } = selectLicenceFiles(files, ['MIT']);
  assert.deepEqual(kept.map((f) => f.file), ['LICENSE-MIT', 'NOTICE', 'COPYING'],
    'the Apache text of a package used under MIT is left out; a NOTICE and an unrecognised file never are');
  assert.deepEqual(covered, ['MIT']);
  const settled = licensePackage('crate 1.0', 'MIT OR Apache-2.0', files);
  assert.ok(settled.kept.some((f) => f.text.includes('Carl Lerche')), 'the package\'s own copyright line was lost');
  assert.deepEqual(settled.missing, []);
  assert.deepEqual(licensePackage('bare 1.0', 'MIT', []).missing, ['MIT'], 'a package with no text says so');
});

test('texts are deduplicated only when identical, and a text keeps its id when others are added', () => {
  const a = { owner: 'a 1.0', file: 'LICENSE', text: MIT_TEXT('Alice') };
  const b = { owner: 'b 1.0', file: 'LICENSE-MIT', text: MIT_TEXT('Alice') };
  const c = { owner: 'c 1.0', file: 'LICENSE', text: MIT_TEXT('Carol') };
  const small = textTable([a, c]);
  const large = textTable([b, a, c]);
  assert.equal(large.size, 2, 'two MIT texts with different copyright lines are two texts');
  assert.deepEqual(large.get(a.text).carriers, ['b 1.0 (`LICENSE-MIT`)', 'a 1.0 (`LICENSE`)']);
  assert.equal(large.get(c.text).id, small.get(c.text).id, 'adding a carrier renumbered an unrelated text');
});

// ---- what ships in the web app ------------------------------------------------------------------

// Two ways a package reaches the bundle and ships nothing: imported and unused (esbuild drops it),
// and a pure re-export (esbuild keeps the file as an input with zero bytes of output). Neither is
// listed, because neither is in what ships.
test('a bundle\'s packages are what esbuild puts in it: a dependency\'s dependency in, a tree-shaken one out', () => {
  const root = tree({
    'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n",
    'apps/web/package.json': { name: 'web', scripts: { build: 'esbuild entry.js --bundle --format=esm --target=es2022 --legal-comments=eof --outfile=vendor/out.js' } },
    'apps/web/entry.js': "import { a } from 'direct';\nimport { unused } from 'shaken';\nimport { c } from 'reexport';\nexport const x = a() + c;\n",
    'apps/web/node_modules/reexport/package.json': { name: 'reexport', version: '0.1.0', main: 'index.js' },
    'apps/web/node_modules/reexport/index.js': "export { b as c } from 'transitive';\n",
    'apps/web/node_modules/direct/package.json': { name: 'direct', version: '1.2.3', main: 'index.js' },
    'apps/web/node_modules/direct/index.js': "import { b } from 'transitive';\nexport const a = () => b + 1;\n",
    'apps/web/node_modules/transitive/package.json': { name: 'transitive', version: '4.5.6', main: 'index.js' },
    'apps/web/node_modules/transitive/index.js': 'export const b = 41;\n',
    'apps/web/node_modules/shaken/package.json': { name: 'shaken', version: '7.8.9', main: 'index.js', sideEffects: false },
    'apps/web/node_modules/shaken/index.js': 'export const unused = 0;\n',
  });
  try {
    const builds = bundleBuilds(root);
    assert.deepEqual(builds.map((b) => b.bundle), ['out.js']);
    const found = packagesInBundle(root, builds[0]).map((p) => `${p.name}@${p.version}`).sort();
    assert.deepEqual(found, ['direct@1.2.3', 'transitive@4.5.6']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a bundle built with a flag the scan cannot reproduce stops the run', () => {
  const root = tree({
    'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n",
    'apps/web/package.json': { name: 'web', scripts: { build: 'esbuild entry.js --bundle --minify --outfile=vendor/out.js' } },
  });
  try {
    assert.throws(() => bundleBuilds(root), /flags this cannot reproduce: minify/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every package the real bundles carry has a notice, and the dev-only bridge\'s are named as unshipped', () => {
  // The drift half, without cargo: smartcube.js carries aes-js, rxjs and tslib, which a list of
  // entry imports never saw.
  const shipped = new Set();
  for (const build of bundleBuilds(ROOT)) {
    if (build.bundle === 'tauri-mcp-guest.js') continue;
    for (const p of packagesInBundle(ROOT, build)) shipped.add(`${p.name} ${p.version}`);
  }
  for (const name of ['aes-js', 'rxjs', 'tslib', 'three', 'cubejs']) {
    assert.ok([...shipped].some((s) => s.startsWith(`${name} `)), `precondition: ${name} is in a bundle`);
  }
  for (const p of shipped) assert.match(notices, new RegExp(`^### ${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — `, 'm'), `${p} ships and has no notice`);
  assert.match(notices, /^Not shipped: `tauri-plugin-mcp` /m);
  assert.match(notices, /^Not shipped: `@tauri-apps\/api` /m);
});

// ---- ONNX Runtime's notices ---------------------------------------------------------------------

test('ONNX Runtime\'s notices are the pinned file for each release that ships, and nothing else', () => {
  const body = 'THIRD PARTY SOFTWARE NOTICES AND INFORMATION\n';
  const pin = createHash('sha256').update(body).digest('hex');
  const at = (files) => tree(Object.fromEntries(Object.entries(files).map(([f, b]) => [`apps/web/notices/${f}`, b])));
  const cases = [
    [{ [ortNoticesFile('9.9.9')]: body }, { '9.9.9': pin }, null],
    [{}, { '9.9.9': pin }, /is missing — fetch it/],
    [{ [ortNoticesFile('9.9.9')]: `${body}edited` }, { '9.9.9': pin }, /not its pin/],
    [{ [ortNoticesFile('9.9.9')]: body }, {}, /are not pinned/],
    [{ [ortNoticesFile('9.9.9')]: body, [ortNoticesFile('1.0.0')]: body }, { '9.9.9': pin }, /a release nothing ships/],
  ];
  for (const [files, pins, refusal] of cases) {
    const root = Object.keys(files).length ? at(files) : tree({ 'x': '' });
    try {
      if (refusal) assert.throws(() => checkOrtNotices(root, ['9.9.9'], pins), refusal);
      else assert.doesNotThrow(() => checkOrtNotices(root, ['9.9.9'], pins));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('the shipped app carries ONNX Runtime\'s notices for both releases, and the notices link them', () => {
  for (const release of [...notices.matchAll(/\]\(notices\/(onnxruntime-[\d.]+-ThirdPartyNotices\.txt)\)/g)].map((m) => m[1])) {
    const text = readFileSync(new URL(`../notices/${release}`, import.meta.url), 'utf8');
    assert.match(text, /^THIRD PARTY SOFTWARE NOTICES AND INFORMATION/, `${release} is not Microsoft's notices file`);
  }
  assert.match(notices, /onnxruntime-1\.29\.0-ThirdPartyNotices\.txt/, 'the web runtime\'s notices are not linked');
});

// ---- Android ------------------------------------------------------------------------------------

test('the Android inventory is the locked release runtime classpath, and a lockfile with none is refused', () => {
  const lock = [
    '# This is a Gradle generated file for dependency locking.',
    'androidx.browser:browser:1.8.0=arm64ReleaseRuntimeClasspath,universalReleaseRuntimeClasspath',
    'junit:junit:4.13.2=arm64DebugUnitTestRuntimeClasspath',
    'com.fasterxml.jackson.core:jackson-databind:2.18.2=universalReleaseRuntimeClasspath',
    'empty=',
  ].join('\n');
  assert.deepEqual(androidLockedModules(lock), ['androidx.browser:browser:1.8.0', 'com.fasterxml.jackson.core:jackson-databind:2.18.2']);
  assert.throws(() => androidLockedModules('junit:junit:4.13.2=debugRuntimeClasspath\n'), /locks no \*ReleaseRuntimeClasspath/);
});

test('every locked Android release module is in the notices', () => {
  const lock = readFileSync(new URL('../../desktop/src-tauri/gen/android/app/gradle.lockfile', import.meta.url), 'utf8');
  const modules = androidLockedModules(lock);
  assert.ok(modules.some((m) => m.startsWith('com.fasterxml.jackson.core:jackson-databind:')), 'precondition: a Tauri module\'s dependency is locked');
  for (const m of modules) assert.ok(notices.includes(`\`${m}\``), `${m} is on the release classpath and not in the notices`);
});

test('a POM\'s licence is its own or its parent\'s, never one of its dependencies\'', async () => {
  const poms = {
    'g:child:1': '<project><parent><groupId>g</groupId><artifactId>parent</artifactId><version>2</version></parent><dependencies><dependency><licenses><license><name>Wrong</name></license></licenses></dependency></dependencies></project>',
    'g:parent:2': '<project><licenses><license><name>The Apache Software License, Version 2.0</name><url>https://www.apache.org/licenses/LICENSE-2.0.txt</url></license></licenses></project>',
    'g:orphan:1': '<project></project>',
  };
  const fetchPom = async (g, a, v) => ({ xml: poms[`${g}:${a}:${v}`] });
  assert.deepEqual(readPom(poms['g:parent:2']).licenses, [{ name: 'The Apache Software License, Version 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0.txt' }]);
  const { licenses, declaredBy } = await licencesOf('g:child:1', fetchPom);
  assert.equal(licenses[0].name, 'The Apache Software License, Version 2.0');
  assert.equal(declaredBy, 'g:parent:2');
  await assert.rejects(() => licencesOf('g:orphan:1', fetchPom), /declares no licence/);
});
