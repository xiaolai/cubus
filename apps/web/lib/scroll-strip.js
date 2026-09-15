// One line of buttons that scrolls sideways: the cube screen's stage targets (owner's call,
// 2026-09-15).
//
// Wrapped, the six targets took three rows of the solution card on both desktop windows and left
// the MOVES — the task on that screen — 15px of their 192 in the landscape window and 35px of 108
// in the portrait one. On a wider interface font, which is what Linux's `system-ui` is, a fourth
// row pushed two of the buttons out of the card entirely, where nothing could press them: CI's
// geometry case found that, and measuring it here found the squeeze under every font. One line is
// one line whatever the font, so the moves keep the height it frees.
//
// A strip that scrolls has three duties a wrapped row does not, each of them this file:
//   - the CHOSEN target is in view, including the last one on a screen that just mounted;
//   - an edge with more beyond it says so (`more-left` / `more-right`, a fade in the stylesheet);
//   - a mouse WHEEL moves it: a wheel scrolls vertically, so without this a mouse with no trackpad
//     and no Shift key had no way to reach a button past the edge except the keyboard.

/**
 * Make `row` a one-line strip.
 *
 * @param {HTMLElement} row  the `.stage-row.one-line` element
 * @param {{ signal: AbortSignal }} options  every listener goes when the screen does
 * @returns {{ reveal: (el: Element | null) => void }}
 */
export function oneLineStrip(row, { signal }) {
  const edges = () => {
    const max = row.scrollWidth - row.clientWidth;
    row.classList.toggle('more-left', max > 1 && row.scrollLeft > 1);
    row.classList.toggle('more-right', max > 1 && row.scrollLeft < max - 1);
  };

  /** Scroll the least distance that puts `el` wholly inside the row's padding box. */
  const reveal = (el) => {
    if (!el || !row.contains(el)) return;
    const style = row.ownerDocument.defaultView.getComputedStyle(row);
    const box = row.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const left = box.left + (parseFloat(style.paddingLeft) || 0);
    const right = box.right - (parseFloat(style.paddingRight) || 0);
    if (r.left < left) row.scrollLeft -= left - r.left;
    else if (r.right > right) row.scrollLeft += r.right - right;
    edges();
  };

  row.addEventListener('wheel', (e) => {
    if (row.scrollWidth <= row.clientWidth) return;       // nothing to scroll: the wheel is the page's
    if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return; // a sideways gesture scrolls it already
    const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const before = row.scrollLeft;
    row.scrollLeft += step;
    // At an end the strip cannot move, and the wheel goes back to whatever is behind it.
    if (row.scrollLeft === before) return;
    e.preventDefault();
    // The scroll event that also marks the edges comes a frame later; the marks are due now.
    edges();
  }, { passive: false, signal });
  row.addEventListener('scroll', edges, { passive: true, signal });
  row.addEventListener('click', (e) => reveal(e.target.closest('button')), { signal });
  // A phone turned over, or a browser tab resized, changes the strip's width after it mounted.
  row.ownerDocument.defaultView.addEventListener('resize', edges, { passive: true, signal });

  reveal(row.querySelector('.on'));
  edges();
  return { reveal };
}
