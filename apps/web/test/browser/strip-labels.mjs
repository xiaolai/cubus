// THE GATE FOR TEXT IN A ONE-LINE STRIP (lib/scroll-strip.js). A strip that scrolls sideways holds what is past
// its edges by design and says so by its edge fade, so a CHIP half under the fade is right: it reads as "more this
// way". A text LABEL is not: half of "Sexy move" under the fade was drawn as "ve" (the WI-5 audit's iPhone 16
// screenshot, 2026-10-19), and no text is drawn where it cannot be read (AGENTS.md §2). So every label in a strip is
// either WHOLLY inside the strip's unfaded box or WHOLLY outside the strip's box, and never over a chip or another label.
//
// Shared by geometry.test.mjs (every screen, every fixture, and the Practice page at every turn) and
// scroll-strip.test.mjs (the mechanism at every scroll position). Inlined into `page.evaluate` by `toString()`, so it
// stays self-contained.

/**
 * Every label in a strip under `root` that breaks the rule above, as readable sentences. A LABEL is an element with a
 * text node of its own that is not a control (`button`, `.chip-m`), drawn (not hidden, not `display: none`, not
 * `visibility: hidden`, a box with area), and measured by its TEXT's extent (a Range over its contents). The unfaded
 * box is the strip's border box less the fade's width at each edge — the same `--fade-left` / `--fade-right` the
 * stylesheet's mask reads — while the mask is applied.
 */
export const stripLabelsUnread = (root) => {
  const out = [];
  const text = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const drawn = (el) => {
    if (el.closest('[hidden]')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const meets = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const name = (el) => `"${el.textContent.trim().slice(0, 40)}"`;
  // The TEXT's box, not the element's: a label is a block as wide as its section, and what is drawn is its words.
  const inked = (el) => { const range = document.createRange(); range.selectNodeContents(el); return range.getBoundingClientRect(); };
  for (const strip of root.querySelectorAll('.walk-strip, .stage-row.one-line, .rail')) {
    if (!drawn(strip)) continue;
    const scs = getComputedStyle(strip);
    const masked = scs.maskImage && scs.maskImage !== 'none';
    const fade = (side) => (masked ? Number.parseFloat(scs.getPropertyValue(`--fade-${side}`)) || 0 : 0);
    const b = strip.getBoundingClientRect();
    const shows = { left: b.left + fade('left'), right: b.right - fade('right') };
    const labels = [...strip.querySelectorAll('*')].filter((el) => text(el) && !el.closest('button, .chip-m') && drawn(el));
    const outer = labels.filter((el) => !labels.some((o) => o !== el && o.contains(el)));
    for (const el of labels) {
      const r = inked(el);
      const inside = r.left >= shows.left - 0.5 && r.right <= shows.right + 0.5;
      const outside = r.right <= b.left + 0.5 || r.left >= b.right - 0.5;
      if (!inside && !outside) {
        out.push(`${name(el)} drawn at ${r.left.toFixed(1)}–${r.right.toFixed(1)}, where the strip shows whole only ${shows.left.toFixed(1)}–${shows.right.toFixed(1)} (box ${b.left.toFixed(1)}–${b.right.toFixed(1)})`);
      }
    }
    const chips = [...strip.querySelectorAll('.chip-m')].filter(drawn);
    for (const [i, el] of outer.entries()) {
      const r = inked(el);
      for (const c of chips) if (meets(r, c.getBoundingClientRect())) out.push(`${name(el)} drawn over the chip "${c.textContent.trim()}"${c.classList.contains('cur') ? ' (the current turn)' : ''}`);
      for (const o of outer.slice(i + 1)) if (meets(r, inked(o))) out.push(`${name(el)} drawn over the label ${name(o)}`);
    }
  }
  return out;
};
