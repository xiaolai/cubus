// The Settings screen.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { TIERS } from '../solve-target.js';
import { capability as optimalCapability } from '../optimal.js';
import { isDesktopHost } from '../host.js';
import { cubeLabel, listCubes, MAX_LABEL, NAME_PREFIX, normaliseMac } from '../cube-registry.js';
import { forgetLibraryMac } from '../ble-bridge.js';
import { locale, t } from '../i18n.js';
import { VERSION } from '../version.js';

import { $, SOLVED, escHtml, icon, state } from '../app-state.js';
import { HIDEABLE, PALETTES, THEMES, navHidden, save, settings } from '../app-settings.js';
import { applyNetColors, applyTheme, buildNet, netPalette } from '../cube-drawing.js';
import { isTauri } from '../window-chrome.js';
import {
  bleReach, bleReachNote, canPair, conn, cubeRefused, doConnect, markTrusted, onDisconnect,
  refreshBattery, wireReconnectAnswers,
} from '../cube-connection.js';
import {
  clearOffset, markStale, repaintSettings, settingsRepaintPending,
} from '../cube-trust-state.js';
import {
  cubes, forgetKnownCube, idWords, liveCubeLabel, registryWriteBad, renameKnownCube, whenWords,
} from '../cube-memory.js';
import { PROVE_COPY } from '../prove-affordance.js';
import {
  appUpdater, hideUpdateProgress, privacySentence, reportUpdateOutcome, showUpdateProgress,
} from '../update-ui.js';
import { SCREENS, advancedChordWords, advancedOpen, go, renderNav, renderScreen } from '../screen-shell.js';

const TIER_LABEL = { twenty: '≤ 20', nineteen: '≤ 19', eighteen: '≤ 18', shortest: 'shortest' };
const TIER_BLURB = {
  twenty: 'Twenty moves or fewer — always possible, and quick. An easy cube still gets its short answer',
  nineteen: 'Nineteen or fewer — a moment longer, and it almost always gets there',
  eighteen: 'Eighteen when it can be found; often it cannot, and it says so rather than pretend',
  shortest: 'Keeps looking for a shorter one until you move on',
};

/** An anchor in flight. Module-level on purpose: dropping trust re-renders Settings, so a flag
 *  declared inside the mount would be reset by the very repaint the guard exists to survive. */
let anchoring = false;

