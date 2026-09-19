// Restore — the screen that reads your cube with the camera. Its route id stays `scan`.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { isDesktopHost, noteScanReport } from '../host.js';
import { t } from '../i18n.js';
import { colourOfSlot, isScheme, positionOf, slotAt, slotOf } from '../scheme.js';

import { $, escHtml, icon, state } from '../app-state.js';
import { DEFAULT_PALETTE, SCAN_VIEWS, settings } from '../app-settings.js';
import { hooks } from '../screen-slots.js';
import { CHIP_NODE_BUDGET, stageAsk, warmSolver } from '../solver-service.js';
import { NET_COLORS, NET_FACES, adoptScheme, describeCube, netPalette, newCube } from '../cube-drawing.js';
import { keepAwake } from '../wake-lock.js';
import { adoptCube } from '../cube-connection.js';
import { rememberLastSeen, repairTracking } from '../cube-reports.js';
import { markStale } from '../cube-trust-state.js';
import { conn, turnsReported } from '../live-session.js';
import { SCREENS, go, screenAbort } from '../screen-shell.js';

import { createStageChips } from './scan/stage-chips.js';
import { createScanVoice } from './scan/voice.js';
import { createCameraMenu } from './scan/camera-menu.js';
import { createCaptureRecord } from './scan/capture-record.js';
import { createReconnectCheck } from './scan/reconnect-check.js';
import { createRefusal } from './scan/refusal.js';
import { createScanBoard } from './scan/board.js';
import { createStickerPicker } from './scan/sticker-picker.js';
import { createConfirmHold } from './scan/confirm-hold.js';
import { createScanChime } from './scan/chime.js';
import { createStickerView } from './scan/sticker-view.js';
import { createSpokenScan } from './scan/spoken.js';

