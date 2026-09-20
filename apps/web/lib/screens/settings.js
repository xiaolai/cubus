// The Settings screen.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { TIERS } from '../solve-target.js';
import { capability as optimalCapability } from '../optimal.js';
import { isDesktopHost, scannerPlacesStickers } from '../host.js';
import { t } from '../i18n.js';
import { VERSION } from '../version.js';

import { $, escHtml, icon, state } from '../app-state.js';
import { HIDEABLE, PALETTES, SCAN_VIEWS, SOUND_MODES, THEMES, navHidden, settings } from '../app-settings.js';
import { applyNetColors, applyTheme, netPalette } from '../cube-drawing.js';
import { isTauri } from '../window-chrome.js';
import { PROVE_COPY } from '../prove-affordance.js';
import {
  appUpdater, privacySentence, runUpdatePress,
} from '../update-ui.js';
import { SCREENS, advancedChordWords, advancedOpen, go, renderNav, renderScreen } from '../screen-shell.js';
import { mountSmartCube, smartCubeCard } from './settings/smart-cube.js';
import { wireOrientation } from './settings/window-orientation.js';
import { bindChoice, bindSwitch, commitPref, switchRow, unsavedNote } from './settings/preferences.js';
import { mountSpokenLines, spokenLinesCard } from './settings/spoken-lines.js';
import { hush } from '../speech.js';
import { stopAll } from '../sound.js';

// How the four rungs read on the Settings screen. A rung with no label here would render as
// "undefined", so solve-tier-wiring.test.mjs checks every TIERS entry has one.
const TIER_LABEL = { twenty: '≤ 20', nineteen: '≤ 19', eighteen: '≤ 18', shortest: 'shortest' };
const TIER_BLURB = {
  twenty: 'Twenty moves or fewer — always possible, and quick. An easy cube still gets its short answer',
  nineteen: 'Nineteen or fewer — a moment longer, and it almost always gets there',
  eighteen: 'Eighteen when it can be found; often it cannot, and it says so rather than pretend',
  shortest: 'Keeps looking for a shorter one until you move on',
};

// The three sound modes, as they read on the Settings screen. `voice` is the chime AND the words:
// the chime lands at once and the line follows, so a scan never loses the immediate tick that says a
// side went in. A mode with no label here would render as "undefined", the TIER_LABEL precedent.
const SOUND_LABEL = { voice: 'Voice', chime: 'Bell', off: 'Off' };
const SOUND_BLURB = {
  voice: 'A bell when a side is saved, and a spoken line with it where this device has a voice',
  chime: 'A bell when a side is saved, and when the cube checks out — no spoken lines',
  off: 'Silent. The tiles and the small cube still show what the scan needs',
};