SCREENS.settings = () => {
  // The list is PALETTES — the validated one — not a second copy of it beside it.
  const pals = PALETTES;
  // No WCA-inspection toggle: it flipped a label and nothing else — the timer never implemented
  // the 15s countdown it named. A setting that claims behaviour it does not have is exactly the
  // invented data this app refuses elsewhere; it returns when the Timer actually earns it.
  const toggles = [['autosolve', 'Auto-solve after scan', 'Jump straight to the guide']];
  // The window's orientation is the desktop's to choose (dev-docs/stage-contract.md, decision
  // 4): a fixed window that can be either shape. The row exists only where there is a window to
  // shape — the Tauri API on a desktop platform. A phone or tablet rotates in the hand, and the
  // browser harness has no window. The Rust side (set_orientation) re-sizes, re-centres and
  // remembers; this is the third capability seam AGENTS.md lists.
  const desktopWindow = isTauri && isDesktopHost();
  // `flow`: a list screen — in portrait the box scrolls as one (index.html, .cols.flow).
  return { html: `<div class="cols flow">
    <div class="col">
      <div class="card"><div class="eyebrow">APPEARANCE</div>
        <div class="wrap-row" style="justify-content:space-between;padding:12px 0"><div><div style="font-weight:600">Theme</div><div class="sub" style="color:var(--ink-4)">White, cream or night — auto follows the system</div></div>
          <div class="wrap-row" style="gap:6px">${THEMES.map((name) => `<button class="pill ${settings.theme === name ? 'on' : ''}" data-set-theme="${name}" aria-pressed="${settings.theme === name}">${escHtml(t(name))}</button>`).join('')}</div></div>
        <div style="display:flex;align-items:center;gap:16px;padding:13px 0 0;border-top:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">Rotate the cube by dragging</div><div class="sub" style="color:var(--ink-4)">Off, the 3D cube keeps the angle its ghost faces are set up for</div></div>
          <button class="toggle ${settings.dragRotate ? 'on' : ''}" data-toggle="dragRotate" role="switch" aria-checked="${Boolean(settings.dragRotate)}" aria-label="Rotate the cube by dragging"><i></i></button></div>
        <div class="wrap-row" style="justify-content:space-between;padding:13px 0 0;border-top:1px solid var(--line-faint)"><div><div style="font-weight:600">How short a solution</div><div class="sub" style="color:var(--ink-4)">${TIER_BLURB[settings.solveTier] ?? TIER_BLURB.twenty}</div></div>
          <div class="wrap-row" style="gap:6px">${TIERS.map((tier) => `<button class="pill ${settings.solveTier === tier.name ? 'on' : ''}" data-set-tier="${tier.name}" aria-pressed="${settings.solveTier === tier.name}">${escHtml(TIER_LABEL[tier.name])}</button>`).join('')}</div></div>
        ${optimalCapability() ? `<div style="display:flex;align-items:center;gap:16px;padding:13px 0 0;border-top:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">${PROVE_COPY.settingLabel}</div><div class="sub" style="color:var(--ink-4)">${PROVE_COPY.settingBlurb}</div></div>
          <button class="toggle ${settings.proveMinimum ? 'on' : ''}" data-toggle="proveMinimum" role="switch" aria-checked="${Boolean(settings.proveMinimum)}" aria-label="${PROVE_COPY.settingLabel}"><i></i></button></div>` : ''}
        ${desktopWindow ? `<div class="wrap-row" style="justify-content:space-between;padding:12px 0"><div><div style="font-weight:600">Window</div><div class="sub" style="color:var(--ink-4)">Landscape or portrait — the window takes the shape and keeps it</div></div>
          <div class="wrap-row" style="gap:6px" id="orientationPills">${['landscape', 'portrait'].map((o) => `<button class="pill" data-set-orientation="${o}" aria-pressed="false">${escHtml(t(o))}</button>`).join('')}</div></div>` : ''}</div>
      ${(() => {
        // ---- smart cube (recovered from v0) --------------------------------------------------
        const on = state.connected;
        // The open reconnect question. While it stands, the card is a STATUS ROW — the net of
        // the remembered arrangement (the same buildNet component Home paints, so the two
        // screens cannot disagree), the reading's words, the trust badge, and the same two
        // actions Home offers. The three-step checklist folds into it: "Is it solved right now?"
        // is this question in the case where the candidate is solved.
        const rc = on ? state.reconnect : null;
        // The cube answers its battery on request, so an unknown level is a real state, not a
        // zero. Drawn rather than written as a bare percentage because the number that matters is
        // "is this about to die mid-solve" — a dying cube is what desyncs tracking from reality.
        const battery = () => {
          const lv = state.battery;
          if (!Number.isFinite(lv)) {
            return `<button class="btn sm outline" id="battRefresh" title="Ask the cube again">battery ?</button>`;
          }
          const low = lv <= 20;
          const tone = low ? 'var(--err)' : lv <= 40 ? 'var(--warn)' : 'var(--ok)';
          return `<div id="battMeter" title="${lv}% battery" style="display:flex;align-items:center;gap:8px;flex:none">
            <div style="position:relative;width:34px;height:16px;border:1.5px solid var(--ink-5);border-radius:3px">
              <i style="position:absolute;inset:2px;width:calc(${lv}% - 4px);min-width:1px;background:${tone};border-radius:1px"></i>
            </div>
            <span style="width:8px;height:7px;margin-left:-6px;background:var(--ink-5);border-radius:0 2px 2px 0"></span>
            <span class="num" style="font-size:var(--fs-body-s);color:${low ? 'var(--err-ink)' : 'var(--ink-3)'};font-weight:${low ? 700 : 400}">${lv}%</span>
          </div>`;
        };
        // Step 3 is not decoration: anchorSolved() is what tells the cube which position counts
        // as solved, so the button lives IN its own step.
        // Step 3 asks the one question only the person holding the cube can answer. "It's solved"
        // anchors; "Not solved" hands the cube to the camera, which reads it exactly as it is —
        // nobody should have to solve a cube to start using the app.
        const steps = [
          ['Turn the cube', 'Any quarter turn wakes its radio'],
          ['Pair it', 'Moves and state then stream in live'],
          ['Is it solved right now?', 'Solved: mark it, and the cube learns its reference. Not solved: the camera reads it as it is'],
        ];
        // Step 3 is not done just because the anchor button was once pressed: a cube that has
        // since disconnected, missed a turn or had its correction reset is not "set up and
        // tracking", and a green tick over one is the most misleading thing this card could say.
        // Step 3 is "does cubus know where this cube is", and there are TWO ways to answer it:
        // anchoring (the cube's own reference is moved to solved) and a camera scan (the cube is
        // read exactly as it is). The card offers both — "Not solved" sends you to the camera —
        // and then required the anchor anyway, so a cube set up entirely through the camera sat
        // on an unfinished checklist for the whole session with nothing left to press (found by
        // audit, 2026-09-04). The condition is the fact the step is about: trusted, and by a
        // means that says something about THIS cube.
        const done = (i) => on && (i < 2 || (state.cube.trusted && (state.anchored || state.cube.source === 'camera')));
        const known = listCubes(cubes);
        // Both through Intl, in the app's locale, for the reason whenWords is: a 24-hour pad and
        // an English "2d ago" are the app writing in one language while claiming to be in another.
        const hhmm = (ts) => {
          if (!ts) return '';
          try { return new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit' }).format(new Date(ts)); }
          catch { return ''; }
        };
        const seenAgo = (ts) => {
          if (!ts) return t('not used yet');
          const ago = Date.now() - ts;
          if (ago < 60000) return t('just now');
          try {
            const rel = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
            for (const [ms, unit] of [[86400000, 'day'], [3600000, 'hour'], [60000, 'minute']]) {
              if (ago >= ms) return rel.format(-Math.floor(ago / ms), unit);
            }
          } catch { /* an engine without RelativeTimeFormat falls through to the plain form */ }
          return t('a while ago');
        };
        // The FULL address in labels, not a tail: neither two octets nor nicknames are unique —
        // nothing stops a user calling two cubes "green".
        //
        // A cube with no address is keyed on its NAME (`name:<label>`), and that key is a storage
        // detail, not something to print: "green at name:green" reads as a bug, and it is the one
        // string here a user might try to type into the address field. Such a row says plainly
        // that there is no address instead — the fact, which is also why the row exists.
        const rowName = (c) => `${c.nickname || c.name || 'cube'} ${idWords(c.mac)}`;
        // The reading's words, compact: what is remembered, and what the evidence says about it.
        // Words and a picture only — no reading grants trust; the buttons below are how the user
        // does, and the answer is about the STATE, never the identity (design §0).
        const reconnectRow = () => {
          if (!rc) return '';
          const when = whenWords(rc.seenAt);
          const seen = when.full ? `last seen ${when.full} · ` : '';
          const words = rc.reading === 'no-report' ? `${seen}hasn’t said where it is`
            : rc.reading === 'turned' ? `${seen}turned since, or lost count`
            : `${seen}no turns recorded since`;
          const ask = rc.reading === 'no-report' ? 'Your cube hasn’t said where it is.'
            : rc.candidate === SOLVED ? 'Is it solved right now?' : 'Is this your cube right now?';
          return `<div style="padding:10px 0 4px;border-top:1px solid var(--line-faint)">
            <div class="eyebrow">AS WE REMEMBER IT</div>
            ${rc.candidate ? `<div class="net" id="settingsNet" style="max-width:240px;margin:12px auto"></div>` : ''}
            <div class="sub" style="color:var(--ink-4)">${escHtml(words)}</div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap">
              <span class="pill" id="reconnectBadge" style="color:var(--warn-ink);border-color:var(--warn-ink)">position unverified</span>
              <b style="flex:1;font-size:var(--fs-body-s)">${escHtml(ask)}</b>
            </div>
            <div style="display:flex;gap:8px;margin-top:10px">
              ${rc.raw && rc.candidate ? '<button class="btn sm primary" data-reconnect="yes">Yes, that’s it</button>' : ''}
              <button class="btn sm outline" data-reconnect="scan">Check with the camera</button>
            </div>
          </div>`;
        };
        const knownCubesRows = () => {
          if (!known.length) return '';
          return `<div style="padding:4px 0 0;border-top:1px solid var(--line-faint)">
            <div class="eyebrow" style="padding-top:12px">${known.length === 1 ? 'YOUR CUBE' : 'YOUR CUBES'}</div>
            ${known.map((c) => {
              const live = on && state.cubeMac === c.mac;
              // Aligned to the INPUT's row, not the column's centre: the name field is the
              // element the eye reads the row by, and the mac line hanging under it pushed a
              // centre-aligned button visibly off that line.
              return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--line-faint)">
                <span class="ico" style="color:${live ? 'var(--ok)' : 'var(--ink-5)'};flex:none;margin-top:9px">${icon('bluetooth', 16)}</span>
                <div style="flex:1;min-width:0">
                  <input class="field" data-rename-cube="${escHtml(c.mac)}" value="${escHtml(c.nickname)}"
                    placeholder="${escHtml(c.name || 'Give it a name')}" maxlength="${MAX_LABEL}"
                    aria-label="Name for the cube ${escHtml(idWords(c.mac))}"
                    style="width:100%;font-weight:600" title="A name of your own. Only a label — nothing depends on it.">
                  <div class="sub num" style="color:var(--ink-5);font-size:var(--fs-meta);margin-top:3px">${escHtml(c.mac.startsWith(NAME_PREFIX) ? t('no address — remembered by name') : c.mac)} · ${escHtml(live ? t('connected now') : seenAgo(c.lastSeen))}</div>
                </div>
                ${!on && !isTauri && normaliseMac(c.mac) ? `<button class="btn sm outline" data-use-cube="${escHtml(c.mac)}" aria-label="Connect to ${escHtml(rowName(c))}" style="flex:none;margin-top:1px">Use</button>` : ''}
                <button class="btn sm" data-forget-cube="${escHtml(c.mac)}" aria-label="Forget ${escHtml(rowName(c))}" style="flex:none;margin-top:1px;border:1px solid var(--line);color:var(--ink-4)">Forget</button>
              </div>`;
            }).join('')}
            ${isTauri ? `<div class="sub" style="color:var(--ink-5);padding:8px 0 0">cubus finds whichever cube is awake nearby, so this list is a history rather than a chooser.</div>` : ''}
          </div>`;
        };

        return `<div class="card"><div class="eyebrow">SMART CUBE</div>
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0">
          <span class="ico" style="color:${on ? 'var(--ok)' : 'var(--ink-5)'}">${icon('bluetooth', 18)}</span>
          <div style="flex:1">
            <div style="font-weight:600">${on ? escHtml(liveCubeLabel()) + ' · live' : 'No cube paired'}</div>
            <div class="sub" id="btNote" style="color:var(--ink-4)">${on ? 'Every turn streams into cubus.' : 'Optional — cubus solves from the camera alone. A cube adds move-by-move following.'}</div>
            ${on ? '' : `<div class="sub" id="btReach" style="color:var(--ink-5);margin-top:4px">${escHtml(t(bleReachNote()))}</div>`}
          </div>
          ${on ? battery() : ''}
        </div>
        ${on && Number.isFinite(state.battery) && state.battery <= 20 ? `<div style="display:flex;gap:8px;padding:0 0 12px;color:var(--err-ink);font-size:var(--fs-body-s)">
          <span>Battery low. A cube that dies mid-solve stops counting turns, and what it reports afterwards will not match the cube in your hand until you read it again.</span>
        </div>` : ''}
        ${registryWriteBad ? `<div id="registryWriteWarn" style="display:flex;gap:8px;padding:0 0 12px;color:var(--err-ink);font-size:var(--fs-body-s)">
          <span>This browser is refusing to store what cubus learns about this cube — its memory of it will not survive a reload, so the next reconnect will greet it as a stranger.</span>
        </div>` : ''}
        ${on ? `<div style="display:flex;align-items:center;gap:10px;padding:12px 0;border-top:1px solid var(--line-faint)">
          <span class="ico" style="flex:none;color:${conn?.verdict === 'refused' ? 'var(--err)' : 'var(--ink-4)'}">${icon(conn?.verdict === 'refused' ? 'x' : 'check', 16)}</span>
          <div style="flex:1">
            <div style="font-weight:600">${conn?.verdict === 'refused'
              ? 'This cube did not check out'
              : 'Send us a report about this cube'}</div>
            <div class="sub" style="color:var(--ink-4)">${conn?.verdict === 'refused'
              ? 'What it reported did not add up, so cubus is not trusting it. That is worth telling us about — the file below is a recording of the conversation, and it is the only thing that can show why.'
              : 'Only if you feel like it. Most cube types have never been tried on this app, and a recording of one that works is what makes the next person\u2019s cube work too.'}</div>
          </div>
          <button class="btn sm outline" id="cubeReportBtn" style="flex:none">Save report</button>
        </div>` : ''}
        ${on && state.cube.offset ? `<div style="display:flex;align-items:center;gap:10px;padding:12px 0;border-top:1px solid var(--line-faint)">
          <span class="ico" style="color:var(--ok);flex:none">${icon('check', 16)}</span>
          <div style="flex:1">
            <div style="font-weight:600">Tracking corrected</div>
            <div class="sub" style="color:var(--ink-4)">${state.cube.offsetFrom === 'confirmed'
              ? `You confirmed this cube's arrangement at ${escHtml(hhmm(state.cube.offsetAt))}, and every reading since is corrected by that answer. If the picture you confirmed was wrong, so is everything built on it.`
              : `A camera scan at ${escHtml(hhmm(state.cube.offsetAt))} put this cube back in step after it lost count, and every reading since is corrected by it. If that scan was wrong, so is everything built on it.`}</div>
          </div>
          <button class="btn sm outline" id="offsetReset" aria-label="Discard the tracking correction — your cube will need reading again" style="flex:none">Reset</button>
        </div>` : ''}
        ${knownCubesRows()}
        ${on || !canPair() ? '' : `<div id="macRow" hidden style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">${known.length ? 'Add another cube' : 'Cube Bluetooth address'}</div>
            <div class="sub" style="color:var(--ink-4)">Only needed if your cube does not broadcast its own address. Most do, and most cubes never ask you for this. If yours does, its own app lists it under the cube's details.</div></div>
          <input class="field" id="macIn" placeholder="AB:CD:EF:12:34:56" style="width:180px;flex:none">
        </div>`}
        <div style="display:flex;gap:10px;align-items:center;padding:12px 0">
          ${on || canPair() ? `<button class="btn ${on ? 'outline' : 'primary'} sm" id="pairBtn">${escHtml(t(on ? 'Disconnect' : 'Pair a cube'))}</button>` : ''}
          <span class="sub" id="pairMsg" style="flex:1" role="status" aria-live="polite"></span>
        </div>
        ${rc ? reconnectRow() : steps.every((_, i) => done(i)) ? '' : steps.map(([st, sub], i) => `<div style="display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line-faint)">
          <div class="num" style="width:22px;height:22px;flex:none;border-radius:50%;border:1.5px solid ${done(i) ? 'var(--ok)' : 'var(--line)'};display:grid;place-items:center;font-size:var(--fs-meta);color:${done(i) ? 'var(--ok-ink)' : 'var(--ink-5)'}">${done(i) ? '✓' : i + 1}</div>
          <div style="flex:1"><div style="font-weight:600">${st}</div><div class="sub" style="color:var(--ink-4)">${sub}</div></div>
          ${i === 2 && on ? `<button class="btn sm outline" id="anchorNoBtn" style="flex:none" title="The camera reads it exactly as it is — no need to solve it first">Not solved</button>
          <button class="btn sm primary" id="anchorBtn" style="flex:none">${state.anchored ? 'Re-mark solved' : "It's solved"}</button>
          <button class="btn sm" id="anchorForceBtn" hidden style="flex:none;border:1px solid var(--warn-ink);color:var(--warn-ink)">It is solved — anchor anyway</button>` : ''}
        </div>`).join('')}
        ${on && !rc && steps.every((_, i) => done(i)) ? `<div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-top:1px solid var(--line-faint);color:var(--ok-ink);font-size:var(--fs-body-s)">
          ${icon('check', 15)}<span style="flex:1">Set up and tracking.</span>
          <button class="btn sm outline" id="anchorBtn" aria-label="Re-mark this cube as solved">Re-mark solved</button>
        </div>` : ''}
      </div>`; })()}
      <div class="card"><div class="eyebrow">CAMERA</div>
        ${toggles.map(([k, lbl, sub]) => `<div style="display:flex;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">${t(lbl)}</div><div class="sub" style="color:var(--ink-4)">${t(sub)}</div></div>
          <button class="toggle ${settings[k] ? 'on' : ''}" data-toggle="${k}" role="switch" aria-checked="${Boolean(settings[k])}" aria-label="${t(lbl)}"><i></i></button></div>`).join('')}</div>
    </div>
    <div class="aside">
      <div class="card"><div class="eyebrow">CUBE COLOURS</div>
        <div style="display:flex;gap:6px;margin-top:12px" id="palSwatch"></div>
        <div style="display:flex;gap:6px;margin-top:12px">${pals.map((p) => `<button class="pill ${settings.palette === p ? 'on' : ''}" data-pal="${p}" aria-pressed="${settings.palette === p}" style="flex:1;justify-content:center">${escHtml(t(p))}</button>`).join('')}</div>
        <div style="display:flex;align-items:center;gap:16px;padding:13px 0 0;margin-top:8px;border-top:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">${escHtml(t('Japanese colours'))}</div><div class="sub" style="color:var(--ink-4)">${escHtml(t('Blue under white instead of yellow — the arrangement on many older cubes. Scanning your cube sets this on its own.'))}</div></div>
          <button class="toggle ${settings.scheme === 'japanese' ? 'on' : ''}" data-scheme role="switch" aria-checked="${settings.scheme === 'japanese'}" aria-label="${escHtml(t('Japanese colours'))}"><i></i></button></div></div>
      ${advancedOpen ? `<div class="card"><div class="eyebrow">ADVANCED</div>
        <div class="sub" style="color:var(--ink-4);margin-top:6px;line-height:1.5">Toolbar tabs. Hiding one only takes it out of the row — its address still works.</div>
        ${HIDEABLE.map(([id, lbl]) => `<div style="display:flex;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">${lbl}</div><div class="sub" style="color:var(--ink-4)">${navHidden(id) ? 'Hidden from the toolbar' : 'Shown in the toolbar'}</div></div>
          <button class="toggle ${navHidden(id) ? '' : 'on'}" data-nav-toggle="${id}" role="switch" aria-checked="${!navHidden(id)}" aria-label="Show ${lbl} in the toolbar"><i></i></button></div>`).join('')}
        <div style="display:flex;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">Random-cube die</div><div class="sub" style="color:var(--ink-4)">Shows the die on the solve screen that loads a random scrambled cube — a developer shortcut, since that cube is not the one in anyone's hand. Scramble keeps its own die regardless.</div></div>
          <button class="toggle ${settings.devRandCube ? 'on' : ''}" data-toggle="devRandCube" role="switch" aria-checked="${Boolean(settings.devRandCube)}" aria-label="Random-cube die"><i></i></button></div>
        <div class="sub" style="color:var(--ink-5);margin-top:12px">${escHtml(t('%1 hides this section again.', advancedChordWords()))}</div></div>` : ''}
      <div class="card"><div class="eyebrow">ABOUT</div>
        <div class="about-brand"><img src="./icons/icon.svg" alt="" width="22" height="22" /><b>Cubus</b></div>
        <div class="about-row">${icon('tag', 15)}<span class="k">${t('Version')}</span><span class="num">${VERSION}</span></div>
        ${appUpdater() ? `<div class="about-row">${icon('refresh', 15)}<span class="k">${t('Updates')}</span><button class="pill" id="checkUpdate">${t('Check now')}</button></div>` : ''}
        <div class="about-row">${icon('globe', 15)}<span class="k">${t('Website')}</span><a class="link" href="https://cubus.im" target="_blank" rel="noopener">cubus.im</a></div>
        <div class="about-row">${icon('user', 15)}<span class="k">${t('Author')}</span><a class="link" href="https://lixiaolai.com" target="_blank" rel="noopener">@xiaolai</a></div>
        <div class="about-row">${icon('book', 15)}<span class="k">${t('Credits')}</span><a class="link" href="./THIRD_PARTY_NOTICES.md" rel="noopener">${t('Third-party notices')}</a></div>
        <div class="sub" style="color:var(--ink-3);margin-top:10px;line-height:1.55">${t(privacySentence())}</div></div>
    </div></div>`,
    mount(root) {
      const swatch = () => { const p = netPalette(); $('#palSwatch', root).innerHTML = ['U', 'D', 'R', 'L', 'F', 'B'].map((k) => `<div style="flex:1;height:34px;border-radius:var(--r-2);background:${p[k]}"></div>`).join(''); };
      swatch();
      // Drawn only where `updater` exists, which is the desktop gate — so this never looks for a
      // button the browser build does not have. The press ALWAYS checks (it ignores the daily
      // throttle) and always answers, because somebody is waiting for one; the launch check is the
      // quiet half. Disabled while in flight, since `check` joins one flight and a button that
      // keeps accepting presses while nothing visibly happens reads as broken.
      const checkBtn = $('#checkUpdate', root);
      const upd = appUpdater();
      if (checkBtn && upd) {
        checkBtn.onclick = async () => {
          const was = checkBtn.textContent;
          checkBtn.disabled = true;
          checkBtn.textContent = t('Checking…');
          try {
            await reportUpdateOutcome(await upd.checkNow({
              onProgress: (p) => {
                // The press has become a download: the button says so, and the status chip
                // carries the numbers wherever the user looks next.
                if (checkBtn.isConnected) checkBtn.textContent = t('Updating…');
                showUpdateProgress(p);
              },
            }));
          } catch (err) {
            // A press that throws used to leave the button spinning back to normal with nothing
            // said — the check simply appeared not to happen.
            console.error('app-update: the check failed', err);
            await reportUpdateOutcome({ status: 'error' });
          } finally {
            hideUpdateProgress();
            // The button may have gone with a re-render, and an installed update never comes back
            // here at all — the app relaunches out from under it.
            if (checkBtn.isConnected) { checkBtn.disabled = false; checkBtn.textContent = was; }
          }
        };
      }
      for (const b of root.querySelectorAll('[data-set-theme]')) b.onclick = () => { settings.theme = b.dataset.setTheme; save('cubusSettings', settings); applyTheme(); renderScreen(); };
      // Changing the target does not re-solve anything now — the next solve uses it. Clearing
      // the cached solution is what makes that true; without it the old answer would stand.
      for (const b of root.querySelectorAll('[data-set-tier]')) b.onclick = () => { settings.solveTier = b.dataset.setTier; save('cubusSettings', settings); state.cube.solution = ''; state.cube.solveResult = null; renderScreen(); };
      // The window's orientation lives on the Rust side (a file the window is built from before
      // this webview exists), so the pills ask it which is current, and tell it which to become.
      // A failure surfaces on the pills themselves rather than in a console nobody reads.
      const orientationPills = $('#orientationPills', root);
      if (orientationPills) {
        const invoke = window.__TAURI__?.core?.invoke;
        const mark = (current) => {
          for (const b of orientationPills.querySelectorAll('[data-set-orientation]')) {
            const on = b.dataset.setOrientation === current;
            b.classList.toggle('on', on);
            b.setAttribute('aria-pressed', String(on)); // the class is the look; this is the fact
          }
        };
        const fail = (e) => { orientationPills.title = String(e); orientationPills.style.color = 'var(--err-ink)'; console.error('window orientation', e); };
        if (typeof invoke !== 'function') fail('the Tauri API is not exposed');
        else {
          invoke('get_orientation').then(mark, fail);
          for (const b of orientationPills.querySelectorAll('[data-set-orientation]')) {
            b.onclick = () => invoke('set_orientation', { orientation: b.dataset.setOrientation }).then(mark, fail);
          }
        }
      }
      for (const b of root.querySelectorAll('[data-pal]')) b.onclick = () => { settings.palette = b.dataset.pal; save('cubusSettings', settings); applyNetColors(); renderScreen(); };
      // Setting it by hand is EVIDENCE, and is recorded as such: a scan may still correct it —
      // the cube in the hand outranks a setting about the cube in the hand — but until one does,
      // this is what the app draws, and it is no longer the default nobody chose (ADR 0001 §8.3).
      const schemeToggle = $('[data-scheme]', root);
      if (schemeToggle) schemeToggle.onclick = () => {
        settings.scheme = settings.scheme === 'japanese' ? 'western' : 'japanese';
        settings.schemeSource = 'user';
        save('cubusSettings', settings);
        applyNetColors();
        renderScreen();
      };
      for (const b of root.querySelectorAll('[data-toggle]')) b.onclick = () => { const k = b.dataset.toggle; settings[k] = !settings[k]; save('cubusSettings', settings); b.classList.toggle('on', settings[k]); b.setAttribute('aria-checked', String(Boolean(settings[k]))); };

      // ---- smart cube (recovered from v0) --------------------------------------------------
      // Resolved against the document, not the captured root: anything that re-renders Settings
      // between an action starting and finishing would otherwise leave the result written into a
      // detached node — visible to no one, indistinguishable from the action doing nothing.
      const say = (text, colour) => { const m = $('#pairMsg'); if (m) { m.style.color = colour; m.textContent = text; } };
      const pairBtn = $('#pairBtn', root);

      // A repaint deferred because a nickname or address was mid-typing flushes when the typing
      // stops — deferred is not dropped. The timeout lets focus land on its next element first,
      // so tabbing between the two inputs does not flush (and discard) between them.
      root.addEventListener('focusout', () => {
        setTimeout(() => { if (settingsRepaintPending) repaintSettings(); }, 0);
      });

      // ONE connect flow for the Pair button and every remembered-cube Use button: same pending
      // message idiom, same error surfacing. Two copies of it had already started to drift.
      const connectFromSettings = async (mac, pending) => {
        say(pending, 'var(--ink-4)');
        try { await doConnect(mac); } catch (e) { say(String(e.message || e), 'var(--err-ink)'); }
      };

      // What CAN be detected, and what cannot. A browser has no scan-without-permission by
      // design, so there is no honest "1 cube found" line to draw; getAvailability() does say
      // whether pressing Pair can work at all, which beats a button that fails unexplained. The
      // address field appears ONLY where it is genuinely needed: the native build learns the
      // address from its own scan, a browser must be handed it.
      //
      // WHICH HOSTS GET THE BUTTON AT ALL is decided in the template, by canPair(), and not here:
      // this used to promise "Native Bluetooth — cubus finds the cube itself" under any Tauri
      // build, including the Android one whose native BLE the bridge refuses outright — so the
      // affordance was offered, pressed, and answered with a message written for a browser
      // ("smart cubes need Chrome, Edge, or the desktop app") on a phone where none of those
      // three is the answer (found by audit, 2026-09-04). bleReachNote() states the platform's
      // real position before anything is pressed.
      const btNote = $('#btNote', root), macRow = $('#macRow', root);
      if (pairBtn && !state.connected) {
        if (bleReach() === 'native') {
          if (btNote) btNote.textContent = t('Native Bluetooth — cubus finds the cube itself.');
        } else {
          if (macRow) macRow.hidden = false;
          void navigator.bluetooth.getAvailability?.().then((ok) => {
            if (ok !== false) return;
            // Resolved now, not captured at mount: a trust change repaints this card, and nodes
            // taken beforehand are detached by the time this promise settles.
            const note = $('#btNote'), pair = $('#pairBtn');
            if (note) note.textContent = t('No Bluetooth radio available on this machine — turn it on, then reload.');
            if (pair) pair.disabled = true;
          }).catch(() => {}); // an engine without getAvailability tells us nothing
        }
      }

      if (pairBtn) pairBtn.onclick = async () => {
        if (state.connected) {
          // Called explicitly rather than waited for: a deliberate disconnect tears the session
          // down locally, so no DISCONNECT event arrives to do it for us — and without this the
          // cube stayed marked trusted with its correction applied to nothing.
          try { await conn?.disconnect(); } catch {}
          onDisconnect();
          return;
        }
        await connectFromSettings($('#macIn', root)?.value, isTauri ? 'scanning…' : 'pick your cube in the browser prompt');
      };

      // Resetting the correction does NOT restore trust — it removes the only thing that was
      // making the cube's readings true, and says so.
      $('#offsetReset', root)?.addEventListener('click', () => {
        clearOffset();
        markStale('its correction was reset, so its position is unverified again');
        renderScreen();
      });

      // The remembered arrangement's net — the SAME buildNet component Home's twin is, painted
      // from the same candidate, so the two screens cannot disagree about what is remembered.
      const settingsNet = $('#settingsNet', root);
      if (settingsNet && state.reconnect?.candidate) {
        applyNetColors();
        buildNet(settingsNet)(state.reconnect.candidate);
      }
      // The same two actions Home's question offers; the answer is one answer wherever given.
      wireReconnectAnswers(root);

      // A nickname is the user's word for a cube: stored because it is useful, never branched on,
      // which is what makes accepting an unverifiable label honest.
      for (const el of root.querySelectorAll('[data-rename-cube]')) {
        el.onchange = () => {
          const { saved, record: rec } = renameKnownCube(el.dataset.renameCube, el.value);
          const named = cubeLabel({ ...rec, mac: el.dataset.renameCube });
          if (saved) say(`Saved — this cube is "${named}".`, 'var(--ok-ink)');
          else say('Could not save that name — this browser is refusing to store anything.', 'var(--err-ink)');
        };
      }
      for (const el of root.querySelectorAll('[data-use-cube]')) {
        el.onclick = () => connectFromSettings(el.dataset.useCube, 'connecting…');
      }
      // Two-step, because a browser on macOS cannot read the address back off the cube:
      // forgetting is the one action here that destroys something the app cannot re-derive.
      for (const el of root.querySelectorAll('[data-forget-cube]')) {
        el.onclick = () => {
          if (el.dataset.armed !== 'yes') {
            el.dataset.armed = 'yes';
            el.textContent = 'Really forget?';
            el.setAttribute('aria-label', `Confirm forgetting ${el.dataset.forgetCube}`);
            el.style.color = 'var(--err)';
            el.style.borderColor = 'var(--err)';
            return;
          }
          const id = el.dataset.forgetCube;
          const stored = forgetKnownCube(id);
          // The app's own registry is not the only place this cube's address is written down. The
          // protocol layer caches a resolved address under `smartcube-ble-mac:<device id>`, and on
          // Windows, Linux and Android the device id IS that address — so a "forgotten" cube kept
          // its MAC on disk and the next connect resolved a key from it without asking anything.
          // A forget that leaves the identifying value in storage is not a forget.
          //
          // Best effort by construction, and honest about it: on macOS the id is a per-host UUID
          // the app never sees, so there is nothing here to remove and this removes nothing. The
          // live session's id is tried too, for the case where the row being forgotten is the
          // cube currently connected.
          const purged = forgetLibraryMac(normaliseMac(id))
            + (state.cubeMac === id ? forgetLibraryMac(normaliseMac(conn?.mac ?? '')) : 0);
          if (purged) console.info(`forget: also removed ${purged} cached address entr${purged === 1 ? 'y' : 'ies'}`);
          renderScreen();
          if (!stored) say('Forgotten for now, but this browser will not store the change.', 'var(--err-ink)');
        };
      }
      $('#battRefresh', root)?.addEventListener('click', () => void refreshBattery());

      // The compatibility report (dev-docs/universal-cube-driver.md §7). One affordance, not a
      // screen: the moment worth offering it is when the self-check has refused a cube, because a
      // refusal that reaches nobody is a quiet failure one level above the one it guards against.
      $('#cubeReportBtn', root)?.addEventListener('click', async () => {
        const asked = conn;
        if (!asked) { say('not connected', 'var(--err-ink)'); return; }
        try {
          const { describeReport, saveReport } = await import('../cube-report.js');
          const fixture = asked.report({ scenario: 'saved from Settings' });
          // Said BEFORE the file exists, not after — and said at all, which it was not: a GAN or
          // MoYu capture carries the cube's BLE address, because key derivation needs it, and the
          // app was writing that into a file it invited people to attach to a public issue
          // without once mentioning it (`describeReport` existed and had no caller — found by
          // audit, 2026-09-04). It is a toy's identifier that the toy broadcasts in the clear,
          // not a phone or a person; the point is that the choice is the user's to make knowing.
          //
          // Two-step, the same idiom the Forget button uses, and for a reason of the same weight:
          // this is the one action here that puts an identifier somewhere the app cannot take it
          // back from. No modal is invented for it — this design system has none, and the button
          // itself can carry the question.
          const about = describeReport(fixture);
          const btn = $('#cubeReportBtn');
          if (about.containsMac && btn?.dataset.told !== 'yes') {
            if (btn) { btn.dataset.told = 'yes'; btn.textContent = t('Save it anyway'); }
            say(t('This recording includes your cube’s Bluetooth address — cubus needs it to decode the cube, and the cube broadcasts it in the clear, but it will be in the file you attach. Nothing about you or your computer is. Press again to save.'), 'var(--warn-ink)');
            return;
          }
          const r = await saveReport(fixture, { isWebview: isTauri });
          if (conn !== asked) return;
          const kb = Math.max(1, Math.round(r.bytes / 1024));
          // Says which thing happened, never a generic "done": a download and a clipboard copy
          // need different next steps from the person holding it.
          say(r.how === 'downloaded'
            ? `Saved ${r.name} (${kb} KB) — attach it to an issue at github.com/xiaolai/cubus`
            : `Copied ${kb} KB to your clipboard — paste it into an issue at github.com/xiaolai/cubus`,
            'var(--ok-ink)');
        } catch (e) {
          if (conn !== asked) return;
          say(String(e.message || e).split('\n')[0], 'var(--err-ink)');
        }
      });

      // anchorSolved() sends REQUEST_RESET only if the cube already reports solved — it throws
      // otherwise, and the refusal is what teaches the step. But the precondition can dead-end an
      // honest user: a cube whose internal solved-reference has drifted reports unsolved WHILE
      // SITTING SOLVED on the desk, and REQUEST_RESET is the only repair. Nothing here can tell
      // that from a genuinely scrambled cube; the person holding it can — so the override is
      // offered, never taken automatically, and it says what it will do.
      const anchorBtn = $('#anchorBtn', root), forceBtn = $('#anchorForceBtn', root);
      const liveAnchorBtn = () => $('#anchorBtn');
      const liveForceBtn = () => $('#anchorForceBtn');
      const anchor = async (force) => {
        if (!conn) { say('not connected', 'var(--err-ink)'); return; }
        // Anchoring moves the cube's own solved reference. It cannot answer a refusal, which is
        // about the two channels disagreeing with each other rather than with reality — and
        // markTrusted would refuse the 'cube' source afterwards anyway, leaving a success message
        // over a cube that had not become trusted.
        if (cubeRefused()) {
          say('This cube’s reports do not add up, so anchoring it would not make them true. Disconnect and pair again — the camera reads the cube either way.', 'var(--err-ink)');
          return;
        }
        // Single-flight: dropping trust re-renders this card, which hands back a fresh enabled
        // button while the first call is still awaiting — two concurrent REQUEST_RESETs.
        if (anchoring) { say('already anchoring…', 'var(--ink-4)'); return; }
        anchoring = true;
        const disable = (on) => {
          const a = liveAnchorBtn(); if (a) a.disabled = on;
          const f = liveForceBtn(); if (f) f.disabled = on;
        };
        disable(true);
        say(force ? 'anchoring anyway…' : 'anchoring…', 'var(--ink-4)');
        const asked = conn;
        try {
          // Trust goes first, and the correction with it: anchorSolved() moves the cube's own
          // solved reference, so the old correction describes a relationship that no longer
          // exists. If the anchor then fails, the cube is left honestly untrusted rather than
          // confidently wrong.
          clearOffset();
          markStale('its reference is being reset');
          await conn.anchorSolved(force ? { force: true } : {});
          // Scoped to the connection that asked: a slow anchor completing after a disconnect must
          // not mark a cube that is no longer there as set up and trusted.
          if (conn !== asked) return;
          state.anchored = true;
          markTrusted('cube'); // the cube and reality were just made to agree — and this repaints
          say('Anchored — the cube agrees it is solved.', 'var(--ok-ink)');
        } catch (e) {
          if (conn !== asked) return;
          state.anchored = false;
          const msg = String(e.message || e).split('\n')[0];
          if (!force && /refusing to anchor/i.test(msg)) {
            say('The cube reports it is not solved. If it IS solved in front of you, its own reference has drifted — anchoring will reset it to this position.', 'var(--warn-ink)');
            const f = liveForceBtn();
            if (f) f.hidden = false;
          } else {
            say(msg, 'var(--err-ink)');
          }
        } finally { anchoring = false; disable(false); }
      };
      if (anchorBtn) anchorBtn.onclick = () => { const f = liveForceBtn(); if (f) f.hidden = true; void anchor(false); };
      if (forceBtn) forceBtn.onclick = () => { void anchor(true); };
      // "Not solved" is a real answer, not a dead end: Restore reads the cube exactly as it is.
      $('#anchorNoBtn', root)?.addEventListener('click', () => go('scan'));

      for (const b of root.querySelectorAll('[data-nav-toggle]')) b.onclick = () => {
        const id = b.dataset.navToggle;
        settings.navHidden = navHidden(id) ? settings.navHidden.filter((x) => x !== id) : [...settings.navHidden, id];
        save('cubusSettings', settings);
        renderNav();
        // Hiding the screen you are standing on would leave the toolbar with nothing marked
        // active. You are on Settings when you press this, so that only bites via a deep link.
        if (navHidden(state.screen)) { go('home'); return; }
        renderScreen(); // repaints this card's own labels, so it cannot describe the old state
      };
    },
  };
};
