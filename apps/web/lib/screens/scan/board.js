// The scan screen's board: the six tiles of the net — what every sticker is painted and called,
// the turn that settles a finished scan into its true layout, the roving keyboard point, and the
// captures the tiles show.
//
// Its own unit because three of the mount's handlers each wrote into the tiles by hand beside
// their other work — every scan report, a finished scan, and a scan that proved the other colour
// arrangement — which left the order they wrote in, and the state they shared, hard to verify
// (found by audit, 2026-09-13). The screen hands it a report, a finished scan's string or a moved
// arrangement; it asks the screen which arrangement the tiles are laid out in and whether painting
// is on. Lifted out of lib/screens/scan.js on 2026-09-14; pinned by the board, keyboard, settle
// and arrangement cases in test/scan-screen.test.mjs.

import { $, icon } from '../../app-state.js';
import { NET_FACES } from '../../cube-drawing.js';
import { COLOUR_NAMES, SCHEMES, SCHEME_COLOURS, colourOf, isColour, positionOf } from '../../scheme.js';

/** Does the centre at `position` differ between the arrangements — is it where a PAINTER swaps
 *  which of blue and yellow is under white (2026-09-20)? Answered from the scheme tables, never
 *  from a list kept beside them: a `Set(['D', 'B'])` here was the same fact written a second time,
 *  and exported mutable (audit-fix, 2026-09-21). Under ADR 0001 only D and B differ, and this says
 *  so without being told — and would say so of a third arrangement the day one joined the tables. */
export const swapsArrangement = (position) =>
  new Set(SCHEMES.map((scheme) => SCHEME_COLOURS[scheme][position])).size > 1;

/**
 * The board of one mounted scan screen, its roving tab stop placed. Nothing is painted here: the
 * template drew the pending tiles, and the first report paints over them.
 *
 * @param {object} deps `root`; `SCAN_FACE_NAME`, what each side is called; `positionColor(f,
 *   scheme)` and `classColor(i)`, the two conversions a sticker is painted through;
 *   `edgeColors(f, scheme)`, a tile's four borders; `slotFor(position)`, the capture a tile shows;
 *   `tileSchemeNow()`, the arrangement the tiles are laid out in, read at every use because a scan
 *   can move it; and `isPainting()`, which changes the presses a sticker is heard on.
 */
