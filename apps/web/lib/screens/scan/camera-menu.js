// The scan screen's camera menu: the webcam button that IS the menu, the cameras it offers,
// which one is in force, the camera the scanner is pinned to, and the row's word for whether
// one is on.
//
// Its own unit because it is its own conversation — with the platform's list of cameras, the
// scanner's pin and the stored choice — and none of it is about reading a cube. The screen has it
// paint the row from a scan report, close its menu, and say whether the menu is open; it asks the
// screen whether painting is on, to stop painting when a camera is chosen, and to close every
// popover first. Lifted out of lib/screens/scan.js on 2026-09-13; pinned by the camera cases in
// test/scan-screen.test.mjs.

import { $ } from '../../app-state.js';
import { save, settings } from '../../app-settings.js';
import { t } from '../../i18n.js';
import { placeMenuUnder } from '../../screen-shell.js';

/**
 * The camera menu of one mounted scan screen: its button wired, the scanner pinned, the first list
 * filled.
 *
 * @param {object} deps `root`; the scanner `panel`; the screen's abort `signal`, which the
 *   devicechange listener carries; `closePops()`, which closes every popover (this menu
 *   included) before a choice or a press acts; and `isPainting()` / `stopPainting()`, because
 *   choosing a camera is asking to scan.
 */
export function createCameraMenu({ root, panel, signal, closePops, isPainting, stopPainting }) {
  // Which camera. This machine class routinely has several — a built-in, a virtual camera, a
  // Continuity Camera (an iPhone) — and with no video preview the user cannot tell which one
  // answered. The pin is an ATTRIBUTE, not a property: mount() runs before the element's
  // deferred autostart, but a property set before the element upgrades would be clobbered by
  // its own class fields, whereas an attribute survives and start() re-reads it.
  const camRow = $('.scan-cam', root), camBtn = $('#scanCamBtn', root);

  const pin = (id) => { if (id) panel.setAttribute('device-id', id); else panel.removeAttribute('device-id'); };
  pin(settings.cameraId);
  // The webcam button IS the camera menu: one control in the corner rather than a button and a
  // dropdown competing for the same space. Its lens fills and pulses while a camera is open,
  // so a screen that shows no picture still says plainly whether one is running. The menu also
  // carries the scan action, which would otherwise have nowhere left to live.
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.hidden = true;
  // A menu, said as one: without a role it is a div of buttons, and a screen reader gives no
  // hint that Escape closes it or that its items belong together.
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', t('Camera and scan'));
  root.appendChild(menu);
  let camOn = false;
  let camsKey = null;
  const choose = (id) => {
    settings.cameraId = id; save('cubusSettings', settings);
    pin(id);
    closePops();
    // Picking a camera is asking to scan, so it leaves painting; otherwise the camera would
    // open under a mode that exists to keep it shut.
    if (isPainting()) stopPainting();
    else void panel.start?.();
  };
  const markActive = () => {
    const items = [...menu.querySelectorAll('[data-value]')];
    // A pinned camera that is no longer attached is not what will be used — the panel falls
    // back to the platform default — so mark THAT rather than ticking nothing and leaving the
    // menu mute about which camera is in force.
    const active = items.some((b) => b.dataset.value === settings.cameraId) ? settings.cameraId : '';
    for (const b of items) {
      const now = b.dataset.value === active;
      b.classList.toggle('now', now);
      b.setAttribute('aria-checked', String(now)); // the tick is the look; this is the fact
    }
  };
  const fillCams = async () => {
    let list = [];
    try { list = (await panel.cameras?.()) ?? []; } catch { list = []; }
    const key = list.map((d) => d.deviceId).join('|');
    if (key === camsKey) { markActive(); return; }
    camsKey = key;
    menu.textContent = '';
    // Device labels come from the OS — set as text, never interpolated into HTML.
    const add = (value, label) => {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.value = value; b.textContent = label;
      b.setAttribute('role', 'menuitemradio');
      b.onclick = () => choose(value);
      menu.appendChild(b);
    };
    add('', 'Default camera');
    for (const d of list) add(d.deviceId, d.label);
    markActive();
  };
  void fillCams();
  // Cameras come and go — a webcam is plugged in, an iPhone wanders out of Continuity range —
  // and the menu is built once, so without this a newly attached camera would never appear.
  const onDevices = () => { void fillCams(); };
  navigator.mediaDevices?.addEventListener?.('devicechange', onDevices, { signal });
  let shownDevice = null;

  camBtn.onclick = (ev) => {
    const open = menu.hidden;
    closePops();
    if (!open) return;
    void fillCams();
    menu.hidden = false;
    placeMenuUnder(camBtn, menu);
    // Focus goes IN. A popover that opens behind the focus ring is one a keyboard cannot
    // reach without tabbing through everything after the button that opened it.
    (menu.querySelector('.now') ?? menu.firstElementChild)?.focus();
    ev.stopPropagation();
  };

  /** The camera row: which device is on, and what it is called. Cameras come and go, and the
   *  menu is built once — so a device answering for the first time is also the moment its
   *  LABEL becomes readable (permission), which is why the list is rebuilt here rather than
   *  only on `devicechange`. Lifted out of the scan-progress handler, 2026-09-05. */
  const paintCameraRow = (p) => {
    camOn = Boolean(p.device);
    camRow.classList.toggle('on', camOn);
    camBtn.title = camOn ? `${p.device.label} — camera and scan` : 'Camera off — click to turn it on';
    camBtn.setAttribute('aria-label', camBtn.title);
    // Labels are only readable once permission is granted, so the list is worth rebuilding the
    // first time a camera actually answers.
    if (p.device && p.device.deviceId !== shownDevice) {
      shownDevice = p.device.deviceId;
      void fillCams();
    }
  };

  /** Close the menu: the screen's closePops calls this beside its other popovers. */
  const closeMenu = () => { menu.hidden = true; };
  /** Whether the menu is open, so Escape knows to hand focus back to the button that opened it. */
  const menuOpen = () => !menu.hidden;
  /** A press anywhere but the menu, or the button that toggles it, closes it. */
  const closeMenuUnless = (target) => {
    if (!menu.hidden && !menu.contains(target) && target !== camBtn) menu.hidden = true;
  };
  /** Focus back on the webcam button, the control the menu came from. */
  const focusButton = () => { camBtn.focus(); };
  /** Painting and the camera are exclusive, and the row shows which one is in charge. */
  const showPainting = (on) => { camRow.classList.toggle('paint', on); };

  return Object.freeze({ paintCameraRow, closeMenu, menuOpen, closeMenuUnless, focusButton, showPainting });
}
