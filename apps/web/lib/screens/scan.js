// Restore — the screen that reads your cube with the camera. Its route id stays `scan`.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { isDesktopHost } from '../host.js';
import { t } from '../i18n.js';
import {
  COLOUR_NAMES, colourOf, colourOfSlot, isColour, isScheme, positionOf, slotAt, slotOf,
} from '../scheme.js';

import { $, escHtml, icon, state } from '../app-state.js';
import { DEFAULT_PALETTE, settings } from '../app-settings.js';
import { hooks } from '../screen-slots.js';
import { CHIP_NODE_BUDGET, stageAsk, warmSolver } from '../solver-service.js';
import { NET_COLORS, NET_FACES, adoptScheme, netPalette, newCube } from '../cube-drawing.js';
import { keepAwake } from '../wake-lock.js';
import { adoptCube } from '../cube-connection.js';
import { rememberLastSeen, repairTracking } from '../cube-reports.js';
import { markStale } from '../cube-trust-state.js';
import { SCREENS, go, placePopoverV, screenAbort, stageRect } from '../screen-shell.js';

import { createStageChips } from './scan/stage-chips.js';
import { createScanVoice } from './scan/voice.js';
import { createCameraMenu } from './scan/camera-menu.js';
import { createReconnectCheck } from './scan/reconnect-check.js';

// Restore — the screen that reads your cube so it can be solved. Its route id stays `scan`, and
// renaming it is not worth breaking every #/scan link and bookmark already in the wild.
// The camera opens the moment this screen mounts — <ai-scan-panel headless autostart>
// sits in the markup invisibly, owning the camera, the model and the capture state machine, and
// reports every change through `scan-progress`. The whole six-face flow happens right here: no
// modal, and deliberately no camera picture. What the user needs to see is what the scanner READ,
// so the live 3x3 below is the viewfinder. Colour class i <-> FACES[i] <-> NET_FACES[i], so a
// scanned sticker is painted in the app's own palette, matching the 3D cube beside it.
const SCAN_FACE_NAME = { U: 'Up', R: 'Right', F: 'Front', D: 'Down', L: 'Left', B: 'Back' };
// Which side neighbours each face, in the canonical URFDLB facelet layout — so a tile can paint
// its four edges in the neighbours' colours and show, without words, which way up to hold that
// side. Not invented here: derived from EDGE_FACELET in packages/cube-scanner/src/facelet-cube.ts,
// whose twelve facelet pairs give all 24 (face, side) answers. A test in that package re-derives
// it and asserts this exact table, so a layout change fails there and names this file.
const FACE_EDGES = {
  U: { top: 'B', right: 'R', bottom: 'F', left: 'L' },
  R: { top: 'U', right: 'B', bottom: 'D', left: 'F' },
  F: { top: 'U', right: 'R', bottom: 'D', left: 'L' },
  D: { top: 'F', right: 'R', bottom: 'B', left: 'L' },
  L: { top: 'U', right: 'F', bottom: 'D', left: 'B' },
  B: { top: 'U', right: 'L', bottom: 'D', left: 'R' },
};