export function createScanBoard({
  root, SCAN_FACE_NAME, positionColor, classColor, edgeColors, slotFor, tileSchemeNow, isPainting,
}) {
  const tiles = [...root.querySelectorAll('.scan-face')];
  // What has been read so far, as a facelet string. Unread stickers are '?', which the renderer
  // draws as unknown rather than falling back to the face's own colour — otherwise a cube
  // nobody has scanned would render as solved. Captured sides appear in the rotation they were
  // SHOWN in; their true rotation is not known until all six are in, which is what the settle
  // at the end is for.
  const partialFacelets = (captured) => {
    // Captures are keyed by COLOUR and the string is by POSITION, so both directions go
    // through the arrangement: which capture sits at this position, and which position each
    // of its sticker colours belongs to.
    const bySlot = new Map(captured.map((c) => [c.face, c.colors]));
    return NET_FACES.map((f) => {
      const colors = bySlot.get(slotFor(f));
      return colors
        ? colors.map((c) => (isColour(c) ? positionOf(c, tileSchemeNow()) : '?')).join('')
        : '?'.repeat(9);
    }).join('');
  };
  // Which way up each side was held stops mattering the moment the cube reads as solvable: the
  // validated string IS the canonical layout, and the scanner reports each face's rotation.
  // A face captured the wrong way up TURNS to its true orientation — slowly enough to read as
  // "we turned this the right way up for you" — and the repaint lands in the same frame the
  // transform resets, so rotated-shown content and canonical content are pixel-identical at
  // the swap. Timer-driven, not transitionend-driven: the animation is cosmetic and must not
  // be load-bearing in an environment that never fires transition events (tests, reduced CSS).
  let turnTimers = [];
  const paintTile = (tile, fl) => {
    const fi = NET_FACES.indexOf(tile.dataset.face);
    const letters = fl.slice(fi * 9, fi * 9 + 9);
    [...tile.querySelectorAll('.cell')].forEach((c, i) => {
      // A letter is a POSITION, so it takes the arrangement's colour — the conversion the cell
      // names make from this same string. The raw palette drew a Japanese cube's Down stickers
      // yellow beside labels reading blue.
      c.style.backgroundColor = positionColor(letters[i], tileSchemeNow());
    });
  };
  /** Tiles still turning into their settled place. Their cells are in the order they were
   *  SHOWN while the panel already stores the side settled: index i names another sticker. */
  const turning = new Set();
  const clearTurns = () => {
    for (const t of turnTimers) clearTimeout(t);
    turnTimers = [];
    turning.clear();
    for (const tile of tiles) {
      const g = tile.querySelector('.tgrid');
      g.style.transition = '';
      g.style.transform = '';
    }
  };
  const settleTiles = (fl, rotations) => {
    clearTurns();
    for (const tile of tiles) {
      // Rotations are reported in SLOT order — one per capture — so a tile reads the entry
      // for the capture it shows, not for its own position.
      const k = rotations?.[NET_FACES.indexOf(slotFor(tile.dataset.face))] ?? 0;
      if (!k) { paintTile(tile, fl); continue; }
      const g = tile.querySelector('.tgrid');
      const deg = k === 3 ? -90 : k * 90; // a 270° CW turn reads better as 90° back
      const ms = k === 2 ? 800 : 500; // unhurried on purpose — this is the explanation
      g.style.transition = `transform ${ms}ms ease`;
      g.style.transform = `rotate(${deg}deg)`;
      turning.add(tile);
      turnTimers.push(setTimeout(() => {
        g.style.transition = 'none';
        g.style.transform = '';
        paintTile(tile, fl);
        turning.delete(tile);
      }, ms + 30));
    }
  };
  const paint = (cells, colors) => cells.forEach((c, i) => {
    c.style.backgroundColor = classColor(colors[i]);
  });
  /**
   * Redraw what the TEMPLATE painted from the arrangement — each tile's four edge colours and
   * its centre hint. The template runs once, before any verdict; when a scan proves the other
   * arrangement the two tiles trade places and this is what makes the furniture agree with
   * the cube rather than with what the app assumed a moment ago.
   */
  const repaintTileFurniture = () => {
    for (const tile of tiles) {
      const f = tile.dataset.face;
      tile.querySelector('.tile').style.borderColor = edgeColors(f, tileSchemeNow());
      const centre = tile.querySelectorAll('.cell')[4];
      if (!tile.classList.contains('done')) {
        centre.style.backgroundColor = positionColor(f, tileSchemeNow());
      }
    }
  };
  // The six sides are the cube's net, everywhere (decided 2026-08-30). There used to be a
  // second arrangement for a finger in portrait — one face large over a strip of five — and
  // with it a `.focus` class, a `--focus` flag read back out of the stylesheet, and a tap
  // that meant "show me this side" on a strip tile and "correct this sticker" anywhere
  // else. All of it is gone with the layout it served: no rule styles `.focus` any more, so
  // keeping the machinery would have been a switch with one position. What the removal
  // costs is written down where the decision is (dev-docs/stage-contract.md).
  const faces = $('.scan-faces', root);

  // ---- the board's keyboard path ---------------------------------------------------------------
  // 54 stickers are 54 buttons, but ONE tab stop: the board is a composite widget with a
  // roving tabindex. Tab lands on it once; the arrows walk the stickers (Left/Right by one,
  // Up/Down by a row within a side, Home/End to the board's ends); Enter is the click the
  // pointer would have made, heard by the same delegated listener. Every cell is inspectable
  // by arrow — its label carries the side, the position and the reading — and aria-disabled
  // says which ones a press will be refused on, without swallowing the event the way real
  // `disabled` would.
  const cellButtons = tiles.flatMap((tile) => [...tile.querySelectorAll('.cell')]);
  let roveAt = cellButtons.indexOf(
    tiles.find((tile) => tile.dataset.face === 'F').querySelector('.cell'));
  const setRove = (idx) => {
    cellButtons[roveAt].setAttribute('tabindex', '-1');
    roveAt = Math.max(0, Math.min(cellButtons.length - 1, idx));
    cellButtons[roveAt].setAttribute('tabindex', '0');
  };
  setRove(roveAt);
  faces.addEventListener('keydown', (ev) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }[ev.key];
    const jump = ev.key === 'Home' ? 0 : ev.key === 'End' ? cellButtons.length - 1 : null;
    if (step === undefined && jump === null) return;
    ev.preventDefault();
    setRove(jump ?? roveAt + step);
    cellButtons[roveAt].focus();
  });
  // A pointer can land focus anywhere; the roving point follows it rather than fighting it.
  faces.addEventListener('focusin', (ev) => {
    const i = cellButtons.indexOf(ev.target);
    if (i >= 0) setRove(i);
  });

  /** The captures the tiles show — the last report's, or a finished scan's, rebuilt from it. */
  let lastCaptured = [];
  /** The capture on show for the tile at position `f`, if any. */
  const captureAt = (f) => lastCaptured.find((c) => c.face === slotFor(f));

  /** What a press on a tile's centre does, as ONE record: its `kind` — `'rescan'`, `'swap'`, or
   *  null for a centre that only names its side — its `name` (the label and the title, so the
   *  hover and the screen reader agree on it) and its `icon`. The names, the glyph and the
   *  screen's click dispatch all read this one record; each derived it for itself before, so the
   *  cell could be named and enabled for a press the handler then refused (audit-fix, 2026-09-21).
   *  While painting it is the swap on the two tiles whose centre the two arrangements disagree
   *  about, and nothing on the other four — a camera capture on show changes nothing, there being
   *  no camera to re-read with; with the camera it re-reads a side already read. Named for the
   *  press it makes rather than for the side alone, because the same cell is three different
   *  controls across the modes (2026-09-20). */
  const centreAction = (f, got) => {
    const names = { kind: null, name: `${SCAN_FACE_NAME[f]} side centre — it names the side`, icon: null };
    if (isPainting()) {
      return swapsArrangement(f)
        ? { kind: 'swap', name: `${SCAN_FACE_NAME[f]} side centre — press to swap which of blue and yellow is under white`, icon: 'repeat' }
        : names;
    }
    return got ? { kind: 'rescan', name: `Scan the ${SCAN_FACE_NAME[f]} side again`, icon: 'refresh' } : names;
  };
  /** The centre's action for the tile at position `f`, as the board stands now — what the
   *  screen's click handler dispatches on, so a press does exactly what the cell said it would. */
  const centreActionOf = (f) => centreAction(f, captureAt(f));
  /** The centre cell, dressed for its action: named, marked actionable or not, and wearing the
   *  glyph of what a press does. `data-action` is what the stylesheet keys the pointer, the glyph
   *  and the hover ring on, so a centre with nothing to do shows nothing to do — it was keyed on
   *  the tile being read, which showed a re-read glyph over a press painting refuses and none over
   *  the swap (audit-fix, 2026-09-21). The glyph is rewritten only when the action changes: every
   *  report refreshes the names. */
  const dressCentre = (c, action) => {
    c.setAttribute('aria-disabled', String(action.kind === null));
    c.setAttribute('aria-label', action.name);
    c.title = action.name;
    if ((c.dataset.action ?? null) === action.kind) return;
    if (action.kind) {
      c.dataset.action = action.kind;
      c.innerHTML = icon(action.icon, 15);
    } else {
      delete c.dataset.action;
      c.innerHTML = '';
    }
  };
  /** Names and actionability for all 54 cells, refreshed on every capture and every paint
   *  toggle: the label is how a screen reader inspects the board the way an eye does, and
   *  aria-disabled marks the cells whose press the handler will refuse (a pending outer
   *  sticker; the centre before its side is read, or, while painting, any centre but the two
   *  that swap the arrangement). */
  const refreshCellNames = () => {
    for (const tile of tiles) {
      const f = tile.dataset.face;
      const got = captureAt(f);
      [...tile.querySelectorAll('.cell')].forEach((c, i) => {
        if (i === 4) {
          dressCentre(c, centreAction(f, got));
          return;
        }
        c.setAttribute('aria-disabled', String(!(Boolean(got) || isPainting())));
        // The COLOUR it was read as. Naming a side here ("read as the Back side's colour")
        // was the Western identity in a sentence: blue is the back of most cubes and the
        // bottom of an older one, and the camera read a colour either way.
        const read = got
          ? `read as ${COLOUR_NAMES[got.colors[i]] ?? 'an unknown colour'}`
          : 'not read yet';
        c.setAttribute('aria-label', `${SCAN_FACE_NAME[f]} side, sticker ${i + 1} — ${read}`);
      });
    }
  };
  // The scanner's current misread suspects, kept so the colour picker can ring the suggested
  // colour when it opens on one of them.
  let suspects = [];

  /** One tile, drawn from a report: read or still pending, asked for again or not, its suspected
   *  stickers, and what its nine stickers are painted. Lifted out of `paintProgress` (audit-fix,
   *  2026-09-21), which drew all six here beside its own two jobs. */
  const paintTileReport = (tile, p) => {
    const f = tile.dataset.face;
    const got = p.captured.find((c) => c.face === slotFor(f));
    const cells = [...tile.querySelectorAll('.cell')];
    tile.classList.toggle('done', Boolean(got));
    // A nearly-solved cube can read as several different cubes; the scanner then names one
    // side to show again, held a stated way up. Point at it — the sentence alone makes a
    // child hunt through six tiles for the colour it named.
    tile.classList.toggle('asked', p.confirm?.face === slotFor(f));
    // Same pointing for a suspected misread: the sticker whose fix would make the cube
    // legal pulses, so "one sticker looks wrong" never sends anyone hunting either.
    const sus = suspects.filter((s) => s.face === slotFor(f));
    cells.forEach((c, i) => c.classList.toggle('suspect', sus.some((s) => s.index === i)));
    // On 'done' the captures are already canonical and the settle turn owns the repaint —
    // painting them here would snap the tiles canonical before the turn starts.
    if (got && p.phase !== 'done') paint(cells, got.colors);
    else if (!got) {
      cells.forEach((c, i) => {
        c.style.backgroundColor = i === 4
          ? positionColor(f, tileSchemeNow()) : 'var(--facelet-off)';
      });
    }
  };

  /** A scan report, drawn: the suspects the picker reads, every tile, and every sticker named
   *  for what it now shows. */
  const paintProgress = (p) => {
    suspects = p.suspects ?? [];
    for (const tile of tiles) paintTileReport(tile, p);
    paintHeld(p.held ?? []);
    lastCaptured = p.captured;
    refreshCellNames();
  };

  /** The side that has been READ but has no face yet — see `.scan-held` in index.html.
   *
   *  A side whose centre nobody could read is held until `resolveCentres` places it at six, and
   *  `captured` lists only sides WITH a face — so without this the scan says "Got that side" and
   *  the board shows nothing, which on a logo-centre cube is the first side a person shows.
   *
   *  THE UNREAD CENTRE IS DRAWN AS UNKNOWN, never as a colour: nobody has seen it, and the whole
   *  reason the side is held is that it cannot be named yet. Only the first held side is drawn —
   *  a second is vanishingly rare and a second cell would cost the net a column. */
  const paintHeld = (held) => {
    const slot = $('.scan-held', root);
    if (!slot) return;
    const side = held[0];
    slot.hidden = !side;
    if (!side) return;
    const cells = [...slot.querySelectorAll('.cell')];
    cells.forEach((c, i) => {
      const colour = side.colors[i];
      // Negative is UNREAD_CENTRE — the scanner's "nobody read this", not a sixth colour.
      c.style.backgroundColor = colour >= 0 ? classColor(colour) : 'var(--facelet-off)';
      c.textContent = colour >= 0 ? '' : '?';
    });
  };

  /** A finished scan: each tile turns into, or repaints in, the validated layout, and every
   *  sticker is renamed from the same string. */
  const settle = (fl, rotations) => {
    settleTiles(fl, rotations);
    // Back into capture terms: each position's nine letters become the colours the
    // arrangement paints there, filed under the capture that carries them.
    lastCaptured = NET_FACES.map((f, fi) => ({
      face: slotFor(f),
      colors: [...fl.slice(fi * 9, fi * 9 + 9)].map((ch) => colourOf(ch, tileSchemeNow())),
    }));
    refreshCellNames();
  };

  /** The captures the tiles show: the last report's, or a finished scan's, rebuilt from it. */
  const captured = () => lastCaptured;
  /** Whether `tile` is still turning into its settled place. */
  const isTurning = (tile) => turning.has(tile);
  /** The scanner's suspect at sticker `index` of the capture `slot`, when it has one. */
  const suspectAt = (slot, index) => suspects.find((s) => s.face === slot && s.index === index);

  return Object.freeze({
    paintProgress, settle, clearTurns, repaintTileFurniture, refreshCellNames, partialFacelets,
    captured, isTurning, suspectAt, centreActionOf,
  });
}
