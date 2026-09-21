// The Settings screen's smart-cube card: what it draws, and what its controls do — pairing and
// letting go, the remembered cubes, the compatibility report, and the anchor.
//
// Lifted out of lib/screens/settings.js on 2026-09-14: one mount held every card's controls and
// every operation they leave in flight (found by audit, 2026-09-13). The card owns its own now, as
// module state, because a repaint hands back fresh buttons while one of them is still awaiting.

import { cubeLabel, listCubes, MAX_LABEL, NAME_PREFIX, normaliseMac } from '../../cube-registry.js';
import { forgetLibraryMac } from '../../ble-bridge.js';
import { locale, t } from '../../i18n.js';

import { $, SOLVED, escHtml, icon, state } from '../../app-state.js';
import { applyNetColors, buildNet } from '../../cube-drawing.js';
import { isTauri } from '../../window-chrome.js';
import {
  bleReach, bleReachNote, canPair, doConnect, letGo, refreshBattery,
} from '../../cube-connection.js';
import { onDisconnect } from '../../cube-reports.js';
import { conn, cubeRefused } from '../../live-session.js';
import { wireReconnectAnswers } from '../../reconnect-answer.js';
import {
  clearOffset, flushSettingsRepaint, markStale, markTrusted, repaintIndicator,
} from '../../cube-trust-state.js';
import {
  cubes, forgetKnownCube, idWords, liveCubeLabel, registryWriteBad, renameKnownCube, whenWords,
} from '../../cube-memory.js';
import { go, renderScreen } from '../../screen-shell.js';

/** An anchor in flight. Module-level on purpose: dropping trust re-renders Settings, so a flag
 *  declared inside the mount would be reset by the very repaint the guard exists to survive. */
let anchoring = false;
/** The session a Disconnect press is letting go, or null. Module-level for the reason
 *  `anchoring` is: a repaint while the radio lets go hands back a fresh, enabled button. */
let releasing = null;
/** The session the address warning was said for, or null. Bound to the SESSION, not the button: a
 *  press on one cube that landed after another replaced it armed the new cube's button, and that
 *  cube's first press saved its address unwarned (found on re-audit, 2026-09-14). */
let reportWarnedFor = null;
/** Said when a cube the self-check has refused is asked to anchor — before the anchor, and after it
 *  when the verdict turned while it was in flight. */
const REFUSED_ANCHOR = 'This cube’s reports do not add up, so anchoring it would not make them true. Disconnect and pair again — the camera reads the cube either way.';

// The FULL address in labels, not a tail: neither two octets nor nicknames are unique —
// nothing stops a user calling two cubes "green".
//
// A cube with no address is keyed on its NAME (`name:<label>`), and that key is a storage
// detail, not something to print: "green at name:green" reads as a bug, and it is the one
// string here a user might try to type into the address field. Such a row says plainly
// that there is no address instead — the fact, which is also why the row exists.
const rowName = (c) => `${c.nickname || c.name || 'cube'} ${idWords(c.mac)}`;

/** What the card says while the last registry write failed, and nothing once one landed. One
 *  template for the card and for a rename, which changes the health while its field is typed in. */
const registryWarning = () => (registryWriteBad ? `<div id="registryWriteWarn" style="display:flex;gap:8px;padding:0 0 12px;color:var(--err-ink);font-size:var(--fs-body-s)">
    <span>This browser is refusing to store what cubus learns about this cube — its memory of it will not survive a reload, so the next reconnect will greet it as a stranger.</span>
  </div>` : '');