SCREENS.scan = () => {
  // TWO CONVERSIONS, and they must not be one (ADR 0001 §8.5). A detector CLASS is a colour and
  // has one hex on every cube — `slotOf` names it, and no scheme is involved, because a yellow
  // sticker is yellow whichever kind of cube it came off. A POSITION is a tile of the net and
  // takes its colour from the palette remapped for the arrangement. Painting a class through the
  // positional palette is the bug this pair exists to make unwritable: under a Japanese remap,
  // class 3 (yellow) would have been drawn blue.
  const pal = NET_COLORS[settings.palette] || NET_COLORS[DEFAULT_PALETTE];
  const classColor = (i) => pal[slotOf(i)] || 'var(--facelet-off)';
  const positionColor = (f, scheme) => netPalette(scheme)[f] || 'var(--facelet-off)';
  // background-COLOR, not the shorthand: a colour is all this ever sets, and the shorthand would
  // reset background-image and friends alongside it. (It is also the only form a DOM can report
  // back reliably — happy-dom drops `style.background = '#hex'` silently, which quietly blinded
  // every test that tried to assert what a sticker had been painted.)
  // Face letters are positions; a person checking their cube sees colours. Same scheme the
  // scanner's own GUIDE uses, and the same one every palette here is built on.
  // A sticker is a BUTTON: correcting it by pointer and by keyboard are one path, because a
  // button's keyboard activation IS a click — the delegated listener cannot tell them apart.
  // tabindex −1 on every cell: the board is one tab stop and the arrows rove (see the mount).
  const cell = (bg) => `<button type="button" class="cell" tabindex="-1" style="background-color:${bg}"></button>`;
  // A pending tile is nine dim wells with the face's own colour in the centre, so the board reads
  // "the yellow side is still missing" without a legend.
  const pending = (f) => Array.from({ length: 9 }, (_, i) => cell(i === 4 ? positionColor(f, settings.scheme) : 'var(--facelet-off)')).join('');
  // border-color takes top/right/bottom/left in that order — the same order FACE_EDGES names.
  const e = (f) => FACE_EDGES[f];
  // The four sides that border this tile, in the colours the arrangement gives them — how a user
  // knows which way up to hold a side. Positions, so they follow the scheme.
  const edgeColors = (f, scheme) => {
    const c = (p) => positionColor(p, scheme);
    return `${c(e(f).top)} ${c(e(f).right)} ${c(e(f).bottom)} ${c(e(f).left)}`;
  };
  // The panel is registered by a module script; if that has not landed yet the element is still
  // inert, so say so rather than claiming a camera is opening.
  const registered = Boolean(customElements.get('ai-scan-panel'));
  // --primary-share 0.66, not the default 0.58: the net wants the room, and the sheet is a cube
  // twin and a paragraph. `twin-low`: in portrait the twin sits beside the sheet, not beside the
  // cross — the cross is the same cross in both windows and wants the width (index.html). Only a
  // net in both compositions and on every platform (.scan-faces).
  //
  // `facing="environment"` off the desktop, and it is not a preference — it is which way the
  // camera points. A handheld has two, and only one of them can see a cube you are holding;
  // getUserMedia with no constraint hands over the platform's default, which on a phone is the
  // front one, so the scanner opened pointed at your face. Desktops are deliberately left
  // asking for nothing: there a facing mode names a different physical machine rather than a
  // different lens (packages/cube-scanner/src/camera.ts says so at the constraint itself).
  // A pinned camera still wins over this — deviceId is checked first — so choosing one from the
  // menu is never overridden by the hint.
  return {
    html: `<div class="cols twin-low" style="--primary-share:0.66">
    <div class="col">
      <div class="card scanboard">
        <ai-scan-panel headless autostart scheme="${settings.scheme}"${isDesktopHost() ? '' : ' facing="environment"'}></ai-scan-panel>
        <div class="scan-faces">${NET_FACES.map((f) => `<div class="scan-face" role="group" aria-label="${SCAN_FACE_NAME[f]} side" data-face="${f}">
          <div class="tile" style="border-color:${edgeColors(f, settings.scheme)}"><div class="tgrid">${pending(f)}</div></div><div class="lbl">${SCAN_FACE_NAME[f]}</div></div>`).join('')}</div>
        <div class="scan-cam card-tools">
          <button id="scanResetBtn" title="Throw the whole scan away and start again" aria-label="Throw the whole scan away and start again">${icon('refresh', 19)}</button>
          <button id="scanPaintBtn" title="Paint the cube by hand instead of scanning it" aria-label="Paint the cube by hand instead of scanning it">${icon('paint-roller', 19)}</button>
          <button id="scanCamBtn" title="Camera" aria-label="Camera and scan menu">${icon('webcam', 20)}</button>
        </div>
      </div>
    </div>
    <div class="aside">
      <div class="card twin"><div class="eyebrow">DETECTED STATE</div>
        <div class="cube-slot" id="scanCube"></div></div>
      <div class="sheet scan-sheet">
        <div class="card"><b style="font-size:var(--fs-body-l)" id="scanHowTitle">How it works</b>
          <div class="sub scan-say" id="scanHow" role="status" aria-live="polite" style="margin-top:4px">${registered ? 'Opening the camera…' : 'Loading the scanner…'}</div>
          <div class="sub scan-hint" id="scanHint" hidden></div>
          <button class="btn sm outline" id="scanAction" hidden style="margin-top:10px"></button></div>
        <!-- HOW FAR BACK: one chip per named stage, plus the whole cube. Shown after a scan the
             app believed, and never before — a number about a cube nobody has read is a number
             about nothing. §9.2 decided they appear unasked: a chip reading "done" is an
             encouragement, not a chore, and six numbers is the most useful single screen this app
             has for a parent watching.
             The chips report DISTANCES. They never report what the child was doing — a cube
             carries no history, and SOLVED then U satisfies the top cross whether it came from a
             finished stage or from somebody's opening scramble (§1).
             (No backticks in here: this comment lives inside a template literal, and one would
             end the template two hundred lines early.) -->
        <div class="card tight" id="stageCard" hidden style="margin-top:12px">
          <div class="card-h bare"><b>${escHtml(t('How far back'))}</b><span class="sub" id="stageSay" role="status" aria-live="polite" style="margin-left:auto;color:var(--ink-4)"></span></div>
          <div class="stage-row" id="stageChips" style="padding:2px 18px 12px"></div>
        </div>
        <button class="btn primary block" id="scanSolveBtn" data-go="home" style="margin-top:auto" disabled>Solve this cube</button>
      </div>
    </div></div>`,
    mount(root) {
      // Captured at the top of the mount, never read late: by the time anything here awaits, the
      // module-level controller may already belong to the screen that replaced this one.
      const signal = screenAbort?.signal;
      /**
       * The arrangement the SIX TILES are laid out in: what the app assumes, until a scan
       * establishes otherwise (ADR 0001 §8.3). Every tile is a POSITION and every capture is a
       * COLOUR, so this is what says which capture belongs on which tile — the blue capture is
       * the Down tile's on a Japanese cube and the Back tile's on a Western one.
       *
       * `let`, and updated from the scanner's verdict on every report: a scan that proves the
       * other arrangement must move the two tiles under the user, not keep painting the cube it
       * assumed. `'undetermined'` is not a scheme and leaves this as it was.
       */
      let tileScheme = settings.scheme;
      /** The slot whose capture belongs on the tile for `position`. */
      const slotFor = (position) => slotAt(position, tileScheme);
      /** …and back: the tile a capture is drawn on. */
      const tileOf = (slot) => positionOf(colourOfSlot(slot), tileScheme);
      // Both hands are on a cube in front of a camera for the length of a scan, so nothing tells
      // the platform anybody is still here. The display sleeping mid-scan is the interruption
      // this audience does not recover from.
      const releaseScanAwake = keepAwake();
      // Kept, so a finished scan can update the aside in place. Re-rendering the screen would tear
      // down the scanner element and reopen the camera for a scan that has just ended.
      const stateCube = newCube();
      // Ghosts float the faces the camera angle hides, so all six are readable at once — which is
      // the whole job of a twin meant to show what has been read so far. The rest match the
      // renderer's own defaults today and are pinned anyway: this twin has a job (read six sides at
      // a glance) that a future change to those defaults should not quietly retune.
      stateCube.setAttribute('ghosts', 'floating');
      // Tuned by eye against a half-finished scan, not inherited: this twin has one job — read all
      // six sides at a glance — and the renderer's defaults are set for a cube you orbit, not one
      // you read. Ghosts are thrown further out than the Cube screen's slider even offers (9, past
      // its 0–8) so the hidden three clear the solid ones; stickers go full-bleed at 1 so a
      // nine-grid stays legible at this size. The camera's distance is the renderer's to fit —
      // it frames whatever this puts in view to whatever slot the twin has (lib/cube-frame.js).
      stateCube.setAttribute('ghost-elevation', '9');
      stateCube.setAttribute('camera-latitude', '35');
      stateCube.setAttribute('camera-longitude', '45');
      stateCube.setAttribute('facelet-scale', '1');

      $('#scanCube', root).appendChild(stateCube);
      const showState = (f) => { stateCube.setAttribute('facelets', f); };
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
          return colors ? colors.map((c) => (isColour(c) ? positionOf(c, tileScheme) : '?')).join('') : '?'.repeat(9);
        }).join('');
      };
      // Which way up each side was held stops mattering the moment the cube reads as solvable: the
      // validated string IS the canonical layout, and the scanner reports each face's rotation.
      // A face captured the wrong way up TURNS to its true orientation — slowly enough to read as
      // "we turned this the right way up for you" — and the repaint lands in the same frame the
      // transform resets, so rotated-shown content and canonical content are pixel-identical at
      // the swap. Timer-driven, not transitionend-driven: the animation is cosmetic and must not
      // be load-bearing in an environment that never fires transition events (tests, reduced CSS).
      let settled = false;
      let turnTimers = [];
      const paintTile = (tile, fl) => {
        const fi = NET_FACES.indexOf(tile.dataset.face);
        const letters = fl.slice(fi * 9, fi * 9 + 9);
        [...tile.querySelectorAll('.cell')].forEach((c, i) => {
          c.style.backgroundColor = pal[letters[i]] ?? 'var(--facelet-off)';
        });
      };
      const clearTurns = () => {
        for (const t of turnTimers) clearTimeout(t);
        turnTimers = [];
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
          turnTimers.push(setTimeout(() => {
            g.style.transition = 'none';
            g.style.transform = '';
            paintTile(tile, fl);
          }, ms + 30));
        }
      };
      const panel = $('ai-scan-panel', root);
      // The largest of the warm windows: a scan is seconds of camera and then a solve, so the
      // tables can be built entirely inside time the user is already spending.
      warmSolver();
      // The aside's words — the scanner's notices and hints, the colour sentence, and every other
      // title and sentence this screen puts in the card — are their own unit
      // (lib/screens/scan/voice.js), and the card is written only through it. `closePops` is
      // declared further down the mount, so the unit is handed a way to reach it.
      const { speak, paintSay, sayScheme, noteScheme } = createScanVoice({
        root, panel, closePops: () => closePops(),
      });
      // "Loading the scanner…" was INITIAL COPY and nothing else: if the bundle never registers —
      // a failed fetch, a parse error, a blocked module — the element stays inert forever and the
      // sentence stays on screen forever, promising a camera that is never opening. A registration
      // that lands replaces it through the panel's own events; one that does not now has an end
      // state and a way out (found by audit, 2026-09-04).
      if (!customElements.get('ai-scan-panel')) {
        const SCANNER_WAIT_MS = 15000;
        let landed = false;
        void customElements.whenDefined('ai-scan-panel').then(() => { landed = true; });
        setTimeout(() => {
          // Guarded on the SCREEN, not only on the flag: this outlives its screen by design.
          if (landed || !root.isConnected) return;
          speak(t('The scanner did not load'), t('The camera part of cubus failed to start, so there is nothing to scan with. Reloading the app usually fixes it. Everything else — the solver, the guide, a smart cube — still works.'), 'err');
        }, SCANNER_WAIT_MS);
      }
      // The two-side reconnect check — confirm mode's opening words, what the camera should see
      // now, and the answer the captured sides give — is its own unit
      // (lib/screens/scan/reconnect-check.js).
      const reconnectCheck = createReconnectCheck({ speak, tileOf, tileSchemeNow: () => tileScheme, go });
      // "Solve this cube" is a promise about THIS screen's scan, so it is only pressable once a
      // scan stands complete — and a correction that re-opens the verdict takes it away again.
      const solveBtn = $('#scanSolveBtn', root);
      /** Did this screen refuse the finished scan? Screen-local, and cleared only by a scan that
       *  is no longer complete — see the scan-progress handler. */
      let refused = false;
      const tiles = [...root.querySelectorAll('.scan-face')];
      const paint = (cells, colors) => cells.forEach((c, i) => { c.style.backgroundColor = classColor(colors[i]); });
      /**
       * Redraw what the TEMPLATE painted from the arrangement — each tile's four edge colours and
       * its centre hint. The template runs once, before any verdict; when a scan proves the other
       * arrangement the two tiles trade places and this is what makes the furniture agree with
       * the cube rather than with what the app assumed a moment ago.
       */
      const repaintTileFurniture = () => {
        for (const tile of tiles) {
          const f = tile.dataset.face;
          tile.querySelector('.tile').style.borderColor = edgeColors(f, tileScheme);
          const centre = tile.querySelectorAll('.cell')[4];
          if (!tile.classList.contains('done')) centre.style.backgroundColor = positionColor(f, tileScheme);
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

      // ---- the board's keyboard path -----------------------------------------------------------
      // 54 stickers are 54 buttons, but ONE tab stop: the board is a composite widget with a
      // roving tabindex. Tab lands on it once; the arrows walk the stickers (Left/Right by one,
      // Up/Down by a row within a side, Home/End to the board's ends); Enter is the click the
      // pointer would have made, heard by the same delegated listener. Every cell is inspectable
      // by arrow — its label carries the side, the position and the reading — and aria-disabled
      // says which ones a press will be refused on, without swallowing the event the way real
      // `disabled` would.
      const cellButtons = tiles.flatMap((tile) => [...tile.querySelectorAll('.cell')]);
      let roveAt = cellButtons.indexOf(tiles.find((tile) => tile.dataset.face === 'F').querySelector('.cell'));
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

      /** Names and actionability for all 54 cells, refreshed on every capture and every paint
       *  toggle: the label is how a screen reader inspects the board the way an eye does, and
       *  aria-disabled marks the cells whose press the handler will refuse (a pending outer
       *  sticker; the centre before its side is read, or while painting). */
      let lastCaptured = [];
      const refreshCellNames = () => {
        for (const tile of tiles) {
          const f = tile.dataset.face;
          const got = lastCaptured.find((c) => c.face === slotFor(f));
          [...tile.querySelectorAll('.cell')].forEach((c, i) => {
            const centre = i === 4;
            const actionable = centre ? Boolean(got) && !painting : Boolean(got) || painting;
            c.setAttribute('aria-disabled', String(!actionable));
            if (centre) {
              c.setAttribute('aria-label', got
                ? `Scan the ${SCAN_FACE_NAME[f]} side again`
                : `${SCAN_FACE_NAME[f]} side centre — it names the side`);
            } else {
              // The COLOUR it was read as. Naming a side here ("read as the Back side's colour")
              // was the Western identity in a sentence: blue is the back of most cubes and the
              // bottom of an older one, and the camera read a colour either way.
              const read = got ? `read as ${COLOUR_NAMES[got.colors[i]] ?? 'an unknown colour'}` : 'not read yet';
              c.setAttribute('aria-label', `${SCAN_FACE_NAME[f]} side, sticker ${i + 1} — ${read}`);
            }
          });
        }
      };
      // First called below, once `painting` exists — this definition precedes that declaration.

      const resetBtn = $('#scanResetBtn', root), paintBtn = $('#scanPaintBtn', root);
      // Painting and the camera are exclusive: one authors the cube, the other reads it.
      let painting = false;
      // The scanner's current misread suspects, kept so the colour picker can ring the suggested
      // colour when it opens on one of them.
      let suspects = [];
      const setPainting = (on) => {
        painting = on;
        camera.showPainting(on);
        // The tiles read this: outer stickers only wear a pointer when a click will be heard —
        // on a read side, or while painting. The class is what lets the stylesheet know.
        root.classList.toggle('painting', on);
        paintBtn.title = on ? 'Stop painting and use the camera' : 'Paint the cube by hand instead of scanning it';
        paintBtn.setAttribute('aria-label', paintBtn.title);
        // Painting changes which cells a press is heard on; their aria-disabled must say so.
        refreshCellNames();
        panel.setPainting?.(on);
      };
      refreshCellNames();
      paintBtn.onclick = () => { closePops(); setPainting(!painting); };
      // The camera menu — the webcam button and its list, the camera the scanner is pinned to, and
      // the row's word for whether one is on — is its own unit (lib/screens/scan/camera-menu.js).
      // `closePops` is declared further down the mount, so the unit is handed a way to reach it.
      const camera = createCameraMenu({
        root, panel, signal, closePops: () => closePops(),
        isPainting: () => painting, stopPainting: () => setPainting(false),
      });
      // Throw the whole scan away — the panel's restart() also turns the camera back on when it
      // is dark, so this one call is the whole contract.
      resetBtn.onclick = () => {
        closePops();
        panel.restart?.();
      };

      // The chip row — its two passes, its generation, its freshness test and its press — is its
      // own unit (lib/screens/scan/stage-chips.js). It asks this screen one thing, at a press:
      // whether the scan under the row was refused.
      const { paintStageChips, dropStageChips } = createStageChips({
        root, signal, state, stageAsk, CHIP_NODE_BUDGET, go, isRefused: () => refused,
      });

      panel.addEventListener('scan-progress', (e) => {
        const p = e.detail;
        // Anything other than a finished scan means the orientation is open again — a correction
        // that breaks validity must not leave canonically-repainted tiles claiming otherwise, nor
        // a half-finished settle turn hanging over tiles about to be repainted as shown.
        if (p.phase !== 'done') { settled = false; clearTurns(); }
        // A scan this screen REFUSED stays refused until there is a new one to judge. The panel
        // reports `complete` on every state change once it has a finished scan — and `complete`
        // deliberately SURVIVES a camera reopen, which is what stops a reopened camera
        // overwriting an accepted scan — so a refusal ("the camera and the cube disagree,
        // nothing was changed") was undone by the very next tick, handing back an enabled Solve
        // button over a cube the screen had just said it did not believe (found by audit,
        // 2026-09-04). The flag is this screen's own, because the panel is right not to carry it:
        // the panel judged the scan legal, and what was refused is what the APP made of it.
        // Cleared by a scan that is no longer complete — a restart, or a capture that reopens the
        // verdict — and by the next accepted scan-complete.
        if (!p.complete) refused = false;
        solveBtn.disabled = !p.complete || refused;
        // A scan that is no longer complete — or one this screen refused — has taken its cube back,
        // and numbers about it stop being about anything. Bumping the generation is what stops a
        // search already in flight painting over the row after it has gone.
        //
        // BOTH CONDITIONS, and the second was missing: a refusal arrives with `complete` still
        // standing from the previous accepted scan, so the card stayed on screen and its chips
        // stayed pressable over a cube the screen had just said it did not believe. That is the
        // same defect the Solve button's `refused` flag exists for, one card along, and an audit
        // reproduced it — Solve disabled, the repair card still offering routes.
        if (!p.complete || refused) dropStageChips();
        // What the scan has ESTABLISHED about the cube's colours. A real scheme moves the tiles
        // and is remembered; `'undetermined'` and null leave the assumption where it was, because
        // neither is evidence (ADR 0001 §8.3). A refusal never reports one at all.
        if (isScheme(p.scheme) && p.scheme !== tileScheme) {
          tileScheme = p.scheme;
          repaintTileFurniture();
        }
        if (isScheme(p.scheme) && adoptScheme(p.scheme)) noteScheme(p.scheme);
        paintSay(p);
        suspects = p.suspects ?? [];
        for (const tile of tiles) {
          const f = tile.dataset.face;
          // The centre carries the rescan affordance, revealed on hover over a captured side.
          const centreCell = tile.querySelectorAll('.cell')[4];
          if (!centreCell.firstChild) centreCell.innerHTML = icon('refresh', 15);
          centreCell.title = `Scan the ${SCAN_FACE_NAME[f]} side again`;
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
          else if (!got) cells.forEach((c, i) => { c.style.backgroundColor = i === 4 ? positionColor(f, tileScheme) : 'var(--facelet-off)'; });
        }
        lastCaptured = p.captured;
        refreshCellNames();
        // The twin follows the scan side by side rather than waiting for all six.
        if (!settled) stateCube.setAttribute('facelets', partialFacelets(p.captured));
        camera.paintCameraRow(p);
        reconnectCheck.answerFromSides(p);
        // Last, so it stands over the generic caption — and it declines to speak over a notice,
        // which is why it is safe to run after everything else has had its say.
        sayScheme(p);
      });
      // A scan the SCANNER refused is a scan this screen must not offer to solve either. It
      // restarts itself and explains why through scan-progress, so there is nothing to say here —
      // but `complete` can still be standing from the previous accepted scan, and an enabled
      // Solve over it would walk that older cube while the screen is telling you this one was not
      // readable. (The panel's own fields for a refusal are deliberately absent, so nothing here
      // reads them.)
      //
      // FIRES MORE THAN ONCE PER REFUSAL, since 2026-09-05, and this line is why that is safe.
      // The misread decode moved to a worker, so a refusal is announced at once with
      // `misreadCount: null` — "checking", not zero and not "nothing can be said" — and announced
      // again with the count when it lands. Setting a flag both times is idempotent; counting the
      // events, or reading `misreadCount` as a number, would not be. What the count is FOR is the
      // panel's pinned notice, which arrives on scan-progress and is rendered above with its
      // params, so the "at least N stickers were misread" wording stays the scanner's to prove.
      panel.addEventListener('scan-invalid', () => {
        refused = true;
        solveBtn.disabled = true;
        // …and no repair over a read the scanner refused (§9a: the feature inherits the scan's
        // refusal rather than forming an opinion of its own).
        dropStageChips();
      }, { signal });
      // Only a validated cube leaves this screen.
      panel.addEventListener('scan-complete', (e) => {
        // The panel is torn down on navigation, but an event already in flight still lands. Without
        // this, a scan finishing just after you left could adopt a cube, derive a correction, and
        // navigate you from a screen that no longer exists.
        if (!root.isConnected) return;
        settled = true;
        // The 'done' progress report normally lands first and enables this; belt-and-braces here
        // so a delivered cube can always be walked, whatever order the two events arrive in.
        // Not over a standing refusal, though: that is the one state where a delivered cube is
        // deliberately not walkable, and this line ran before the refusal below could set it.
        if (!refused) solveBtn.disabled = false;
        const fl = e.detail.facelets;
        // Faces captured the wrong way up turn to their true orientation; the rest repaint in
        // place (their content is already canonical, so nothing visibly changes). The cell
        // names follow: captures were named as SHOWN, and the settle renames every sticker
        // from the validated string.
        settleTiles(fl, e.detail.rotations);
        // Back into capture terms: each position's nine letters become the colours the
        // arrangement paints there, filed under the capture that carries them.
        lastCaptured = NET_FACES.map((f, fi) => ({
          face: slotFor(f),
          colors: [...fl.slice(fi * 9, fi * 9 + 9)].map((ch) => colourOf(ch, tileScheme)),
        }));
        refreshCellNames();
        // The camera SAW the cube in the user's hand; nothing was inferred from anywhere else.
        //
        // Order matters: the repair reads what the cube CLAIMED, so it runs before the scan is
        // adopted as truth. With a connected smart cube this one reading does two jobs — it says
        // where the cube is, and it puts the cube's own tracking back in step for the rest of
        // this connection, with no solving involved. (Not permanently: the correction is
        // discarded on disconnect, because the cube may sleep or be turned while nobody counts.)
        const repaired = repairTracking(fl);
        const adopted = repaired?.ok !== false;
        if (!adopted) {
          // A contradiction is not a reading to adopt: one of the two is wrong and nothing can
          // tell which. Adopting it while saying "nothing was changed" would be untrue — and so
          // would an enabled Solve button over a cube the screen refused to believe.
          markStale('a scan disagreed with what the cube reports, and neither could be confirmed');
          refused = true;
          solveBtn.disabled = true;
          dropStageChips();
        } else {
          refused = false;
          // A completed scan answers the reconnect question outright — six sides ESTABLISH what
          // two sides could only spot-check — so the question closes before the adoption that
          // would otherwise mark a cube trusted with its own question still open.
          state.reconnect = null;
          reconnectCheck.close();
          adoptCube(fl, { physical: true, source: 'camera' });
          // The moment the chain became trusted is a moment worth remembering: truth from the
          // scan, the cube's own raw claim beside it.
          if (state.connected && state.reported) rememberLastSeen('camera', { force: true });
          // …and how far this cube is from each named stage. AFTER the adoption, because the
          // chips are about the cube the app now believes in — and only on a scan it BELIEVED:
          // no repair runs on a read the scanner did not accept (plan §9a), so the feature
          // inherits the scan's refusal rather than forming an opinion of its own.
          void paintStageChips(fl);
        }
        if (repaired) {
          // The session's sentence is an English key, like the scanner's notices; translated here.
          speak(repaired.ok ? t('Tracking repaired') : t('These do not match'), t(repaired.text), repaired.ok ? 'ok' : 'err');
        }
        // Stay put. Jumping to another screen took the six tiles away at the moment they finally
        // mean something, and with them the chance to check the read or fix a sticker. The aside
        // shows the cube that was found, and "Solve this cube" is right beside it. Anyone who
        // wants the jump has the "Auto-solve after scan" setting, which this now actually honours
        // — and honours only for a scan that was BELIEVED: auto-solving a refused reading would
        // walk the previous cube behind a disabled Solve button.
        showState(e.detail.facelets);
        // A scan entered as a reconnect confirmation goes back to the question's screen once the
        // question is answered — "then back here" — exactly as a two-side confirmation does.
        if ((settings.autosolve || reconnectCheck.cameAsConfirmation()) && adopted) go('home');
      });
      // The detector is good, not perfect, so let a person overrule it: on a side the camera has
      // READ, click any sticker and pick the right colour. Delegated rather than 54 listeners. The
      // centre is the one sticker not offered a colour — a centre colour IS the face's identity,
      // so changing it would rename the face rather than correct it; it re-reads the side instead.
      const swatches = document.createElement('div');
      swatches.className = 'swatches';
      swatches.hidden = true;
      // Named like the app's other icon-only controls: a colour alone is not an accessible name,
      // and `title` is the weakest carrier of one.
      swatches.setAttribute('role', 'group');
      swatches.setAttribute('aria-label', 'Pick this sticker’s colour');
      root.appendChild(swatches);
      let editing = null;
      const closeSwatches = () => {
        // Hand focus back to the cell that opened the picker — but only when focus is INSIDE it
        // (the keyboard path); a pointer click elsewhere keeps the focus it just placed.
        const back = editing?.el && swatches.contains(document.activeElement) ? editing.el : null;
        swatches.hidden = true;
        editing = null;
        root.querySelector('.scan-face .cell.editing')?.classList.remove('editing');
        back?.focus();
      };
      const closePops = () => { closeSwatches(); camera.closeMenu(); };
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
          if (editing) panel.setSticker?.(editing.slot, editing.index, colour);
          closeSwatches();
        };
        swatches.appendChild(b);
      }
      $('.scan-faces', root).onclick = (ev) => {
        const cellEl = ev.target.closest('.cell');
        const tile = ev.target.closest('.scan-face');
        if (!tile) return;
        if (!cellEl) return;
        const index = [...cellEl.parentElement.children].indexOf(cellEl);
        // The centre cannot be colour-corrected — it names the face — so it does the other useful
        // thing: throws that side's reading away so the camera reads it again.
        if (index === 4) {
          closePops();
          // Re-reading needs something to read with, so the centre does nothing while painting.
          if (!painting && tile.classList.contains('done')) panel.rescanFace?.(slotFor(tile.dataset.face));
          return;
        }
        // Correcting needs a reading to overrule; painting is where supplying one is the point, so
        // there all 48 outer stickers are open whether the camera has seen that side or not.
        if (!painting && !tile.classList.contains('done')) return;
        closePops();
        editing = { face: tile.dataset.face, slot: slotFor(tile.dataset.face), index, el: cellEl };
        cellEl.classList.add('editing');
        // Mark the colour already there, so the picker shows what it is changing FROM — and, when
        // this sticker is a misread suspect, ring the colour the scanner reckons it should be.
        const current = cellEl.style.backgroundColor;
        const sug = suspects.find((s) => s.face === editing.slot && s.index === index);
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
        swatches.style.left = `${Math.min(Math.max(8, cellRect.left - s.left + cellRect.width / 2 - w / 2), s.width - w - 8)}px`;
        placePopoverV(swatches, tileRect); // below the tile, or above it when that is the room there is
        // The keyboard path continues where the pointer's does: focus lands on the colour the
        // sticker already has (or the first chip), and closeSwatches hands it back to the cell.
        (swatches.querySelector('.now') ?? swatches.firstElementChild)?.focus();
        ev.stopPropagation();
      };
      const onAway = (ev) => {
        if (!swatches.hidden && !swatches.contains(ev.target)) closeSwatches();
        camera.closeMenuUnless(ev.target);
      };
      const onEsc = (ev) => {
        if (ev.key !== 'Escape') return;
        // Escape returns focus to the control the popover came from, rather than dropping it on
        // <body> — closeSwatches already does that for the picker; the menu's owner is the button.
        const hadMenu = camera.menuOpen();
        closePops();
        if (hadMenu) camera.focusButton();
      };
      // `{ signal }` rather than a removal pair in cleanup: the screen's abort is cut on every
      // navigation, so these cannot outlive their screen — the same mechanism the parked
      // <cubus-cube>'s listener relies on. The devicechange listener carries it too.
      document.addEventListener('click', onAway, { signal });
      document.addEventListener('keydown', onEsc, { signal });

      hooks.cleanup = () => {
        clearTurns();
        releaseScanAwake();
        panel.stop?.();
      };
    },
  };
};
