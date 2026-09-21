// The scan screen's camera menu: the webcam button that IS the menu, the cameras it offers,
// which one is in force, the camera the scanner is pinned to, and the row's word for whether
// one is on.
//
// Its own unit because it is its own conversation — with the platform's list of cameras, the
// scanner's pin and the stored choice — and none of it is about reading a cube. The screen has it
// paint the row from a scan report, close its menu, and say whether the menu is open; it asks the
// screen whether painting is on, to stop painting when a camera is chosen, and to close every
// popover first. Lifted out of lib/screens/scan.js on 2026-09-13; pinned by the camera cases in
// test/scan-screen.test.mjs. The menu itself — its opening and closing, placing, focus, arrow keys
// and ticks — is lib/menu-popover.js, which the cube screen's speed menu is built on too.

import { $ } from '../../app-state.js';
import { save, settings } from '../../app-settings.js';
import { t } from '../../i18n.js';
import { createMenu } from '../../menu-popover.js';
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
  // so a screen that shows no picture still says plainly whether one is running. The menu holds
  // the cameras and nothing else; starting the scan over has its own button beside it.
  // A press on the button closes every popover first, and asks for the cameras again as it opens.
  const popover = createMenu({
    root, button: camBtn, label: t('Camera and scan'), signal, place: placeMenuUnder,
    closeFirst: closePops, beforeOpen: () => { void fillCams(); },
  });
  const menu = popover.el;
  let camOn = false;
  let camsKey = null;
  /** The device the scanner last reported running, or null while none is. */
  let shownDevice = null;
  const choose = (id) => {
    settings.cameraId = id; save('cubusSettings', settings);
    pin(id);
    closePops();
    // The menu that just closed held the focus. It goes back to the control it came from, where
    // Escape puts it; closing left it inside a hidden list (found by audit, 2026-09-13).
    camBtn.focus();
    // Picking a camera is asking to scan, so it leaves painting; otherwise the camera would
    // open under a mode that exists to keep it shut.
    if (isPainting()) stopPainting();
    // A camera that will not open is the scanner's to say, on scan-progress. Its refused promise
    // is caught here, rather than left to become an unhandled rejection on top of that.
    else void Promise.resolve(panel.start?.()).catch((err) => console.warn('the chosen camera did not open', err));
  };
  const cameraButton = (value, label) => {
    // Device labels come from the OS — set as text, never interpolated into HTML.
    const b = popover.radio(label, () => choose(value));
    b.dataset.value = value;
    return b;
  };
  const markActive = () => {
    const cams = [...menu.querySelectorAll('[data-value]')];
    const listed = (id) => cams.some((b) => b.dataset.value === id);
    // WHICH CAMERA ANSWERED, not only which was asked for: a listed camera can refuse to open and
    // the scanner run another, and a tick on a camera that is not running is wrong about the one
    // fact this menu exists to tell (found by audit, 2026-09-13). With none answering, a pin to a
    // camera no longer attached is not what will be used either — the panel falls back to the
    // platform default — so THAT is marked, rather than nothing.
    const active = shownDevice !== null && listed(shownDevice)
      ? shownDevice
      : (listed(settings.cameraId) ? settings.cameraId : '');
    popover.mark((b) => b.dataset.value === active);
  };
  /** Said IN the menu, where the cameras should be: the list could not be read, and a retry. */
  const sayListFailed = () => {
    // With nothing found yet, the platform's default is still a choice there is to make.
    if (!menu.querySelector('[data-value]')) menu.appendChild(cameraButton('', t('Default camera')));
    if (!menu.querySelector('[data-retry]')) {
      const retry = document.createElement('button');
      retry.type = 'button'; retry.dataset.retry = '';
      retry.setAttribute('role', 'menuitem');
      retry.textContent = t('Could not list the cameras — try again');
      retry.onclick = () => { void fillCams(); };
      menu.appendChild(retry);
    }
    markActive();
  };
  /**
   * Put `buttons` in the menu in this order, and never by moving the one holding the focus: a moved
   * button loses the focus. Putting each in place in turn moved whichever one a reordered list
   * reached out of place first, the focused one included, and the focus fell out of the menu (found
   * by verification, 2026-09-14). The others are put around it instead.
   */
  const arrange = (buttons) => {
    const held = buttons.indexOf(document.activeElement);
    // Back from the focused button, or from the end: each goes directly before the one after it.
    let next = held < 0 ? null : buttons[held];
    for (let i = (held < 0 ? buttons.length : held) - 1; i >= 0; i -= 1) {
      const b = buttons[i];
      if (b.parentNode !== menu || b.nextElementSibling !== next) menu.insertBefore(b, next);
      next = b;
    }
    // On from it: each goes directly after the one before it.
    for (let i = held + 1; held >= 0 && i < buttons.length; i += 1) {
      const prev = buttons[i - 1];
      if (prev.nextElementSibling !== buttons[i]) menu.insertBefore(buttons[i], prev.nextElementSibling);
    }
  };
  /** Which list the menu is still waiting for: a device change, an open and a report each ask. */
  let camsGen = 0;
  const fillCams = async () => {
    const mine = ++camsGen;
    let list = [];
    let failed = null;
    try { list = (await panel.cameras?.()) ?? []; } catch (err) { failed = err; }
    // An answer that is not the newest, or one that lands after the screen went, is about a menu
    // nobody is looking at. The older of two, landing last, replaced the newer list and cached
    // its key (found by audit, 2026-09-13).
    if (mine !== camsGen || signal?.aborted) return;
    if (failed) {
      // A REFUSAL IS NOT AN EMPTY LIST. Read as one, it blanked the cameras already found down to
      // "Default camera" and hid why (found by audit, 2026-09-13).
      console.warn('the camera list could not be read', failed);
      // The menu now holds more than the list its key names, so the next list read is drawn
      // whatever it holds: an unchanged list matched the key, and the failure stayed standing
      // (found by verification, 2026-09-14).
      camsKey = null;
      sayListFailed();
      return;
    }
    // Ids AND labels: a label is readable only once permission is granted, so the same ids coming
    // back named is exactly the change paintCameraRow's refresh exists to draw.
    const key = list.map((d) => `${d.deviceId}\u0000${d.label}`).join('|');
    if (key === camsKey) { markActive(); return; }
    camsKey = key;
    // RECONCILED, NOT REBUILT. A camera still listed keeps its button, so a list that changes while
    // the menu is open no longer takes the keyboard's focus with it (found by audit, 2026-09-13).
    //
    // ONE BUTTON PER ID, and the empty id is this menu's own (2026-09-20). Before permission is
    // granted the platform lists its cameras with an empty `deviceId` and an empty label — a
    // placeholder, not a device — and a row keyed on it was a second "Default camera" that the
    // tick landed on as well, both marked, neither choosable apart (scanner audit 2026-09-20,
    // §2.11). The scanner drops such entries itself now; the menu holds its own invariant so it
    // does not depend on that, and a list that names one camera twice gets one row for it.
    const want = [['', t('Default camera')]];
    const listed = new Set(['']);
    for (const d of list) {
      if (listed.has(d.deviceId)) continue;
      listed.add(d.deviceId);
      want.push([d.deviceId, d.label]);
    }
    const keep = new Set(want.map(([value]) => value));
    let lostFocus = false;
    for (const b of [...menu.querySelectorAll('[data-value], [data-retry]')]) {
      if (b.dataset.retry === undefined && keep.has(b.dataset.value)) continue;
      if (b === document.activeElement) lostFocus = true;
      b.remove();
    }
    const have = new Map([...menu.querySelectorAll('[data-value]')].map((b) => [b.dataset.value, b]));
    arrange(want.map(([value, label]) => {
      const b = have.get(value) ?? cameraButton(value, label);
      if (b.textContent !== label) b.textContent = label;
      return b;
    }));
    markActive();
    if (lostFocus) popover.focusIn();
  };
  void fillCams();
  // Cameras come and go — a webcam is plugged in, an iPhone wanders out of Continuity range —
  // and the menu is built once, so without this a newly attached camera would never appear.
  const onDevices = () => { void fillCams(); };
  navigator.mediaDevices?.addEventListener?.('devicechange', onDevices, { signal });

  /** The camera row: which device is on, and what it is called. Cameras come and go, and the
   *  menu is built once — so a device answering for the first time is also the moment its
   *  LABEL becomes readable (permission), which is why the list is rebuilt here rather than
   *  only on `devicechange`. Lifted out of the scan-progress handler, 2026-09-05. */
  const paintCameraRow = (p) => {
    camOn = Boolean(p.device);
    camRow.classList.toggle('on', camOn);
    // Through t(), in placeholder form: the device's name comes from the OS and is never part of
    // the sentence (these two bypassed the catalog; found by audit, 2026-09-13).
    camBtn.title = camOn ? t('%1 — camera and scan', p.device.label) : t('Camera off — click to turn it on');
    camBtn.setAttribute('aria-label', camBtn.title);
    // Labels are only readable once permission is granted, so the list is worth rebuilding the
    // first time a camera actually answers; with none answering, the tick goes back to the pin.
    const running = p.device?.deviceId ?? null;
    if (running !== shownDevice) {
      shownDevice = running;
      if (running) void fillCams();
      else markActive();
    }
  };

  /** Close the menu: the screen's closePops calls this beside its other popovers. */
  const closeMenu = () => { popover.close(); };
  /** Whether the menu is open, so Escape knows to hand focus back to the button that opened it. */
  const menuOpen = () => popover.isOpen();
  /** A press anywhere but the menu, or the button that toggles it, closes it. */
  const closeMenuUnless = (target) => { popover.closeUnless(target); };
  /** Focus back on the webcam button, the control the menu came from. */
  const focusButton = () => { camBtn.focus(); };
  /** Painting and the camera are exclusive, and the row shows which one is in charge. */
  const showPainting = (on) => { camRow.classList.toggle('paint', on); };

  return Object.freeze({ paintCameraRow, closeMenu, menuOpen, closeMenuUnless, focusButton, showPainting });
}