SCREENS.settings = () => {
  // The list is PALETTES — the validated one — not a second copy of it beside it.
  const pals = PALETTES;
  // No WCA-inspection toggle: it flipped a label and nothing else — the timer never implemented
  // the 15s countdown it named. A setting that claims behaviour it does not have is exactly the
  // invented data this app refuses elsewhere; it returns when the Timer actually earns it.
  const toggles = [
    ['autosolve', 'Auto-solve after scan', 'Jump straight to the guide'],
  ];
  // The window's orientation is the desktop's to choose (dev-docs/stage-contract.md, decision
  // 4): a fixed window that can be either shape. The row exists only where there is a window to
  // shape — the Tauri API on a desktop platform. A phone or tablet rotates in the hand, and the
  // browser harness has no window. The Rust side (set_orientation) re-sizes, re-centres and
  // remembers; this is the third capability seam AGENTS.md lists.
  const desktopWindow = isTauri && isDesktopHost();
  // `flow`: a list screen — in portrait the box scrolls as one (index.html, .cols.flow).
  // Every control here carries an id: Settings repaints under whoever is on it (a battery
  // reply, a trust change, a toggle), and the shell puts focus back by id. A control with none
  // dropped focus to <body> (verification, 2026-09-14).
  return { html: `<div class="cols flow">
    <div class="col">
      <div class="card"><div class="eyebrow">APPEARANCE</div>
        <div class="wrap-row" style="justify-content:space-between;padding:12px 0"><div><div style="font-weight:600">Theme</div><div class="sub" style="color:var(--ink-4)">White, cream or night — auto follows the system</div></div>
          <div class="wrap-row" style="gap:6px">${THEMES.map((name) => `<button class="pill ${settings.theme === name ? 'on' : ''}" id="setTheme-${name}" data-set-theme="${name}" aria-pressed="${settings.theme === name}">${escHtml(t(name))}</button>`).join('')}</div></div>
        ${switchRow({
          style: 'padding:13px 0 0;border-top:1px solid var(--line-faint)',
          title: 'Rotate the cube by dragging',
          blurb: 'Off, the 3D cube keeps the angle its ghost faces are set up for',
          id: 'setToggle-dragRotate', on: Boolean(settings.dragRotate), attrs: 'data-toggle="dragRotate"', label: 'Rotate the cube by dragging',
        })}
        <div class="wrap-row" style="justify-content:space-between;padding:13px 0 0;border-top:1px solid var(--line-faint)"><div><div style="font-weight:600">How short a solution</div><div class="sub" style="color:var(--ink-4)">${TIER_BLURB[settings.solveTier] ?? TIER_BLURB.twenty}</div></div>
          <div class="wrap-row" style="gap:6px">${TIERS.map((tier) => `<button class="pill ${settings.solveTier === tier.name ? 'on' : ''}" id="setTier-${tier.name}" data-set-tier="${tier.name}" aria-pressed="${settings.solveTier === tier.name}">${escHtml(TIER_LABEL[tier.name])}</button>`).join('')}</div></div>
        ${optimalCapability() ? switchRow({
          style: 'padding:13px 0 0;border-top:1px solid var(--line-faint)',
          title: PROVE_COPY.settingLabel, blurb: PROVE_COPY.settingBlurb,
          id: 'setToggle-proveMinimum', on: Boolean(settings.proveMinimum), attrs: 'data-toggle="proveMinimum"', label: PROVE_COPY.settingLabel,
        }) : ''}
        ${desktopWindow ? `<div class="wrap-row" style="justify-content:space-between;padding:12px 0"><div><div style="font-weight:600">Window</div><div class="sub" style="color:var(--ink-4)">Landscape or portrait — the window takes the shape and keeps it</div></div>
          <div class="wrap-row" style="gap:6px" id="orientationPills">${['landscape', 'portrait'].map((o) => `<button class="pill" id="setOrientation-${o}" data-set-orientation="${o}" aria-pressed="false">${escHtml(t(o))}</button>`).join('')}</div></div>` : ''}
        ${unsavedNote('appearance')}</div>
      ${smartCubeCard()}
      <div class="card"><div class="eyebrow">CAMERA</div>
        ${toggles.map(([k, lbl, sub]) => switchRow({
          style: 'padding:13px 0;border-bottom:1px solid var(--line-faint)',
          id: `setToggle-${k}`, title: t(lbl), blurb: t(sub), on: Boolean(settings[k]), attrs: `data-toggle="${k}"`, label: t(lbl),
        })).join('')}
        <div class="wrap-row" style="justify-content:space-between;padding:13px 0 0"><div><div style="font-weight:600">${escHtml(t('Sounds'))}</div><div class="sub" style="color:var(--ink-4)">${escHtml(t(SOUND_BLURB[settings.soundMode] ?? SOUND_BLURB.voice))}</div></div>
          <div class="wrap-row" style="gap:6px">${Object.values(SOUND_MODES).map((m) => `<button class="pill ${settings.soundMode === m ? 'on' : ''}" id="setSound-${m}" data-set-sound="${m}" aria-pressed="${settings.soundMode === m}">${escHtml(t(SOUND_LABEL[m]))}</button>`).join('')}</div></div>
        ${unsavedNote('camera')}</div>
    </div>
    <div class="aside">
      <div class="card"><div class="eyebrow">CUBE COLOURS</div>
        <div style="display:flex;gap:6px;margin-top:12px" id="palSwatch"></div>
        <div style="display:flex;gap:6px;margin-top:12px">${pals.map((p) => `<button class="pill ${settings.palette === p ? 'on' : ''}" id="pal-${p}" data-pal="${p}" aria-pressed="${settings.palette === p}" style="flex:1;justify-content:center">${escHtml(t(p))}</button>`).join('')}</div>
        ${switchRow({
          style: 'padding:13px 0 0;margin-top:8px;border-top:1px solid var(--line-faint)',
          title: escHtml(t('Japanese colours')),
          blurb: escHtml(t('Blue under white instead of yellow — the arrangement on many older cubes. Scanning your cube sets this on its own.')),
          id: 'setScheme', on: settings.scheme === 'japanese', attrs: 'data-scheme', label: escHtml(t('Japanese colours')),
        })}
        ${unsavedNote('colours')}</div>
      ${advancedOpen ? `<div class="card"><div class="eyebrow">ADVANCED</div>
        <div class="sub" style="color:var(--ink-4);margin-top:6px;line-height:1.5">Toolbar tabs. Hiding one only takes it out of the row — its address still works.</div>
        ${HIDEABLE.map(([id, lbl]) => switchRow({
          style: 'padding:13px 0;border-bottom:1px solid var(--line-faint)',
          title: lbl, blurb: navHidden(id) ? 'Hidden from the toolbar' : 'Shown in the toolbar',
          id: `navToggle-${id}`, on: !navHidden(id), attrs: `data-nav-toggle="${id}"`, label: `Show ${lbl} in the toolbar`,
        })).join('')}
        ${switchRow({
          style: 'padding:13px 0;border-bottom:1px solid var(--line-faint)',
          title: 'Random-cube die',
          blurb: "Shows the die on the solve screen that loads a random scrambled cube — a developer shortcut, since that cube is not the one in anyone's hand. Scramble keeps its own die regardless.",
          id: 'setToggle-devRandCube', on: Boolean(settings.devRandCube), attrs: 'data-toggle="devRandCube"', label: 'Random-cube die',
        })}
        ${scannerPlacesStickers() ? switchRow({
          style: 'padding:13px 0;border-bottom:1px solid var(--line-faint)',
          title: 'Sticker view while scanning',
          blurb: 'For the scan-guidance study: while a scan reads, the small cube beside the tiles is replaced by where the camera sees each sticker. It never shows the camera picture.',
          id: 'setToggle-devScanView', on: settings.devScanView === SCAN_VIEWS.stickers, attrs: 'data-scan-view', label: 'Sticker view while scanning',
        }) : ''}
        <div class="sub" style="color:var(--ink-5);margin-top:12px">${escHtml(t('%1 hides this section again.', advancedChordWords()))}</div>
        ${unsavedNote('advanced')}</div>
        ${spokenLinesCard()}` : ''}
      <div class="card"><div class="eyebrow">ABOUT</div>
        <div class="about-brand"><img src="./icons/icon.svg" alt="" width="22" height="22" /><b>Cubus</b></div>
        <div class="about-row">${icon('tag', 15)}<span class="k">${t('Version')}</span><span class="num">${VERSION}</span></div>
        ${appUpdater() ? `<div class="about-row">${icon('refresh', 15)}<span class="k">${t('Updates')}</span><button class="pill" id="checkUpdate">${t('Check now')}</button></div>` : ''}
        <div class="about-row">${icon('globe', 15)}<span class="k">${t('Website')}</span><a class="link" id="aboutSite" href="https://cubus.im" target="_blank" rel="noopener">cubus.im</a></div>
        <div class="about-row">${icon('user', 15)}<span class="k">${t('Author')}</span><a class="link" id="aboutAuthor" href="https://lixiaolai.com" target="_blank" rel="noopener">@xiaolai</a></div>
        <div class="about-row">${icon('book', 15)}<span class="k">${t('Credits')}</span><a class="link" id="aboutNotices" href="./THIRD_PARTY_NOTICES.md" rel="noopener">${t('Third-party notices')}</a></div>
        <div class="sub" style="color:var(--ink-3);margin-top:10px;line-height:1.55">${t(privacySentence())}</div></div>
    </div></div>`,
    mount(root) {
      // ONE CALL PER CARD, in the order the cards are drawn. This was a single 51-line run of
      // wiring — every card's controls, the updater, the nav — so a change to one card's behaviour
      // was a change inside a function that owned eight others (audit, 2026-09-20). `mountSmartCube`
      // and `wireOrientation` were already shaped this way; the rest now match them.
      mountAppearance(root);
      mountAbout(root);
      mountCubeColours(root);
      mountCamera(root);
      mountAdvanced(root);
      mountSpokenLines(root);
      mountSmartCube(root);
    },
  };
};