// Restore — the screen that reads your cube so it can be solved. Its route id stays `scan`, and
// renaming it is not worth breaking every #/scan link and bookmark already in the wild.
// The camera opens the moment this screen mounts — <ai-scan-panel headless autostart>
// sits in the markup invisibly, owning the camera, the model and the capture state machine, and
// reports every change through `scan-progress`. The whole six-face flow happens right here: no
// modal, and deliberately no camera picture. There is no viewfinder either: the live 3x3 that
// replaced the picture was removed the same day (ae10b42, 2026-08-24), so what reacts to the cube
// is the aside's sentence and a tile filling in once its side is captured. The panel still reports
// `live`; nothing here draws it. Colour class i <-> FACES[i] <-> NET_FACES[i], so a scanned sticker
// is painted in the app's own palette, matching the 3D cube beside it.
const SCAN_FACE_NAME = { U: 'Up', R: 'Right', F: 'Front', D: 'Down', L: 'Left', B: 'Back' };
// Which side neighbours each face, in the canonical URFDLB facelet layout — so a tile can paint
// its four edges in the neighbours' colours and show, without words, which way up to hold that
// side. Not invented here: a copy of the scanner's FACE_NEIGHBOURS
// (packages/cube-scanner/src/facelet-cube.ts, derived there from EDGE_FACELET's twelve facelet
// pairs). apps/web/test/scan-screen.test.mjs imports that export and asserts the tiles are painted
// from THIS table, so the two cannot drift apart.
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
      // The view a scan is read by — kept as one record, because a confirm ask looks at the twin
      // from the front and puts this back when the ask ends (lib/screens/scan/confirm-hold.js).
      const READ_VIEW = { ghosts: 'floating', 'camera-latitude': '35', 'camera-longitude': '45' };
      stateCube.setAttribute('ghosts', READ_VIEW.ghosts);
      // Tuned by eye against a half-finished scan, not inherited: this twin has one job — read all
      // six sides at a glance — and the renderer's defaults are set for a cube you orbit, not one
      // you read. Ghosts are thrown further out than the Cube screen's slider even offers (9, past
      // its 0–8) so the hidden three clear the solid ones; stickers go full-bleed at 1 so a
      // nine-grid stays legible at this size. The camera's distance is the renderer's to fit —
      // it frames whatever this puts in view to whatever slot the twin has (lib/cube-frame.js).
      stateCube.setAttribute('ghost-elevation', '9');
      stateCube.setAttribute('camera-latitude', READ_VIEW['camera-latitude']);
      stateCube.setAttribute('camera-longitude', READ_VIEW['camera-longitude']);
      stateCube.setAttribute('facelet-scale', '1');

      $('#scanCube', root).appendChild(stateCube);
      // The picture and its words, together: the twin kept the words of the cube it was built
      // from while a scan drew a different one into it (found by audit, 2026-09-13). What a scan
      // reads is the cube in the hand.
      const showState = (f) => {
        stateCube.setAttribute('facelets', f);
        describeCube(stateCube, { facelets: f, isPhysical: true, moves: [] });
      };
      // Set by scan-complete and cleared by a report that reopens the scan; the twin reads it.
      let settled = false;
      // A confirm ask, drawn: the twin turns to the hold the scanner asks for
      // (lib/screens/scan/confirm-hold.js).
      const confirmHold = createConfirmHold({ cube: stateCube, tileOf, restView: READ_VIEW });
      const panel = $('ai-scan-panel', root);
      // A chime for each side saved and another when the cube checks out
      // (lib/screens/scan/chime.js); silenced with the screen.
      const chime = createScanChime({ panel, signal });
      // And the few lines said out loud, where the system has a voice (lib/screens/scan/spoken.js).
      const spoken = createSpokenScan({ panel, signal });
      // The scan-guidance study's sticker view (lib/screens/scan/sticker-view.js), in the twin's slot
      // while a scan reads — only where the developer setting turns the arm on.
      const stickerView = createStickerView({
        slot: $('#scanCube', root), classColor,
        enabled: () => settings.devScanView === SCAN_VIEWS.stickers,
      });
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
          speak(t('The scanner did not load'), t('The camera part of cubus failed to start, so there is nothing to scan with. Reload the app to try again. Everything else — the solver, the guide, a smart cube — still works.'), 'err');
        }, SCANNER_WAIT_MS);
      }
      // When each side the scanner holds was read — over which connection, at which of the cube's
      // reports — is its own record (lib/screens/scan/capture-record.js), because a scanner report
      // says what a side shows and never when. Every report is noted in it.
      const captures = createCaptureRecord(() => ({ over: conn, reported: state.reported, turns: turnsReported() }));
      /** A side handed back to the scanner, to be read again. */
      const rescan = (slot) => panel.rescanFace?.(slot);
      // The two-side reconnect check — confirm mode's opening words, what the camera should see
      // now, and the answer the captured sides give — is its own unit
      // (lib/screens/scan/reconnect-check.js).
      const reconnectCheck = createReconnectCheck({
        speak, tileOf, tileSchemeNow: () => tileScheme, go, captures, rescan,
      });
      // "Solve this cube" is a promise about THIS screen's scan, so it is only pressable once a
      // scan stands complete — and a correction that re-opens the verdict takes it away again.
      const solveBtn = $('#scanSolveBtn', root);
      // The six tiles — what each sticker is painted and called, the turn that settles a finished
      // scan, the roving keyboard point and the captures on show — are their own unit
      // (lib/screens/scan/board.js). `painting` is declared further down the mount, so the unit is
      // handed a way to reach it.
      const board = createScanBoard({
        root, SCAN_FACE_NAME, positionColor, classColor, edgeColors, slotFor,
        tileSchemeNow: () => tileScheme, isPainting: () => painting,
      });

      const resetBtn = $('#scanResetBtn', root), paintBtn = $('#scanPaintBtn', root);
      // Painting and the camera are exclusive: one authors the cube, the other reads it.
      let painting = false;
      const setPainting = (on) => {
        painting = on;
        camera.showPainting(on);
        // The tiles read this: outer stickers only wear a pointer when a click will be heard —
        // on a read side, or while painting. The class is what lets the stylesheet know.
        root.classList.toggle('painting', on);
        paintBtn.title = on ? 'Stop painting and use the camera' : 'Paint the cube by hand instead of scanning it';
        paintBtn.setAttribute('aria-label', paintBtn.title);
        // Painting changes which cells a press is heard on; their aria-disabled must say so.
        board.refreshCellNames();
        // Before <ai-scan-panel> upgrades it has no setPainting, and `?.` dropped the mode while
        // this board went on painting, so the scanner, once registered, opened its camera under
        // it. Until then the mode travels as `autostart`, which the element reads as it connects,
        // and is replayed below once the element can take the call.
        if (typeof panel.setPainting === 'function') panel.setPainting(on);
        else panel.toggleAttribute('autostart', !on);
      };
      if (!registered) {
        void customElements.whenDefined('ai-scan-panel').then(() => {
          if (painting && root.isConnected) panel.setPainting(true);
        });
      }
      board.refreshCellNames();
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
      const { paintStageChips, dropStageChips, dropIfStale } = createStageChips({
        root, signal, state, stageAsk, CHIP_NODE_BUDGET, go, isRefused: () => refusal.isRefused(),
      });
      // Whether this screen refused the scan in front of it — the Solve button, the chip row and
      // the words that said why, moved together — is its own unit (lib/screens/scan/refusal.js).
      const refusal = createRefusal({ solveBtn, dropStageChips });
      // The cube under the row can change while the row stands — a smart cube's snapshot replaces
      // the subject — and this screen installed no live-update hook, so it never heard (found by
      // audit, 2026-09-13). renderScreen clears the hook with the screen.
      hooks.liveUpdate = () => dropIfStale();

      panel.addEventListener('scan-progress', (e) => {
        const p = e.detail;
        captures.note(p.captured);
        // Anything other than a finished scan means the orientation is open again — a correction
        // that breaks validity must not leave canonically-repainted tiles claiming otherwise, nor
        // a half-finished settle turn hanging over tiles about to be repainted as shown.
        if (p.phase !== 'done') { settled = false; board.clearTurns(); }
        refusal.fromProgress(p);
        // What the scan has ESTABLISHED about the cube's colours. A real scheme moves the tiles
        // and is remembered; `'undetermined'` and null leave the assumption where it was, because
        // neither is evidence (ADR 0001 §8.3). A refusal never reports one at all.
        if (isScheme(p.scheme) && p.scheme !== tileScheme) {
          tileScheme = p.scheme;
          // The panel lays a painting, and a scan after a restart, out in its `scheme` attribute
          // until a verdict speaks, so the attribute follows the belief the tiles now draw.
          panel.setAttribute('scheme', tileScheme);
          // The twin beside the tiles draws positions too, so it reads them in the same
          // arrangement.
          stateCube.setAttribute('scheme', tileScheme);
          board.repaintTileFurniture();
        }
        if (isScheme(p.scheme) && adoptScheme(p.scheme)) noteScheme(p.scheme);
        paintSay(p);
        // The tiles: which sides are read, the side asked for again, the suspected stickers, and
        // what every sticker is painted and called.
        board.paintProgress(p);
        picker.closeIfStale();
        // The twin follows the scan side by side rather than waiting for all six.
        if (!settled) showState(board.partialFacelets(p.captured));
        confirmHold.show(p.confirm);
        stickerView.show(p);
        // What this build's scanner can actually do, learned from what it just did (lib/host.js): the
        // Settings row that offers the study's view follows the scanner, never the platform string.
        noteScanReport(p);
        camera.paintCameraRow(p);
        reconnectCheck.answerFromSides(p);
        // Last, so it stands over the generic caption — and it declines to speak over a notice,
        // which is why it is safe to run after everything else has had its say. A refusal the app
        // made is said in its place while it stands.
        if (!refusal.sayAgain(p)) sayScheme(p);
        // `{ signal }`, as its siblings have: a report from a panel whose screen had gone adopted a
        // colour arrangement, rebuilt a detached camera menu and answered a reconnect question for
        // nobody (found by audit, 2026-09-13).
      }, { signal });
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
        // Solve goes, and the repair with it: no repair over a read the scanner refused (§9a: the
        // feature inherits the scan's refusal rather than forming an opinion of its own).
        refusal.refuse();
      }, { signal });
      // Only a validated cube leaves this screen.
      panel.addEventListener('scan-complete', (e) => {
        // The panel is torn down on navigation, but an event already in flight still lands. Without
        // this, a scan finishing just after you left could adopt a cube, derive a correction, and
        // navigate you from a screen that no longer exists.
        if (!root.isConnected) return;
        // A scan finished from sides read before the report in force pictures a cube that may no
        // longer be the one in the hand: read before a turn the cube reported, or before a
        // reconnect, after which it may have been turned while nobody counted, or be another cube
        // (a connection starts knowing nothing, lib/cube-reports.js). Taken, it repaired tracking
        // against that picture, answered the question and trusted the cube, with no side read
        // again (found by audit, 2026-09-13; the turn by verification, 2026-09-14). Those sides go
        // back to the camera, and the scan is refused until they are read — refused AFTER they go
        // back, because the scanner reports a side handed back at once, and that report lifts a
        // refusal made before it. Which of the two it was is read first: that report forgets them.
        const readBefore = captures.readBeforeReport();
        if (readBefore.length) {
          const reconnected = captures.readBeforeConnection().length > 0;
          for (const slot of readBefore) rescan(slot);
          refusal.refuse(() => speak(t('Show those sides again'), t(reconnected
            // "Connected", not "reconnected": a cube connecting for the first time part-way
            // through a scan is refused the same way, and was told it had reconnected.
            ? 'A cube connected after some of these sides were read, so the camera needs to read them again before this scan can answer for it.'
            // Not "the cube was turned after", which is one of the two ways a side falls behind
            // and was said of both: a turn is counted at once and the snapshot that shows it
            // follows about a second later, so a side read in between is left behind by the
            // report that catches up, with nothing turned since it was read. What is true of
            // every side in this list is that the cube has spoken since it was read.
            : 'The cube has reported a turn, or where it is, since some of these sides were read, so the camera needs to read them again before this scan can answer for it.')));
          return;
        }
        settled = true;
        const fl = e.detail.facelets;
        // Faces captured the wrong way up turn to their true orientation; the rest repaint in
        // place (their content is already canonical, so nothing visibly changes). The cell
        // names follow: captures were named as SHOWN, and the settle renames every sticker
        // from the validated string.
        board.settle(fl, e.detail.rotations);
        picker.closeIfStale();
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
          // Its words stand while it does: the next report would otherwise say "press Solve this
          // cube" over the button this has just taken away.
          refusal.refuse(() => speak(t('These do not match'), t(repaired.text), 'err'));
        } else {
          refusal.accept();
          // The scan is ACCEPTED here, not when the scanner said complete — a finished scan can still
          // be refused just above — so here is where the child hears it (the chime's second sound and
          // "All done!", lib/screens/scan/chime.js and spoken.js).
          chime.accepted();
          spoken.accepted();
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
        // The session's sentence is an English key, like the scanner's notices; translated here. A
        // refusal has said its own already.
        if (repaired?.ok) speak(t('Tracking repaired'), t(repaired.text), 'ok');
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
      // The picker itself — its six colours, the sticker it is open over, and when that sticker
      // stops showing what it opened on — is its own unit (lib/screens/scan/sticker-picker.js).
      // A colour chosen there is painted through the capture record, so the side it corrects keeps
      // the moment it was read.
      const picker = createStickerPicker({
        root, classColor, slotFor, board,
        paint: (slot, index, colour) => captures.paint(slot, index, colour, () => panel.setSticker?.(slot, index, colour)),
      });
      const closePops = () => { picker.close(); camera.closeMenu(); };
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
        // A turning tile's cells are still in the order they were shown, and the panel stores the
        // side settled: index i here is another sticker there until the turn lands.
        if (board.isTurning(tile)) return;
        closePops();
        picker.openAt(tile, cellEl, index);
        ev.stopPropagation();
      };
      const onAway = (ev) => {
        picker.closeUnless(ev.target);
        camera.closeMenuUnless(ev.target);
      };
      const onEsc = (ev) => {
        if (ev.key !== 'Escape') return;
        // Escape returns focus to the control the popover came from, rather than dropping it on
        // <body> — the picker's close already does that for it; the menu's owner is the button.
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
        board.clearTurns();
        releaseScanAwake();
        panel.stop?.();
      };
    },
  };
};
