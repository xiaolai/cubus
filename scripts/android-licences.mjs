#!/usr/bin/env node
// Record what every library on the Android app's release classpath is licensed under, and the
// licence and notice files it carries, for the third-party notices.
//
//   node scripts/android-licences.mjs     rewrite gen/android/app/dependency-licences.json
//
// Run after `./gradlew :app:dependencies --write-locks` has changed gen/android/app/gradle.lockfile
// (a dependency bump, a new Tauri plugin). It needs a JDK Gradle can start on (JAVA_HOME, see
// scripts/tauri-android.mjs), the Android SDK, and `unzip`. The notices generator reads the JSON it
// writes and refuses a locked module with no entry, or an entry for a module the lockfile no longer
// has — so the two cannot drift, and `pnpm notices --check` needs no Gradle and no network.
//
// THE LICENCE is the POM's, where Maven artifacts declare one — from Gradle's cache when it holds
// the file, otherwise from the repository — following parent POMs when a POM declares none. A
// module whose chain declares nothing stops the run: a library shipped under no stated licence is a
// question for a person, not a default.
//
// THE FILES are the ones inside the artifact Gradle actually packages. A module on the classpath is
// not always the file in the APK: a Kotlin multiplatform module resolves to its `-jvm` variant, a
// BOM to nothing, and org.tensorflow:tensorflow-lite 2.17.0 is a relocation to LiteRT. So Gradle is
// asked, through an init script, which artifact files the release classpath resolves to.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ANDROID = join(ROOT, 'apps/desktop/src-tauri/gen/android');
const CACHE = join(process.env.GRADLE_USER_HOME ?? join(homedir(), '.gradle'), 'caches/modules-2/files-2.1');
// The repositories gen/android/build.gradle.kts declares, in its order.
const REPOSITORIES = ['https://dl.google.com/dl/android/maven2', 'https://repo.maven.apache.org/maven2'];
const fail = (msg) => { throw new Error(`android-licences: ${msg}`); };