/** The palette swatch, the theme pills, the solve tier and the window shape. */
function mountAppearance(root) {
  const swatch = () => { const p = netPalette(); $('#palSwatch', root).innerHTML = ['U', 'D', 'R', 'L', 'F', 'B'].map((k) => `<div style="flex:1;height:34px;border-radius:var(--r-2);background:${p[k]}"></div>`).join(''); };
  swatch();
  // Every preference takes lib/screens/settings/preferences.js's one path: changed, kept,
  // shown — and said in its own card when the browser would not keep it.
  bindChoice(root, 'data-set-theme', 'setTheme', (v) => { settings.theme = v; }, () => { applyTheme(); renderScreen(); });
  // Changing the target does not re-solve anything now — the next solve uses it. Clearing
  // the cached solution is what makes that true; without it the old answer would stand.
  bindChoice(root, 'data-set-tier', 'setTier', (v) => {
    settings.solveTier = v;
    state.cube.solution = '';
    state.cube.solveResult = null;
  }, renderScreen);
  wireOrientation($('#orientationPills', root));
  for (const b of root.querySelectorAll('[data-toggle]')) {
    const k = b.dataset.toggle;
    bindSwitch(b, { isOn: () => settings[k], flip: () => { settings[k] = !settings[k]; } });
  }
}

