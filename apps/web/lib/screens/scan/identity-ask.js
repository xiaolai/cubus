// The scan screen's identity question: the colours offered when the scanner cannot name the side
// in hand, and the way past it.
//
// Its own unit for the sticker picker's reason — it is its own conversation, with a person, about
// one thing — and its hazard is its own: the question is about a capture the scanner is HOLDING,
// so an answer must reach the panel while that capture is still the one being asked about. The
// panel refuses a stale answer itself (`answerIdentity` takes only a standing question and only a
// colour that question offers), and this draws only what the latest report says is open, so the two
// agree without either trusting the other. See dev-docs/asking-which-side-plan.md §3, §5 and §5a.

import { t } from '../../i18n.js';
import { COLOUR_NAMES } from '../../scheme.js';

/**
 * The identity question of one mounted scan screen, built hidden.
 *
 * @param {object} deps `root`; `classColor(i)`, the colour a swatch is painted — a detector CLASS,
 *   which has one hex on every cube, never a position's palette (ADR 0001 §8.5); `answer(colour)`
 *   and `skip()`, which reach the scanner.
 */
export function createIdentityAsk({ root, classColor, answer, skip }) {
  /**
   * WHICH question the press is about, taken when the press STARTS.
   *
   * THE ANSWER MUST NAME THE CAPTURE THE PERSON WAS LOOKING AT (Codex audit, 2026-09-25). These
   * buttons stand while the scan goes on reading — that is the design, §5's fourth bullet — so a
   * finger down on the question about one capture, a different colliding side settling under it,
   * and the click would have answered for the capture that replaced it. Reproduced. The id is
   * armed on `pointerdown` and spent on `click`; the scanner refuses a stale one either way, so
   * the two halves agree without either trusting the other.
   *
   * A KEYBOARD PRESS IS ARMED ON `keydown`, for exactly the same reason (Codex audit, 2026-09-25).
   * This used to fall back to whatever was drawn, on the argument that a keyboard press is
   * instantaneous — which is true of Enter, whose click fires on key DOWN, and false of Space,
   * whose click fires on key UP. A question replaced between the two answered for the capture that
   * arrived in the gap. A gesture is a gesture whichever device starts it.
   */
  let shownId = null;
  /** The gesture under way: which button it started on, and the question that was drawn then. */
  let armed = null;
  const arm = (el) => { armed = { el, id: shownId }; };
  /**
   * The keyboard half of `arm`: the two keys that activate a button, and nothing else.
   *
   * A REPEAT IS NOT A NEW GESTURE (Codex audit, 2026-09-26). Holding a key fires `keydown` over and
   * over, and re-arming on each one re-took the id that was CURRENT at the repeat — so a press begun
   * on question 7, held while the question was replaced, answered for 99. That is the window the id
   * exists to close, reopened by the very guard added to close it for Space.
   */
  const armKey = (el, ev) => {
    if (ev.repeat) return;
    if (ev.key === 'Enter' || ev.key === ' ') arm(el);
  };
  /**
   * The id this press is about.
   *
   * THE GESTURE'S OWN, NEVER RETARGETED (round-3 audit, 2026-09-25). The first version cleared the
   * armed id when the question went away, so a press begun on question 7 — the question vanishing
   * and question 99 arriving before the click — fell back to 99 and defeated the scanner's stale-id
   * guard entirely. A gesture keeps the id it started with; if that question has gone the scanner
   * refuses it, which is the whole point. Only a press on the SAME button spends its armed id: a
   * keyboard activation elsewhere has no gesture and takes what is drawn.
   */
  const spend = (el) => {
    const id = armed?.el === el ? armed.id : shownId;
    armed = null;
    return id;
  };
  const box = root.querySelector('#scanIdentity');
  // The screen's markup owns the element; without it there is nothing to draw into and saying so
  // is better than drawing a question nobody can answer.
  if (!box) throw new Error('the scan screen has no #scanIdentity to draw the question in');
  box.setAttribute('role', 'group');
  // NAMED PER REPORT, not once at build (see `show`). A swatch's colour is not an accessible name
  // on its own and the question the colours answer sits in a different element from them — and the
  // question is asked about two different things, only one of which anybody is holding.

  // WHAT THE QUESTION IS ABOUT, drawn. §3's argument for asking rather than instructing is that
  // "the answer labels a capture the scan is holding AND THE USER CAN SEE" — and an unplaced
  // capture has no tile, so without this the user can see every side except the one in question.
  // It is what the scanner READ, never a camera picture (dev-docs/scan-guidance-plan.md D2), and it
  // is decoration for a screen reader: the question and its answers carry the meaning.
  const grid = document.createElement('div');
  grid.className = 'id-seen';
  // THE SUBJECT, AND SOMEBODY READING WITH THEIR EARS NEEDS IT TOO (Codex audit, 2026-09-25). The
  // nine squares are what the question is ABOUT, and hiding them left a screen reader with a
  // question, six colours, and no way to tell which reading was being asked about. It is still not
  // read out square by square — nine colours in a row is not a description — but the middle sticker
  // is, because that is the one under discussion, and `describe` names it per report.
  grid.setAttribute('role', 'img');
  const cells = Array.from({ length: 9 }, () => {
    const c = document.createElement('i');
    grid.appendChild(c);
    return c;
  });
  box.appendChild(grid);

  /**
   * One swatch per colour class, each with its NAME under it (plan §3: "swatches and names").
   *
   * BOTH, and neither alone. The scan guides a child who cannot read, so the colour has to be
   * shown; and a colour alone is not a name for anyone reading with their ears or for an adult
   * checking which orange the app means. Built once — which ones are OFFERED is decided per report.
   */
  const swatches = COLOUR_NAMES.map((name, colour) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw';
    b.dataset.colour = String(colour);
    const dot = document.createElement('i');
    dot.style.backgroundColor = classColor(colour);
    const label = document.createElement('span');
    label.textContent = t(name);
    b.append(dot, label);
    // "It is WHITE" rather than "WHITE": the button makes a claim about the side in the hand, and
    // its accessible name should be the claim, not the paint.
    b.setAttribute('aria-label', t('It is %1').replace('%1', t(name)));
    b.onpointerdown = () => arm(b);
    b.onkeydown = (e) => armKey(b, e);
    b.onclick = () => answer(colour, spend(b));
    box.appendChild(b);
    return b;
  });
  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'btn sm outline';
  // A WAY OUT IS PART OF THE DESIGN (plan §3). A child who cannot name the colour, or an adult who
  // would rather show the side again, must not be held at a question.
  later.textContent = t('Skip this side');
  later.onpointerdown = () => arm(later);
  later.onkeydown = (e) => armKey(later, e);
  later.onclick = () => skip(spend(later));
  box.appendChild(later);

  /**
   * Draw the question this report carries, or take it away.
   *
   * ONLY THE OFFERED COLOURS ARE PRESSABLE, and they are read from the report every time rather
   * than remembered: sides go on being filed while the question stands, so a colour offered a
   * moment ago may be taken now. The panel refuses such an answer anyway; offering it would be a
   * button that does nothing, which is worse than one that is not there.
   *
   * OFFERED is not the same as FREE (owner, 2026-09-25). `choices` also carries the colour a side
   * already holds, because choosing it takes that side back — so this must go on reading the list
   * rather than recomputing one from the tiles, which would drop the answer the question exists
   * for.
   */
  const show = (p) => {
    const ask = p?.identity ?? null;
    box.hidden = !ask;
    // THE GESTURE IS NOT CLEARED HERE. A question that has gone must not hand its half-made press
    // to whatever arrives next — see `spend`.
    shownId = ask?.id ?? null;
    if (!ask) return;
    // Nobody is holding a DISPLACED reading — it is the side that just lost its slot — so the group
    // is named for what is actually being asked about.
    box.setAttribute(
      'aria-label',
      ask.displaced
        ? t('Which colour is in the middle of the side saved before this one?')
        : t('Which colour is in the middle of the side shown here?'),
    );
    // What the camera read in the middle of this side — the sticker the whole question is about.
    grid.setAttribute(
      'aria-label',
      t('The side shown here, read with %1 in the middle.').replace('%1', t(COLOUR_NAMES[ask.claimed] ?? '')),
    );
    // The nine as read. `colors[4]` is the middle sticker the scan could not place, and it is drawn
    // with the rest: the person is being asked to overrule it, so hiding it would hide the subject.
    for (const [i, cell] of cells.entries()) {
      cell.style.backgroundColor = classColor(ask.colors[i]);
    }
    const open = new Set(ask.choices);
    for (const [colour, b] of swatches.entries()) {
      b.hidden = !open.has(colour);
      // The colour BOTH sides are reading as, marked: it is the one thing the scanner measured
      // about this capture, and the person can see whether it agrees with the cube in their hand.
      b.classList.toggle('claimed', colour === ask.claimed);
    }
  };

  return Object.freeze({ show });
}