/** The first element named `tag` in `xml`, unescaped. */
const element = (xml, tag) => {
  const m = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`).exec(xml);
  return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : null;
};

/** The `<licenses>` a POM declares for itself, and its `<parent>`; never a dependency's. */
export function readPom(xml) {
  const own = xml.replace(/<dependencies>[\s\S]*?<\/dependencies>/g, '').replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, '');
  const block = element(own, 'licenses');
  const licenses = block
    ? [...block.matchAll(/<license>([\s\S]*?)<\/license>/g)].map((m) => ({ name: element(m[1], 'name'), url: element(m[1], 'url') })).filter((l) => l.name)
    : [];
  const p = element(own, 'parent');
  const parent = p ? { group: element(p, 'groupId'), artifact: element(p, 'artifactId'), version: element(p, 'version') } : null;
  return { licenses, parent };
}

async function fetchPom(group, artifact, version) {
  const cached = join(CACHE, group, artifact, version);
  if (existsSync(cached)) {
    for (const hash of readdirSync(cached)) {
      const file = join(cached, hash, `${artifact}-${version}.pom`);
      if (existsSync(file)) return { xml: readFileSync(file, 'utf8') };
    }
  }
  for (const repo of REPOSITORIES) {
    const url = `${repo}/${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}.pom`;
    const res = await fetch(url);
    if (res.ok) return { xml: await res.text() };
    if (res.status !== 404) fail(`${url} answered ${res.status}`);
  }
  fail(`no POM for ${group}:${artifact}:${version} in the Gradle cache or in ${REPOSITORIES.join(', ')}`);
}

/** A module's licences, following parent POMs until one declares some. */
export async function licencesOf(coord, pom = fetchPom) {
  let [group, artifact, version] = coord.split(':');
  const chain = [];
  for (let depth = 0; depth < 10; depth++) {
    const { licenses, parent } = readPom((await pom(group, artifact, version)).xml);
    chain.push(`${group}:${artifact}:${version}`);
    if (licenses.length) return { licenses, declaredBy: chain.at(-1) };
    if (!parent?.group || !parent.artifact || !parent.version || parent.version.includes('${')) break;
    ({ group, artifact, version } = parent);
  }
  fail(`${coord} declares no licence, and neither does its parent chain (${chain.join(' → ')})`);
}

// The init script: one task on :app that prints every external artifact file the universal release
// runtime classpath resolves to. Universal because every ABI flavour locks the same modules (the
// generator reads all five from the lockfile); `aar` before `jar`, because the jar view of an
// Android library is a transformed classes.jar that need not keep the library's META-INF.
const INIT_SCRIPT = `
allprojects {
  if (path != ':app') return
  afterEvaluate {
    tasks.register('cubusReleaseArtifacts') {
      doLast {
        def conf = configurations.getByName('universalReleaseRuntimeClasspath')
        def type = Attribute.of('artifactType', String)
        ['aar', 'jar'].each { t ->
          conf.incoming.artifactView { v ->
            v.attributes { it.attribute(type, t) }
            v.componentFilter { it instanceof org.gradle.api.artifacts.component.ModuleComponentIdentifier }
          }.artifacts.each { a ->
            def id = a.id.componentIdentifier
            println "CUBUS-ARTIFACT \${id.group}:\${id.module}:\${id.version}\\t\${t}\\t\${a.file}"
          }
        }
      }
    }
  }
}
`;

/** `coord -> artifact file` for every release artifact, the AAR where a module has one. */
function releaseArtifacts() {
  const dir = mkdtempSync(join(tmpdir(), 'cubus-android-'));
  try {
    writeFileSync(join(dir, 'init.gradle'), INIT_SCRIPT);
    const out = execFileSync('./gradlew', ['-q', '-I', join(dir, 'init.gradle'), ':app:cubusReleaseArtifacts'], {
      cwd: ANDROID, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'inherit'],
    });
    const files = new Map();
    for (const line of out.split('\n')) {
      const m = /^CUBUS-ARTIFACT (\S+)\t(aar|jar)\t(.+)$/.exec(line);
      if (m && !(files.has(m[1]) && files.get(m[1]).type === 'aar')) files.set(m[1], { type: m[2], file: m[3] });
    }
    if (!files.size) fail('Gradle reported no release artifacts — the init script matched nothing');
    return files;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A licence or notice file inside an archive, wherever the library put it. */
const ARCHIVE_LICENCE = /(?:^|\/)(?:LICEN[CS]E|NOTICE|COPYING|COPYRIGHT)(?:[-_.][\w.-]*)?$/i;

/** The licence and notice files inside an AAR or JAR, as `{ file, text }`. */
function licenceFilesInArchive(archive) {
  const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n')
    .filter((e) => e && !e.endsWith('/') && ARCHIVE_LICENCE.test(e) && !/\.(?:class|spdx)$/i.test(e));
  return entries.sort().map((file) => ({ file, text: execFileSync('unzip', ['-p', archive, file], { encoding: 'utf8', maxBuffer: 1 << 26 }) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { androidLockedModules, normaliseText } = await import(pathToFileURL(join(ROOT, 'scripts/make-third-party-notices.mjs')).href);
    const locked = androidLockedModules(readFileSync(join(ANDROID, 'app/gradle.lockfile'), 'utf8'));
    const artifacts = releaseArtifacts();
    const strays = [...artifacts.keys()].filter((c) => !locked.includes(c));
    if (strays.length) fail(`Gradle resolves release artifacts the lockfile does not list: ${strays.join(', ')} — relock first`);
    const modules = {};
    const texts = {};
    for (const coord of locked) {
      const { licenses, declaredBy } = await licencesOf(coord);
      const artifact = artifacts.get(coord);
      const files = artifact ? licenceFilesInArchive(artifact.file).map(({ file, text }) => {
        const body = normaliseText(text);
        const sha256 = createHash('sha256').update(body).digest('hex');
        texts[sha256] = body;
        return { file, sha256 };
      }) : null;
      modules[coord] = {
        licenses,
        ...(declaredBy === coord ? {} : { declaredBy }),
        // null: nothing of this module is packaged — a BOM, a multiplatform umbrella whose code is
        // its `-jvm` variant (locked on its own line), or a relocation to another locked module.
        files,
      };
    }
    const sortedTexts = Object.fromEntries(Object.entries(texts).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(join(ANDROID, 'app/dependency-licences.json'), `${JSON.stringify({ modules, texts: sortedTexts }, null, 2)}\n`);
    console.log(`wrote ${locked.length} locked modules, ${artifacts.size} with an artifact, ${Object.keys(sortedTexts).length} distinct texts`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