/** The update check, drawn only where `updater` exists — the desktop gate — so this never looks for
 *  a button the browser build does not have. What a press does is lib/update-ui.js's. */
function mountAbout(root) {
  const checkBtn = $('#checkUpdate', root);
  const upd = appUpdater();
  if (checkBtn && upd) checkBtn.onclick = () => runUpdatePress(upd, checkBtn);
}

/** The palette pills and the colour scheme. */
function mountCubeColours(root) {
  bindChoice(root, 'data-pal', 'pal', (v) => { settings.palette = v; }, () => { applyNetColors(); renderScreen(); });
  // Setting it by hand is EVIDENCE, and is recorded as such: a scan may still correct it —
  // the cube in the hand outranks a setting about the cube in the hand — but until one does,
  // this is what the app draws, and it is no longer the default nobody chose (ADR 0001 §8.3).
  const schemeToggle = $('[data-scheme]', root);
  if (schemeToggle) schemeToggle.onclick = () => commitPref(schemeToggle, () => {
    settings.scheme = settings.scheme === 'japanese' ? 'western' : 'japanese';
    settings.schemeSource = 'user';
  }, () => {
    applyNetColors();
    renderScreen();
  });
}

/** The sound mode. Choosing a quieter one means quieter NOW: a chime or a line already under way is
 *  stopped rather than left to finish after the choice said otherwise (audit, 2026-09-19, kept
 *  through the move from a boolean to three modes). `hush()` on every change, because leaving
 *  `voice` for either other mode must cut a line mid-word; `stopAll()` only for `off`, since
 *  `chime` keeps the bell that may be sounding. */
function mountCamera(root) {
  bindChoice(root, 'data-set-sound', 'setSound', (v) => {
    settings.soundMode = v;
    hush();
    if (settings.soundMode === SOUND_MODES.off) stopAll();
  }, renderScreen);
}

/** The developer section: the study's arm, and which screens the toolbar shows. */
function mountAdvanced(root) {
  // The study's arm is a pair of values, not a boolean, so it has its own press rather than the
  // generic toggle's `!settings[k]` (dev-docs/scan-guidance-plan.md 4.1).
  const scanView = $('[data-scan-view]', root);
  const stickersOn = () => settings.devScanView === SCAN_VIEWS.stickers;
  if (scanView) bindSwitch(scanView, {
    isOn: stickersOn,
    flip: () => { settings.devScanView = stickersOn() ? SCAN_VIEWS.today : SCAN_VIEWS.stickers; },
  });
  for (const b of root.querySelectorAll('[data-nav-toggle]')) b.onclick = () => commitPref(b, () => {
    const id = b.dataset.navToggle;
    settings.navHidden = navHidden(id) ? settings.navHidden.filter((x) => x !== id) : [...settings.navHidden, id];
  }, () => {
    renderNav();
    // Hiding the screen you are standing on would leave the toolbar with nothing marked
    // active. You are on Settings when you press this, so that only bites via a deep link.
    if (navHidden(state.screen)) { go('home'); return; }
    renderScreen(); // repaints this card's own labels, so it cannot describe the old state
  });
}
