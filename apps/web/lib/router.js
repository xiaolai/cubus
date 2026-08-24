// Hash router for the app shell.
//
// Hash-based, not the History API: the app is loaded by the Tauri webview and by a plain static
// server, and neither rewrites an unknown path back to index.html. A deep link like /timer would
// 404; #/timer needs no server cooperation and works identically in both hosts.
//
// location and history are taken by argument rather than read off window, so the routing rules are
// unit-testable with plain objects — the same seam cube-transport.js uses for its hosts.

const DEFAULT = 'home';

export function makeRouter({ screens, defaultScreen = DEFAULT, location, history }) {
  // hasOwnProperty, never `id in screens` or a bare truthiness test: a hash is whatever the user
  // typed, and inherited keys like `constructor` or `toString` would otherwise resolve to a
  // function that the caller would try to render.
  const isKnown = (id) => Object.prototype.hasOwnProperty.call(screens, id);

  const href = (id) => `#/${id}`;

  function parse(hash) {
    let raw = String(hash ?? '').replace(/^#\/?/, '');
    try {
      raw = decodeURIComponent(raw);
    } catch {
      return defaultScreen; // malformed percent-encoding; treat as unroutable
    }
    const id = raw.trim();
    return isKnown(id) ? id : defaultScreen;
  }

  const current = () => parse(location.hash);

  // Make the URL match the screen actually being shown, without pushing a history entry — landing
  // on #/bogus should leave #/home in the bar, and Back should still exit the app rather than
  // stepping through corrections.
  function normalize() {
    const id = current();
    if (location.hash !== href(id)) {
      try {
        history.replaceState(null, '', href(id));
      } catch {
        // Some engines reject replaceState on file:// documents. The rewrite is cosmetic, so
        // degrade to assigning the hash instead of throwing during boot.
        location.hash = href(id);
      }
    }
    return id;
  }

  // Returns whether the hash actually changed. It matters: assigning an identical hash fires no
  // hashchange, so a caller that relies on the event would silently do nothing. `false` means the
  // caller must render directly.
  function go(id) {
    const target = isKnown(id) ? id : defaultScreen;
    if (location.hash === href(target)) return false;
    location.hash = href(target);
    return true;
  }

  return { parse, current, href, normalize, go };
}
