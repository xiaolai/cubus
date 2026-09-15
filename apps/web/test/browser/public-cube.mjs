// The public cube: `<cubus-cube>` as its manifest describes it, and nothing more.
//
// dev-docs/adr/0005-the-renderer-plays-scripts-methods-choose.md decision 4; plan item 2.5 of
// dev-docs/tutorial-capability-plan.md. Every consumer the renderer has — the episode player, the
// script drivers, the scenario corpus — is written against the manifest, and the way to keep that
// true is to run them against an element that REFUSES anything else, naming what it refused. A private
// read is then a failing test rather than a coupling nobody notices until the field is renamed.
//
// One implementation, shared: a proxy built in one suite and copied into another is two proxies, and
// the lenient one is the one that lets a consumer drift.
import { readFileSync } from 'node:fs';

/** What a consumer may touch, as the element itself declares it. */
export const MANIFEST = JSON.parse(
  readFileSync(new URL('../../vendor/cubus-cube.manifest.json', import.meta.url), 'utf8'),
);

/**
 * Install `window.__publicCube(el)` in `page`: the element behind a proxy that throws on any member
 * the manifest does not list, and on an argument outside a listed operation's rules.
 *
 * `manifest` is the element's own by default; a test may pass a narrowed one to show what the
 * contract was missing before it grew.
 */
export const installPublicCube = (page, manifest = MANIFEST) => page.evaluate((m) => {
  const attributes = new Set(m.attributes);
  const methods = new Set(m.methods);
  const events = new Set(m.events ?? []);
  const properties = new Map((m.properties ?? []).map((p) => [p.name, p]));
  const operations = m.operations ?? {};
  // One rule per argument, by name. `attribute` and `event` are the two that can be wrong in a way
  // nothing else catches: a misspelt attribute is silently ignored by the DOM, and a listener on an
  // event the element never dispatches waits forever.
  const check = (op, rule, value) => {
    if (rule === 'attribute' && !attributes.has(value)) throw new Error(`${op}: the manifest lists no attribute "${value}"`);
    if (rule === 'event' && !events.has(value)) throw new Error(`${op}: the manifest lists no event "${value}"`);
    if (rule === 'listener' && typeof value !== 'function' && typeof value?.handleEvent !== 'function') {
      throw new Error(`${op}: a listener is a function or an object with handleEvent`);
    }
  };
  window.__publicCube = (el) => new Proxy(el, {
    get(target, name) {
      if (typeof name === 'symbol') throw new Error('a symbol read on the public cube');
      if (Object.hasOwn(operations, name)) {
        const rule = operations[name];
        if (!rule.args) return target[name];                       // a member to read, not to call
        return (...args) => {
          if (args.length > rule.args.length) throw new Error(`${name}: the manifest allows ${rule.args.length} arguments, not ${args.length}`);
          args.forEach((v, i) => check(name, rule.args[i], v));
          return target[name](...args);
        };
      }
      if (methods.has(name)) return (...args) => target[name](...args);
      if (properties.get(name)?.read) return target[name];
      throw new Error(`the manifest lists no member "${name}"`);
    },
    set(target, name, value) {
      if (typeof name === 'symbol') throw new Error('a symbol written on the public cube');
      if (!properties.get(name)?.write) throw new Error(`the manifest lists no writable property "${String(name)}"`);
      target[name] = value;
      return true;
    },
  });
}, manifest);