/** The card, drawn from the connection, the registry and trust as they are now. */
export const smartCubeCard = () => {
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
        ${rc.raw && rc.candidate ? '<button class="btn sm primary" id="settingsReconnectYes" data-reconnect="yes">Yes, that’s it</button>' : ''}
        <button class="btn sm outline" id="settingsReconnectScan" data-reconnect="scan">Check with the camera</button>
      </div>
    </div>`;
  };
  const knownCubesRows = () => {
    if (!known.length) return '';
    // What a row offers follows what this host can reach, not whether it is a Tauri build: "Use"
    // hands an address to a browser's Bluetooth and the note promises a native scan, and a browser
    // with no radio was offered the one while a phone the bridge refuses was promised the other
    // (found by audit, 2026-09-13).
    return `<div style="padding:4px 0 0;border-top:1px solid var(--line-faint)">
      <div class="eyebrow" style="padding-top:12px">${known.length === 1 ? 'YOUR CUBE' : 'YOUR CUBES'}</div>
      ${known.map((c) => {
        const live = on && state.cubeMac === c.mac;
        // Aligned to the INPUT's row, not the column's centre: the name field is the
        // element the eye reads the row by, and the mac line hanging under it pushed a
        // centre-aligned button visibly off that line.
        // Ids on the row's controls, because a repaint of Settings puts focus — and a draft, with
        // its caret — back by id (lib/screen-shell.js). Made from the cube's key, encoded: a name
        // may hold a space, and an id may not.
        return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--line-faint)">
          <span class="ico" style="color:${live ? 'var(--ok)' : 'var(--ink-5)'};flex:none;margin-top:9px">${icon('bluetooth', 16)}</span>
          <div style="flex:1;min-width:0">
            <input class="field" id="cubeName-${escHtml(encodeURIComponent(c.mac))}" data-rename-cube="${escHtml(c.mac)}" value="${escHtml(c.nickname)}"
              placeholder="${escHtml(c.name || 'Give it a name')}" maxlength="${MAX_LABEL}"
              aria-label="Name for the cube ${escHtml(idWords(c.mac))}"
              style="width:100%;font-weight:600" title="A name of your own. Only a label — nothing depends on it.">
            <div class="sub num" style="color:var(--ink-5);font-size:var(--fs-meta);margin-top:3px">${escHtml(c.mac.startsWith(NAME_PREFIX) ? t('no address — remembered by name') : c.mac)} · ${escHtml(live ? t('connected now') : seenAgo(c.lastSeen))}</div>
          </div>
          ${!on && bleReach() === 'browser' && normaliseMac(c.mac) ? `<button class="btn sm outline" id="useCube-${escHtml(encodeURIComponent(c.mac))}" data-use-cube="${escHtml(c.mac)}" aria-label="Connect to ${escHtml(rowName(c))}" style="flex:none;margin-top:1px">Use</button>` : ''}
          <button class="btn sm" id="forgetCube-${escHtml(encodeURIComponent(c.mac))}" data-forget-cube="${escHtml(c.mac)}" aria-label="Forget ${escHtml(rowName(c))}" style="flex:none;margin-top:1px;border:1px solid var(--line);color:var(--ink-4)">Forget</button>
        </div>`;
      }).join('')}
      ${bleReach() === 'native' ? `<div class="sub" style="color:var(--ink-5);padding:8px 0 0">cubus finds whichever cube is awake nearby, so this list is a history rather than a chooser.</div>` : ''}
    </div>`;
  };

  // An id and a tabindex: a press that takes its own control away (a Yes, a Forget) leaves focus
  // on the card it was in, which the shell finds by them (lib/screen-shell.js).
  return `<div class="card" id="smartCubeCard" tabindex="-1"><div class="eyebrow">SMART CUBE</div>
  <div style="display:flex;align-items:center;gap:12px;padding:12px 0">
    <span class="ico" style="color:${on ? 'var(--ok)' : 'var(--ink-5)'}">${icon('bluetooth', 18)}</span>
    <div style="flex:1">
      <div style="font-weight:600" id="cubeHeading">${on ? escHtml(liveCubeLabel()) + ' · live' : 'No cube paired'}</div>
      <div class="sub" id="btNote" style="color:var(--ink-4)">${on ? 'Every turn streams into cubus.' : 'Optional — cubus solves from the camera alone. A cube adds move-by-move following.'}</div>
      ${on ? '' : `<div class="sub" id="btReach" style="color:var(--ink-5);margin-top:4px">${escHtml(t(bleReachNote()))}</div>`}
    </div>
    ${on ? battery() : ''}
  </div>
  ${on && Number.isFinite(state.battery) && state.battery <= 20 ? `<div style="display:flex;gap:8px;padding:0 0 12px;color:var(--err-ink);font-size:var(--fs-body-s)">
    <span>Battery low. A cube that dies mid-solve stops counting turns, and what it reports afterwards will not match the cube in your hand until you read it again.</span>
  </div>` : ''}
  <div id="registryHealth">${registryWarning()}</div>
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
    <button class="btn sm outline" id="cubeReportBtn" style="flex:none">${conn && reportWarnedFor === conn ? escHtml(t('Save it anyway')) : 'Save report'}</button>
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
</div>`;
};

/** What the card's controls do. `root` is the screen the card was drawn into. */
export function mountSmartCube(root) {
  // ---- smart cube (recovered from v0) --------------------------------------------------
  // Resolved against the document, not the captured root: anything that re-renders Settings
  // between an action starting and finishing would otherwise leave the result written into a
  // detached node — visible to no one, indistinguishable from the action doing nothing.
  const say = (text, colour) => { const m = $('#pairMsg'); if (m) { m.style.color = colour; m.textContent = text; } };
  const pairBtn = $('#pairBtn', root);

  // A repaint deferred because a nickname or address was mid-typing flushes when the typing
  // stops — deferred is not dropped. The timeout lets focus land on its next element first,
  // so tabbing between the two inputs does not flush (and discard) between them. The flush
  // itself knows whether the deferral is still about the Settings on stage (2026-09-21).
  root.addEventListener('focusout', () => {
    setTimeout(flushSettingsRepaint, 0);
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
        // About the disconnected card that asked. Landing after a cube paired, it disabled that
        // cube's Disconnect and wrote over its connected note (found by audit, 2026-09-13).
        if (ok !== false || state.connected) return;
        // Into the card that asked, never whichever card is drawn now: every card drawn since asks
        // for itself, and an old "no" resolved against the document overruled a fresher "yes" and
        // disabled Pair (found on re-audit, 2026-09-14).
        if (btNote) btNote.textContent = t('No Bluetooth radio available on this machine — turn it on, then reload.');
        pairBtn.disabled = true;
      }).catch(() => {}); // an engine without getAvailability tells us nothing
    }
  }

  if (pairBtn) pairBtn.onclick = async () => {
    if (state.connected) {
      const asked = conn;
      // One goodbye at a time: the button stays pressable while the radio lets go, and a second
      // press asked the cube again (found by audit, 2026-09-13).
      if (asked && releasing === asked) { say(t('already disconnecting…'), 'var(--ink-4)'); return; }
      releasing = asked;
      let failed = null;
      try { failed = asked ? await letGo(asked) : null; } finally { if (releasing === asked) releasing = null; }
      // Scoped to the session pressed on: a cube that replaced it while the radio let go is not
      // this press's to tear down, and it was (found by audit, 2026-09-13).
      if (conn !== asked) return;
      // Called explicitly rather than waited for: a deliberate disconnect tears the session
      // down locally, so no DISCONNECT event arrives to do it for us — and without this the
      // cube stayed marked trusted with its correction applied to nothing.
      onDisconnect();
      // The session ANSWERS a release that did not complete, and the answer was dropped. The
      // local teardown happens either way; what the radio did not do is then said.
      if (failed) say(t('Disconnected here, but the cube was not released cleanly: %1', String(failed.message || failed).split('\n')[0]), 'var(--warn-ink)');
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

  // Everything that names a cube, renamed where it stands: the card's heading, the title-bar
  // indicator and the row's own buttons kept the old name until something else repainted them
  // (found by audit, 2026-09-13). In place rather than a repaint, so the field keeps its caret.
  const renamedInPlace = (mac) => {
    if (state.connected && state.cubeMac === mac) {
      const heading = $('#cubeHeading');
      if (heading) heading.textContent = `${liveCubeLabel()} · live`;
      repaintIndicator();
    }
    const c = listCubes(cubes).find((x) => x.mac === mac);
    if (!c) return;
    for (const b of document.querySelectorAll('[data-use-cube]')) {
      if (b.dataset.useCube === mac) b.setAttribute('aria-label', `Connect to ${rowName(c)}`);
    }
    for (const b of document.querySelectorAll('[data-forget-cube]')) {
      if (b.dataset.forgetCube === mac && b.dataset.armed !== 'yes') b.setAttribute('aria-label', `Forget ${rowName(c)}`);
    }
  };

  // A nickname is the user's word for a cube: stored because it is useful, never branched on,
  // which is what makes accepting an unverifiable label honest.
  for (const el of root.querySelectorAll('[data-rename-cube]')) {
    el.onchange = () => {
      const { saved, flipped, record: rec } = renameKnownCube(el.dataset.renameCube, el.value);
      const named = cubeLabel({ ...rec, mac: el.dataset.renameCube });
      renamedInPlace(el.dataset.renameCube);
      // The registry's health, said where it stands: a rename that lands carries every change a
      // refused write dropped, and one storage refuses leaves storage behind — and the warning as
      // it was drawn said the opposite of both (found on re-audit, 2026-09-14).
      if (flipped) {
        const health = $('#registryHealth');
        if (health) health.innerHTML = registryWarning();
      }
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
    // Read AT THE PRESS, before the import yields: two presses queued behind it each read the
    // flag afterwards, and the second saved the address-carrying file before the warning had
    // been seen (found by audit, 2026-09-13).
    const told = reportWarnedFor === asked;
    try {
      const { describeReport, saveReport } = await import('../../cube-report.js');
      // A press answers for the cube it was made on, and one replaced while the module loaded is
      // no longer on the card.
      if (conn !== asked) return;
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
      if (about.containsMac && !told) {
        reportWarnedFor = asked;
        const btn = $('#cubeReportBtn');
        if (btn) btn.textContent = t('Save it anyway');
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
      say(REFUSED_ANCHOR, 'var(--err-ink)');
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
      // Asked again: the self-check can refuse the cube while the anchor awaits, and
      // markTrusted then grants nothing — under a success message and an anchored flag
      // (found by audit, 2026-09-13).
      if (cubeRefused()) { say(REFUSED_ANCHOR, 'var(--err-ink)'); return; }
      state.anchored = true;
      markTrusted('cube'); // the cube and reality were just made to agree — and this repaints
      say('Anchored — the cube agrees it is solved.', 'var(--ok-ink)');
    } catch (e) {
      if (conn !== asked) return;
      state.anchored = false;
      const msg = String(e.message || e).split('\n')[0];
      // "Does not report itself solved", not "refusing to anchor": that matched a cube that
      // said nothing at all too, and told it that it reports unsolved (found by audit,
      // 2026-09-13).
      if (!force && /does not report itself solved/i.test(msg)) {
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
}
