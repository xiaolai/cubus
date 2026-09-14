// The Settings screen's window-orientation row: the desktop window's shape, asked of the Rust side
// and set through it.
//
// Lifted out of lib/screens/settings.js on 2026-09-14.

/** The window's orientation lives on the Rust side (a file the window is built from before this
 *  webview exists), so the pills ask it which is current, and tell it which to become. A failure
 *  surfaces on the pills themselves rather than in a console nobody reads. */
export function wireOrientation(orientationPills) {
  if (!orientationPills) return;
  const invoke = window.__TAURI__?.core?.invoke;
  const mark = (current) => {
    for (const b of orientationPills.querySelectorAll('[data-set-orientation]')) {
      const on = b.dataset.setOrientation === current;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on)); // the class is the look; this is the fact
    }
  };
  const fail = (e) => { orientationPills.title = String(e); orientationPills.style.color = 'var(--err-ink)'; console.error('window orientation', e); };
  if (typeof invoke !== 'function') { fail('the Tauri API is not exposed'); return; }
  // One request at a time. The read at mount and every press each marked a pill when its answer
  // landed, in whatever order they landed, so an older read arriving after a newer write marked
  // the shape the window no longer had (found by audit, 2026-09-13). The pills are out of reach
  // while any request is out, the first read included, and back once its answer has been shown.
  const pills = [...orientationPills.querySelectorAll('[data-set-orientation]')];
  const ask = (...request) => {
    for (const b of pills) b.disabled = true;
    invoke(...request).then(mark, fail).finally(() => { for (const b of pills) b.disabled = false; });
  };
  ask('get_orientation');
  for (const b of pills) b.onclick = () => ask('set_orientation', { orientation: b.dataset.setOrientation });
}
