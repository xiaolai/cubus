// The Shapes screen: every picture the app can take a cube to, as a grid.
//
// THE SCREEN §9.6 SAID WOULD BE NEEDED, built when it was (owner, 2026-10-04). The cube screen's
// menu held all five pictures there were, and `lib/patterns.js` recorded what offering more would
// cost: "a grid you sort, filter or scroll has become the primary region, and 'only a new
// COMPOSITION is a new screen' makes that a screen of its own, sibling to Lessons". The catalogue is
// twenty now, so this is that screen, and the menu is the five last chosen plus a way through to
// here (`lib/shape-recency.js`).
//
// IT IS NOT A TAB, and that is deliberate. `NAV` is the beginner's path to a solved cube and the
// pictures are the game beside it — a tab would put them in the same row as Restore, which is the
// drift §9.6 spent a fortnight refusing, one level up. It is reached from the cube screen's Shapes
// menu and addressable as `#/shapes` like every other screen, so a reload lands back here.
//
// NOTHING HERE IS A NEW LAYOUT. It is the TRAINER's composition — a full-width flex column whose
// last child is `.case-grid`, the wrapping grid the Trainer and the Drill library already use: as
// many 140px cards as the width holds, which is container-driven and so needs no viewport query
// (`test/layout-queries.test.mjs`).
//
// AND DELIBERATELY NOT `.cols.flow`, which is what this screen was written with first. That is the
// app's LIST composition, and in landscape it cuts the column to `--ref-w * 0.58` and leaves the
// `sheet` area for an aside. This screen has no aside, so half a landscape stage was simply blank:
// measured at 1180×820, the grid fitted THREE cards across and scrolled, against six with the
// column removed. A list is a column by nature and a catalogue is not — twenty pictures want the
// width. (The Drill library has the same shape and the same empty half; that is its own call to
// make, and is not changed here.)
//
// AND NO MOVE COUNT IS DRAWN. The ledger proves a minimum for each picture FROM SOLVED, and the
// cube in a child's hands is almost never solved — so a number here would be a true figure
// answering a question nobody asked, and a child comparing it with the count the walk then shows
// would conclude one of the two is wrong. The route says the real distance once a picture is chosen.

import { escHtml, icon, state } from '../app-state.js';
import { t } from '../i18n.js';
import { OFFERED_PATTERNS, selectionOf } from '../patterns.js';
import { SCREENS, go } from '../screen-shell.js';
import { rememberShape } from '../shape-recency.js';
import { shapeThumb } from '../shape-thumb.js';

/** The thumbnail's drawn width. A net is twelve stickers across, so 132px leaves each one 11px —
 *  the smallest at which a 3x3 face still reads as a face rather than as a smudge. It sits inside
 *  `.case-grid`'s 140px minimum, so the card never has to shrink its picture to fit. */
const THUMB = 132;

/**
 * One picture, as the button that chooses it.
 *
 * `data-shape`, NEVER `data-stage`. Every `[data-stage]` in the app is a press the walk session's
 * one group wires and paints (`wireGroup` in lib/walk-session.js), and there is no walk session on
 * this screen — so the attribute would be a promise nothing keeps, and the look it paints (`.on`,
 * `aria-pressed`) would be written by nobody. This screen owns its own presses and its own marking.
 *
 * The name is the accessible name AND the caption, and it goes in as escaped text both times: the
 * picture is markup from `shape-thumb.js`, the name is not markup at all.
 */
const shapeCard = (pattern, chosen) => {
  const id = selectionOf(pattern);
  const on = id === chosen;
  return `<button class="card shape-entry" data-shape="${escHtml(id)}" id="shape-${escHtml(id)}"
    aria-pressed="${on}" aria-label="${escHtml(pattern.name)}"
    style="text-align:center;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:flex-start${on ? ';box-shadow:inset 0 0 0 2px var(--accent)' : ''}">
    ${shapeThumb(pattern, THUMB)}
    <div class="sub" style="color:var(--ink-3);line-height:1.35">${escHtml(pattern.name)}</div>
  </button>`;
};

SCREENS.shapes = () => {
  // Read once, for the whole render: which picture the cube is aiming at right now. A STAGE being
  // on is an ordinary answer and marks nothing here — `patternBySelection` would answer null and
  // every card draws unpressed, which is correct: no picture is chosen.
  const chosen = state.stageTarget;
  return {
    // A flex column at the full size of the stage, which is the Trainer's root — `.case-grid`
    // carries `flex: 1; min-height: 0; overflow-y: auto`, so it needs a flex parent that is the
    // stage's own height or it has nothing to scroll inside.
    //
    // `min-height: 0` IS LOAD-BEARING, and leaving it off is a bug that no gate caught. `.screen`
    // is `display: grid; place-items: center`, so its child is a centred grid item whose automatic
    // minimum is its CONTENT — `height: 100%` alone did not stop the root growing past the stage,
    // and `.case-grid` then had no bound to scroll within. Measured at 430×932 before the fix: the
    // root was 2019px tall inside an 805px screen and TWELVE of the twenty pictures were clipped
    // away with no way to reach them. It does not show in the Trainer, which has the same root and
    // six cards, and `geometry.test.mjs`'s "drawn beyond the stage" check reads LEFT and RIGHT only
    // — so the whole browser tier passed over it. The assertion added there is the other half of
    // this fix.
    html: `<div style="width:100%;height:100%;min-height:0;display:flex;flex-direction:column;gap:14px">
      <div class="card" style="padding:12px 16px;display:flex;gap:10px;align-items:center;flex:none">
        <span class="ico" style="color:var(--ink-5);flex:none">${icon('box', 16)}</span>
        <div class="sub" style="color:var(--ink-3);line-height:1.5">${escHtml(t('Pick a picture and the app walks your cube to it. The same moves backwards bring it home again.'))}</div>
      </div>
      <div class="wrap-row" style="flex:none">
        <button class="pill" data-go="home">${escHtml(t('Back to the cube'))}</button>
        <span class="sub" style="margin-left:auto;color:var(--ink-4)">${escHtml(t('%1 shapes', OFFERED_PATTERNS.length))}</span>
      </div>
      <!-- NO LIST ROLE. Its children are buttons rather than list items, so declaring one would
           describe a structure that is not there — the same note the Drill library carries, and
           for the same reason. The count above already says how many there are.
           NO BACKTICK IN THIS COMMENT: it ships inside the screen's template literal. -->
      <div class="case-grid" id="shapeGrid">${OFFERED_PATTERNS.map((p) => shapeCard(p, chosen)).join('')}</div>
    </div>`,
    mount(root) {
      for (const b of root.querySelectorAll('[data-shape]')) {
        b.onclick = () => {
          const id = b.dataset.shape;
          // THE ORDER MATTERS. The target is set and the choice recorded BEFORE navigating, because
          // `go` replaces this screen synchronously when the hash does not change — and it does not
          // change here, since this screen is leaving for a different one. Writing after the
          // navigation would be writing on behalf of a screen that has already been torn down.
          state.stageTarget = id;
          // Recorded on THIS screen's press as well as the menu's, because this is where the
          // fifteen pictures the menu does not hold are chosen — without it, a shape found here
          // could never make its way into the menu and the recency would only ever shuffle the five
          // it started with.
          rememberShape(id);
          // STRAIGHT TO THE CUBE, not a selection left standing here. A picture is a destination for
          // the cube in the child's hands, and the walk to it is on the cube screen; a grid that
          // merely ticked one and waited would be a settings page about the next solve.
          go('home');
        };
      }
    },
  };
};
