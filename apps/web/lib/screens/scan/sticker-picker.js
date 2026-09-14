// The scan screen's sticker picker: the six colours offered over a sticker a person is correcting,
// the sticker it is open over, and the moment that sticker stops showing what it opened on.
//
// Its own unit because it is its own conversation — with a person, about one sticker — and its
// hazard is its own: left open while the board changes under it, it writes a colour to a sticker
// nobody chose (found by audit, 2026-09-13). The screen decides whether a press may open it and
// closes every popover first; the picker asks the board which captures the tiles show, whether a
// tile is still turning and which stickers the scanner suspects. Lifted out of
// lib/screens/scan.js on 2026-09-14; pinned by the picker cases in test/scan-screen.test.mjs.

import { COLOUR_NAMES } from '../../scheme.js';
import { placePopoverV, popoverLeft, stageRect } from '../../screen-shell.js';

/**
 * The colour picker of one mounted scan screen, built closed and appended to `root`.
 *
 * @param {object} deps `root`; `paint(slot, index, colour)`, which hands a chosen colour to the
 *   scanner; `classColor(i)`, the colour a swatch is painted; `slotFor(position)`, the capture a
 *   tile shows; and the screen's `board`, for the captures on show, a tile still turning, and the
 *   scanner's suspects.
 */
export function createStickerPicker({ root, paint, classColor, slotFor, board }) {
  const swatches = document.createElement('div');
  swatches.className = 'swatches';
  swatches.hidden = true;
  // Named like the app's other icon-only controls: a colour alone is not an accessible name,
  // and `title` is the weakest carrier of one.
  swatches.setAttribute('role', 'group');
  swatches.setAttribute('aria-label', 'Pick this sticker’s colour');
  root.appendChild(swatches);
  let editing = null;
  /** A slot's capture as text: what an open picker was opened over. */
  const readingOf = (captured, slot) => captured.find((c) => c.face === slot)?.colors.join() ?? '';
  /** Has the open picker's sticker stopped showing what it opened on? It has when the
   *  arrangement moved another capture onto its tile, when that capture was replaced or thrown
   *  away, or while the tile turns — each would write the colour to a sticker nobody chose. */
  const editIsStale = () => editing !== null && (slotFor(editing.face) !== editing.slot
    || readingOf(board.captured(), editing.slot) !== editing.reading
    || board.isTurning(editing.el.closest('.scan-face')));
  const closeSwatches = () => {
    // Hand focus back to the cell that opened the picker — but only when focus is INSIDE it
    // (the keyboard path); a pointer click elsewhere keeps the focus it just placed.
    const back = editing?.el && swatches.contains(document.activeElement) ? editing.el : null;
    swatches.hidden = true;
    editing = null;
    root.querySelector('.scan-face .cell.editing')?.classList.remove('editing');
    back?.focus();
  };
  // Six COLOURS, named as colours. The picker used to iterate the six face letters and pass
  // the letter's index as the colour class — the Western identity again, and the one place a
  // user could have picked "the Back side's colour" and got blue on a cube whose back is
  // yellow. A sticker is set to a colour; where that colour lives is the arrangement's
  // business, not this control's.
  for (let colour = 0; colour < COLOUR_NAMES.length; colour++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.backgroundColor = classColor(colour);
    b.title = COLOUR_NAMES[colour];
    b.setAttribute('aria-label', `Make it ${COLOUR_NAMES[colour]}`);
    b.dataset.colour = String(colour);
    b.onclick = () => {
      if (editing) paint(editing.slot, editing.index, colour);
      closeSwatches();
    };
    swatches.appendChild(b);
  }

  /** Open over sticker `index` of `tile`, whose cell is `cellEl`. The screen has already decided a
   *  press there corrects, and closed every popover. */
  const openAt = (tile, cellEl, index) => {
    const slot = slotFor(tile.dataset.face);
    editing = {
      face: tile.dataset.face, slot, index, el: cellEl, reading: readingOf(board.captured(), slot),
    };
    cellEl.classList.add('editing');
    // Mark the colour already there, so the picker shows what it is changing FROM — and, when
    // this sticker is a misread suspect, ring the colour the scanner reckons it should be.
    const current = cellEl.style.backgroundColor;
    const sug = board.suspectAt(editing.slot, index);
    for (const b of swatches.children) {
      b.classList.toggle('now', b.style.backgroundColor === current);
      b.classList.toggle('suggest', sug !== undefined && Number(b.dataset.colour) === sug.to);
    }
    swatches.hidden = false;
    // Anchored below the TILE, not below the sticker: a picker covering the very sticker you
    // are correcting hides the thing you need to look at. Centred on the sticker in stage
    // coordinates, and clamped so an edge tile keeps it on the stage.
    const cellRect = cellEl.getBoundingClientRect();
    const tileRect = tile.getBoundingClientRect();
    const s = stageRect();
    const w = swatches.offsetWidth;
    const left = popoverLeft(cellRect.left - s.left + cellRect.width / 2 - w / 2, w, s.width);
    swatches.style.left = `${left}px`;
    placePopoverV(swatches, tileRect); // below the tile, or above it when that is the room there is
    // The keyboard path continues where the pointer's does: focus lands on the colour the
    // sticker already has (or the first chip), and closeSwatches hands it back to the cell.
    (swatches.querySelector('.now') ?? swatches.firstElementChild)?.focus();
  };
  /** Close it when its sticker has stopped showing what it opened on. */
  const closeIfStale = () => { if (editIsStale()) closeSwatches(); };
  /** A press anywhere but the picker closes it. */
  const closeUnless = (target) => {
    if (!swatches.hidden && !swatches.contains(target)) closeSwatches();
  };

  return Object.freeze({ openAt, close: closeSwatches, closeIfStale, closeUnless });
}
