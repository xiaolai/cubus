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
// A strip that scrolls has two duties a wrapped row does not, each of them this file:
//   - the CHOSEN target is in view, including the last one on a screen that just mounted;
//   - an edge with more beyond it says so (`more-left` / `more-right`, a fade in the stylesheet).
//
// A vertical mouse WHEEL does not move it (owner, 2026-10-17). It used to be turned sideways here,
// which took the wheel from whatever the pointer was passing over on its way down the card. A
// sideways gesture, Shift+wheel and the keyboard still scroll it — all the browser's own.
//
// The walk's moves are the same kind of strip in portrait (dev-docs/practice-redesign-plan.md §5.7), with a third
// duty: the turn you are on is kept at the CENTRE (`centre`). In landscape the same list wraps, and a sectioned
// lesson (112–161 moves) is taller than any landscape sheet, so it scrolls DOWN: there `centre` keeps the turn
// you are on at the list's vertical centre, the one mechanism on both axes (stage-contract.md, 2026-10-18).

/**
 * Make `row` a one-line strip.
 *
 * @param {HTMLElement} row  the `.stage-row.one-line` element
 * @param {{ signal: AbortSignal }} options  every listener goes when the screen does
 * @returns {{ reveal: (el: Element | null) => void, centre: (el: Element | null) => void }}
 */
export function oneLineStrip(row, { signal }) {
  const edges = () => {
    const max = row.scrollWidth - row.clientWidth;
    row.classList.toggle('more-left', max > 1 && row.scrollLeft > 1);
    row.classList.toggle('more-right', max > 1 && row.scrollLeft < max - 1);
    labels();
  };

  /**
   * A SECTION'S LABEL IS TEXT (`.walk-sec-l`: a trigger's name over its part, a lesson stage's over its own), and no
   * text is drawn where it cannot be read (AGENTS.md §2). A chip half under the edge fade says "more this way"; half a
   * name says nothing — "Sexy move" stood as "ve" (WI-5 audit, 2026-10-19). So, after every scroll:
   *   - a label STICKS to the strip's visible left edge, past the fade, while any turn of its part is in view;
   *   - it is drawn only where it is WHOLE, inside the unfaded box, and over ITS OWN turns: never past its section's
   *     last turn, where it would name the next section's (E12.0) — so never over another label either. Anywhere
   *     else, and always for a name wider than its own turns, it is not drawn (`visibility`, which keeps its row's
   *     height and with it the cube's).
   * It never sits over a chip: it is in its section's own row above the chips. The fade's widths are the stylesheet's
   * (`--fade-left` / `--fade-right`, the ones its mask reads), and a label is measured by its TEXT, not its block.
   */
  const labels = () => {
    const els = [...row.querySelectorAll(':scope > * > .walk-sec-l')];
    if (!els.length) return;
    const style = row.ownerDocument.defaultView.getComputedStyle(row);
    const box = row.getBoundingClientRect();
    const shows = {
      left: box.left + (parseFloat(style.getPropertyValue('--fade-left')) || 0),
      right: box.right - (parseFloat(style.getPropertyValue('--fade-right')) || 0),
    };
    const range = row.ownerDocument.createRange();
    const at = els.map((el) => {
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      const last = el.parentElement.querySelector('.move-chips > :last-child')?.getBoundingClientRect();
      return { el, natural: r.left - (Number(el.dataset.pin) || 0), width: r.width, last };
    });
    for (const a of at) {
      const left = Math.max(a.natural, shows.left);
      const inView = Boolean(a.last) && a.last.right > shows.left && a.natural < shows.right;
      const drawn = inView && left + a.width <= Math.min(shows.right, a.last.right);
      const pin = drawn ? left - a.natural : 0;
      a.el.dataset.pin = String(pin);
      a.el.style.transform = pin ? `translateX(${pin}px)` : '';
      a.el.style.visibility = drawn ? '' : 'hidden';
    }
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

  /**
   * Scroll so that `el`'s centre is the row's centre: the walk's strip keeps the turn you are on there
   * (dev-docs/practice-redesign-plan.md §5.7). The row clamps the scroll, so the first and last of a row
   * with no spacers at its ends stop short of the centre; the walk's strip has them.
   * Down as well as across, on a row that SCROLLS down (`overflow-y` auto or scroll) — the landscape list
   * of a lesson. A row that clips down (portrait's strip, `overflow-y: hidden`) is never moved down: a
   * script can scroll a box the person cannot, and nothing there is below the fold.
   */
  const centre = (el) => {
    if (!el || !row.contains(el)) return;
    const box = row.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    row.scrollLeft += (r.left + r.width / 2) - (box.left + row.clientLeft + row.clientWidth / 2);
    if (/^(auto|scroll)$/.test(row.ownerDocument.defaultView.getComputedStyle(row).overflowY)) {
      row.scrollTop += (r.top + r.height / 2) - (box.top + row.clientTop + row.clientHeight / 2);
    }
    edges();
  };

  row.addEventListener('scroll', edges, { passive: true, signal });
  row.addEventListener('click', (e) => reveal(e.target.closest('button')), { signal });
  // A phone turned over, or a browser tab resized, changes the strip's width after it mounted.
  row.ownerDocument.defaultView.addEventListener('resize', edges, { passive: true, signal });

  reveal(row.querySelector('.on'));
  edges();
  return { reveal, centre };
}
