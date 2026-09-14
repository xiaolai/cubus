// The Settings screen.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { TIERS } from '../solve-target.js';
import { capability as optimalCapability } from '../optimal.js';
import { isDesktopHost } from '../host.js';
import { t } from '../i18n.js';
import { VERSION } from '../version.js';

import { $, escHtml, icon, state } from '../app-state.js';
import { HIDEABLE, PALETTES, THEMES, navHidden, settings } from '../app-settings.js';
import { applyNetColors, applyTheme, netPalette } from '../cube-drawing.js';
import { isTauri } from '../window-chrome.js';
import { PROVE_COPY } from '../prove-affordance.js';
import {
  appUpdater, privacySentence, runUpdatePress,
} from '../update-ui.js';
import { SCREENS, advancedChordWords, advancedOpen, go, renderNav, renderScreen } from '../screen-shell.js';
import { mountSmartCube, smartCubeCard } from './settings/smart-cube.js';
import { wireOrientation } from './settings/window-orientation.js';
import { commitPref, switchRow, unsavedNote } from './settings/preferences.js';

// How the four rungs read on the Settings screen. A rung with no label here would render as
// "undefined", so solve-tier-wiring.test.mjs checks every TIERS entry has one.
const TIER_LABEL = { twenty: '≤ 20', nineteen: '≤ 19', eighteen: '≤ 18', shortest: 'shortest' };
const TIER_BLURB = {
  twenty: 'Twenty moves or fewer — always possible, and quick. An easy cube still gets its short answer',
  nineteen: 'Nineteen or fewer — a moment longer, and it almost always gets there',
  eighteen: 'Eighteen when it can be found; often it cannot, and it says so rather than pretend',
  shortest: 'Keeps looking for a shorter one until you move on',
};

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
        <div class="sub" style="color:var(--ink-5);margin-top:12px">${escHtml(t('%1 hides this section again.', advancedChordWords()))}</div>
        ${unsavedNote('advanced')}</div>` : ''}
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
      const swatch = () => { const p = netPalette(); $('#palSwatch', root).innerHTML = ['U', 'D', 'R', 'L', 'F', 'B'].map((k) => `<div style="flex:1;height:34px;border-radius:var(--r-2);background:${p[k]}"></div>`).join(''); };
      swatch();
      // Drawn only where `updater` exists, which is the desktop gate — so this never looks for a
      // button the browser build does not have. What a press does is lib/update-ui.js's.
      const checkBtn = $('#checkUpdate', root);
      const upd = appUpdater();
      if (checkBtn && upd) checkBtn.onclick = () => runUpdatePress(upd, checkBtn);
      // Every preference takes lib/screens/settings/preferences.js's one path: changed, kept,
      // shown — and said in its own card when the browser would not keep it.
      for (const b of root.querySelectorAll('[data-set-theme]')) b.onclick = () => commitPref(b, () => { settings.theme = b.dataset.setTheme; }, () => { applyTheme(); renderScreen(); });
      // Changing the target does not re-solve anything now — the next solve uses it. Clearing
      // the cached solution is what makes that true; without it the old answer would stand.
      for (const b of root.querySelectorAll('[data-set-tier]')) b.onclick = () => commitPref(b, () => { settings.solveTier = b.dataset.setTier; state.cube.solution = ''; state.cube.solveResult = null; }, renderScreen);
      wireOrientation($('#orientationPills', root));
      for (const b of root.querySelectorAll('[data-pal]')) b.onclick = () => commitPref(b, () => { settings.palette = b.dataset.pal; }, () => { applyNetColors(); renderScreen(); });
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
      for (const b of root.querySelectorAll('[data-toggle]')) b.onclick = () => {
        const k = b.dataset.toggle;
        commitPref(b, () => { settings[k] = !settings[k]; }, () => {
          b.classList.toggle('on', settings[k]);
          b.setAttribute('aria-checked', String(Boolean(settings[k])));
        });
      };

      mountSmartCube(root);

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
    },
  };
};
