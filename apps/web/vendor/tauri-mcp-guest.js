// ../../node_modules/.pnpm/@tauri-apps+api@2.11.1/node_modules/@tauri-apps/api/external/tslib/tslib.es6.js
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}

// ../../node_modules/.pnpm/@tauri-apps+api@2.11.1/node_modules/@tauri-apps/api/core.js
var _Channel_onmessage;
var _Channel_nextMessageIndex;
var _Channel_pendingMessages;
var _Channel_messageEndIndex;
var _Resource_rid;
var SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";
function transformCallback(callback, once2 = false) {
  return window.__TAURI_INTERNALS__.transformCallback(callback, once2);
}
var Channel = class {
  constructor(onmessage) {
    _Channel_onmessage.set(this, void 0);
    _Channel_nextMessageIndex.set(this, 0);
    _Channel_pendingMessages.set(this, []);
    _Channel_messageEndIndex.set(this, void 0);
    __classPrivateFieldSet(this, _Channel_onmessage, onmessage || (() => {
    }), "f");
    this.id = transformCallback((rawMessage) => {
      const index = rawMessage.index;
      if ("end" in rawMessage) {
        if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
          this.cleanupCallback();
        } else {
          __classPrivateFieldSet(this, _Channel_messageEndIndex, index, "f");
        }
        return;
      }
      const message = rawMessage.message;
      if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
        __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
        __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        while (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") in __classPrivateFieldGet(this, _Channel_pendingMessages, "f")) {
          const message2 = __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message2);
          delete __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        }
        if (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") === __classPrivateFieldGet(this, _Channel_messageEndIndex, "f")) {
          this.cleanupCallback();
        }
      } else {
        __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[index] = message;
      }
    });
  }
  cleanupCallback() {
    window.__TAURI_INTERNALS__.unregisterCallback(this.id);
  }
  set onmessage(handler) {
    __classPrivateFieldSet(this, _Channel_onmessage, handler, "f");
  }
  get onmessage() {
    return __classPrivateFieldGet(this, _Channel_onmessage, "f");
  }
  [(_Channel_onmessage = /* @__PURE__ */ new WeakMap(), _Channel_nextMessageIndex = /* @__PURE__ */ new WeakMap(), _Channel_pendingMessages = /* @__PURE__ */ new WeakMap(), _Channel_messageEndIndex = /* @__PURE__ */ new WeakMap(), SERIALIZE_TO_IPC_FN)]() {
    return `__CHANNEL__:${this.id}`;
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
};
async function invoke(cmd, args = {}, options) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
}
var Resource = class {
  get rid() {
    return __classPrivateFieldGet(this, _Resource_rid, "f");
  }
  constructor(rid) {
    _Resource_rid.set(this, void 0);
    __classPrivateFieldSet(this, _Resource_rid, rid, "f");
  }
  /**
   * Destroys and cleans up this resource from memory.
   * **You should not call any method on this object anymore and should drop any reference to it.**
   */
  async close() {
    return invoke("plugin:resources|close", {
      rid: this.rid
    });
  }
};
_Resource_rid = /* @__PURE__ */ new WeakMap();

// ../../node_modules/.pnpm/@tauri-apps+api@2.11.1/node_modules/@tauri-apps/api/event.js
var TauriEvent;
(function(TauriEvent2) {
  TauriEvent2["WINDOW_RESIZED"] = "tauri://resize";
  TauriEvent2["WINDOW_MOVED"] = "tauri://move";
  TauriEvent2["WINDOW_CLOSE_REQUESTED"] = "tauri://close-requested";
  TauriEvent2["WINDOW_DESTROYED"] = "tauri://destroyed";
  TauriEvent2["WINDOW_FOCUS"] = "tauri://focus";
  TauriEvent2["WINDOW_BLUR"] = "tauri://blur";
  TauriEvent2["WINDOW_SCALE_FACTOR_CHANGED"] = "tauri://scale-change";
  TauriEvent2["WINDOW_THEME_CHANGED"] = "tauri://theme-changed";
  TauriEvent2["WINDOW_CREATED"] = "tauri://window-created";
  TauriEvent2["WINDOW_SUSPENDED"] = "tauri://suspended";
  TauriEvent2["WINDOW_RESUMED"] = "tauri://resumed";
  TauriEvent2["WEBVIEW_CREATED"] = "tauri://webview-created";
  TauriEvent2["DRAG_ENTER"] = "tauri://drag-enter";
  TauriEvent2["DRAG_OVER"] = "tauri://drag-over";
  TauriEvent2["DRAG_DROP"] = "tauri://drag-drop";
  TauriEvent2["DRAG_LEAVE"] = "tauri://drag-leave";
})(TauriEvent || (TauriEvent = {}));
async function _unlisten(event, eventId) {
  window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
  await invoke("plugin:event|unlisten", {
    event,
    eventId
  });
}
async function listen(event, handler, options) {
  var _a;
  const target = typeof (options === null || options === void 0 ? void 0 : options.target) === "string" ? { kind: "AnyLabel", label: options.target } : (_a = options === null || options === void 0 ? void 0 : options.target) !== null && _a !== void 0 ? _a : { kind: "Any" };
  return invoke("plugin:event|listen", {
    event,
    target,
    handler: transformCallback(handler)
  }).then((eventId) => {
    return async () => _unlisten(event, eventId);
  });
}
async function once(event, handler, options) {
  return listen(event, (eventData) => {
    void _unlisten(event, eventData.id);
    handler(eventData);
  }, options);
}
async function emit(event, payload) {
  await invoke("plugin:event|emit", {
    event,
    payload
  });
}
async function emitTo(target, event, payload) {
  const eventTarget = typeof target === "string" ? { kind: "AnyLabel", label: target } : target;
  await invoke("plugin:event|emit_to", {
    target: eventTarget,
    event,
    payload
  });
}

// ../../node_modules/.pnpm/@tauri-apps+api@2.11.1/node_modules/@tauri-apps/api/dpi.js
var LogicalSize = class {
  constructor(...args) {
    this.type = "Logical";
    if (args.length === 1) {
      if ("Logical" in args[0]) {
        this.width = args[0].Logical.width;
        this.height = args[0].Logical.height;
      } else {
        this.width = args[0].width;
        this.height = args[0].height;
      }
    } else {
      this.width = args[0];
      this.height = args[1];
    }
  }
  /**
   * Converts the logical size to a physical one.
   * @example
   * ```typescript
   * import { LogicalSize } from '@tauri-apps/api/dpi';
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   *
   * const appWindow = getCurrentWindow();
   * const factor = await appWindow.scaleFactor();
   * const size = new LogicalSize(400, 500);
   * const physical = size.toPhysical(factor);
   * ```
   *
   * @since 2.0.0
   */
  toPhysical(scaleFactor) {
    return new PhysicalSize(this.width * scaleFactor, this.height * scaleFactor);
  }
  [SERIALIZE_TO_IPC_FN]() {
    return {
      width: this.width,
      height: this.height
    };
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
};
var PhysicalSize = class {
  constructor(...args) {
    this.type = "Physical";
    if (args.length === 1) {
      if ("Physical" in args[0]) {
        this.width = args[0].Physical.width;
        this.height = args[0].Physical.height;
      } else {
        this.width = args[0].width;
        this.height = args[0].height;
      }
    } else {
      this.width = args[0];
      this.height = args[1];
    }
  }
  /**
   * Converts the physical size to a logical one.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const appWindow = getCurrentWindow();
   * const factor = await appWindow.scaleFactor();
   * const size = await appWindow.innerSize(); // PhysicalSize
   * const logical = size.toLogical(factor);
   * ```
   */
  toLogical(scaleFactor) {
    return new LogicalSize(this.width / scaleFactor, this.height / scaleFactor);
  }
  [SERIALIZE_TO_IPC_FN]() {
    return {
      width: this.width,
      height: this.height
    };
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
};
var Size = class {
  constructor(size) {
    this.size = size;
  }
  toLogical(scaleFactor) {
    return this.size instanceof LogicalSize ? this.size : this.size.toLogical(scaleFactor);
  }
  toPhysical(scaleFactor) {
    return this.size instanceof PhysicalSize ? this.size : this.size.toPhysical(scaleFactor);
  }
  [SERIALIZE_TO_IPC_FN]() {
    return {
      [`${this.size.type}`]: {
        width: this.size.width,
        height: this.size.height
      }
    };
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
};
var LogicalPosition = class {
  constructor(...args) {
    this.type = "Logical";
    if (args.length === 1) {
      if ("Logical" in args[0]) {
        this.x = args[0].Logical.x;
        this.y = args[0].Logical.y;
      } else {
        this.x = args[0].x;
        this.y = args[0].y;
      }
    } else {
      this.x = args[0];
      this.y = args[1];
    }
  }
  /**
   * Converts the logical position to a physical one.
   * @example
   * ```typescript
   * import { LogicalPosition } from '@tauri-apps/api/dpi';
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   *
   * const appWindow = getCurrentWindow();
   * const factor = await appWindow.scaleFactor();
   * const position = new LogicalPosition(400, 500);
   * const physical = position.toPhysical(factor);
   * ```
   *
   * @since 2.0.0
   */
  toPhysical(scaleFactor) {
    return new PhysicalPosition(this.x * scaleFactor, this.y * scaleFactor);
  }
  [SERIALIZE_TO_IPC_FN]() {
    return {
      x: this.x,
      y: this.y
    };
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
};
var PhysicalPosition = class {
  constructor(...args) {
    this.type = "Physical";
    if (args.length === 1) {
      if ("Physical" in args[0]) {
        this.x = args[0].Physical.x;
        this.y = args[0].Physical.y;
      } else {
        this.x = args[0].x;
        this.y = args[0].y;
      }
    } else {
      this.x = args[0];
      this.y = args[1];
    }
  }
  /**
   * Converts the physical position to a logical one.
   * @example
   * ```typescript
   * import { PhysicalPosition } from '@tauri-apps/api/dpi';
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   *
   * const appWindow = getCurrentWindow();
   * const factor = await appWindow.scaleFactor();
   * const position = new PhysicalPosition(400, 500);
   * const physical = position.toLogical(factor);
   * ```
   *
   * @since 2.0.0
   */
  toLogical(scaleFactor) {
    return new LogicalPosition(this.x / scaleFactor, this.y / scaleFactor);
  }
  [SERIALIZE_TO_IPC_FN]() {
    return {
      x: this.x,
      y: this.y
    };
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
};
var Position = class {
  constructor(position) {
    this.position = position;
  }
  toLogical(scaleFactor) {
    return this.position instanceof LogicalPosition ? this.position : this.position.toLogical(scaleFactor);
  }
  toPhysical(scaleFactor) {
    return this.position instanceof PhysicalPosition ? this.position : this.position.toPhysical(scaleFactor);
  }
  [SERIALIZE_TO_IPC_FN]() {
    return {
      [`${this.position.type}`]: {
        x: this.position.x,
        y: this.position.y
      }
    };
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
};

// ../../node_modules/.pnpm/@tauri-apps+api@2.11.1/node_modules/@tauri-apps/api/image.js
var Image = class _Image extends Resource {
  /**
   * Creates an Image from a resource ID. For internal use only.
   *
   * @ignore
   */
  constructor(rid) {
    super(rid);
  }
  /** Creates a new Image using RGBA data, in row-major order from top to bottom, and with specified width and height. */
  static async new(rgba, width, height) {
    return invoke("plugin:image|new", {
      rgba: transformImage(rgba),
      width,
      height
    }).then((rid) => new _Image(rid));
  }
  /**
   * Creates a new image using the provided bytes by inferring the file format.
   * If the format is known, prefer [@link Image.fromPngBytes] or [@link Image.fromIcoBytes].
   *
   * Only `ico` and `png` are supported (based on activated feature flag).
   *
   * Note that you need the `image-ico` or `image-png` Cargo features to use this API.
   * To enable it, change your Cargo.toml file:
   * ```toml
   * [dependencies]
   * tauri = { version = "...", features = ["...", "image-png"] }
   * ```
   */
  static async fromBytes(bytes) {
    return invoke("plugin:image|from_bytes", {
      bytes: transformImage(bytes)
    }).then((rid) => new _Image(rid));
  }
  /**
   * Creates a new image using the provided path.
   *
   * Only `ico` and `png` are supported (based on activated feature flag).
   *
   * Note that you need the `image-ico` or `image-png` Cargo features to use this API.
   * To enable it, change your Cargo.toml file:
   * ```toml
   * [dependencies]
   * tauri = { version = "...", features = ["...", "image-png"] }
   * ```
   */
  static async fromPath(path) {
    return invoke("plugin:image|from_path", { path }).then((rid) => new _Image(rid));
  }
  /** Returns the RGBA data for this image, in row-major order from top to bottom.  */
  async rgba() {
    return invoke("plugin:image|rgba", {
      rid: this.rid
    }).then((buffer) => new Uint8Array(buffer));
  }
  /** Returns the size of this image.  */
  async size() {
    return invoke("plugin:image|size", { rid: this.rid });
  }
};
function transformImage(image) {
  const ret = image == null ? null : typeof image === "string" ? image : image instanceof Image ? image.rid : image;
  return ret;
}

// ../../node_modules/.pnpm/@tauri-apps+api@2.11.1/node_modules/@tauri-apps/api/window.js
var UserAttentionType;
(function(UserAttentionType2) {
  UserAttentionType2[UserAttentionType2["Critical"] = 1] = "Critical";
  UserAttentionType2[UserAttentionType2["Informational"] = 2] = "Informational";
})(UserAttentionType || (UserAttentionType = {}));
var CloseRequestedEvent = class {
  constructor(event) {
    this._preventDefault = false;
    this.event = event.event;
    this.id = event.id;
  }
  preventDefault() {
    this._preventDefault = true;
  }
  isPreventDefault() {
    return this._preventDefault;
  }
};
var ProgressBarStatus;
(function(ProgressBarStatus2) {
  ProgressBarStatus2["None"] = "none";
  ProgressBarStatus2["Normal"] = "normal";
  ProgressBarStatus2["Indeterminate"] = "indeterminate";
  ProgressBarStatus2["Paused"] = "paused";
  ProgressBarStatus2["Error"] = "error";
})(ProgressBarStatus || (ProgressBarStatus = {}));
function getCurrentWindow() {
  return new Window(window.__TAURI_INTERNALS__.metadata.currentWindow.label, {
    // @ts-expect-error `skip` is not defined in the public API but it is handled by the constructor
    skip: true
  });
}
async function getAllWindows() {
  return invoke("plugin:window|get_all_windows").then((windows) => windows.map((w) => new Window(w, {
    // @ts-expect-error `skip` is not defined in the public API but it is handled by the constructor
    skip: true
  })));
}
var localTauriEvents = ["tauri://created", "tauri://error"];
var Window = class {
  /**
   * Creates a new Window.
   * @example
   * ```typescript
   * import { Window } from '@tauri-apps/api/window';
   * const appWindow = new Window('my-label');
   * appWindow.once('tauri://created', function () {
   *  // window successfully created
   * });
   * appWindow.once('tauri://error', function (e) {
   *  // an error happened creating the window
   * });
   * ```
   *
   * @param label The unique window label. Must be alphanumeric: `a-zA-Z-/:_`.
   * @returns The {@link Window} instance to communicate with the window.
   */
  constructor(label, options = {}) {
    var _a;
    this.label = label;
    this.listeners = /* @__PURE__ */ Object.create(null);
    if (!(options === null || options === void 0 ? void 0 : options.skip)) {
      invoke("plugin:window|create", {
        options: {
          ...options,
          parent: typeof options.parent === "string" ? options.parent : (_a = options.parent) === null || _a === void 0 ? void 0 : _a.label,
          label
        }
      }).then(async () => this.emit("tauri://created")).catch(async (e) => this.emit("tauri://error", e));
    }
  }
  /**
   * Gets the Window associated with the given label.
   * @example
   * ```typescript
   * import { Window } from '@tauri-apps/api/window';
   * const mainWindow = Window.getByLabel('main');
   * ```
   *
   * @param label The window label.
   * @returns The Window instance to communicate with the window or null if the window doesn't exist.
   */
  static async getByLabel(label) {
    var _a;
    return (_a = (await getAllWindows()).find((w) => w.label === label)) !== null && _a !== void 0 ? _a : null;
  }
  /**
   * Get an instance of `Window` for the current window.
   */
  static getCurrent() {
    return getCurrentWindow();
  }
  /**
   * Gets a list of instances of `Window` for all available windows.
   */
  static async getAll() {
    return getAllWindows();
  }
  /**
   *  Gets the focused window.
   * @example
   * ```typescript
   * import { Window } from '@tauri-apps/api/window';
   * const focusedWindow = Window.getFocusedWindow();
   * ```
   *
   * @returns The Window instance or `undefined` if there is not any focused window.
   */
  static async getFocusedWindow() {
    for (const w of await getAllWindows()) {
      if (await w.isFocused()) {
        return w;
      }
    }
    return null;
  }
  /**
   * Listen to an emitted event on this window.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const unlisten = await getCurrentWindow().listen<string>('state-changed', (event) => {
   *   console.log(`Got error: ${payload}`);
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @param event Event name. Must include only alphanumeric characters, `-`, `/`, `:` and `_`.
   * @param handler Event handler.
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async listen(event, handler) {
    if (this._handleTauriEvent(event, handler)) {
      return () => {
        const listeners = this.listeners[event];
        listeners.splice(listeners.indexOf(handler), 1);
      };
    }
    return listen(event, handler, {
      target: { kind: "Window", label: this.label }
    });
  }
  /**
   * Listen to an emitted event on this window only once.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const unlisten = await getCurrentWindow().once<null>('initialized', (event) => {
   *   console.log(`Window initialized!`);
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @param event Event name. Must include only alphanumeric characters, `-`, `/`, `:` and `_`.
   * @param handler Event handler.
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async once(event, handler) {
    if (this._handleTauriEvent(event, handler)) {
      return () => {
        const listeners = this.listeners[event];
        listeners.splice(listeners.indexOf(handler), 1);
      };
    }
    return once(event, handler, {
      target: { kind: "Window", label: this.label }
    });
  }
  /**
   * Emits an event to all {@link EventTarget|targets}.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().emit('window-loaded', { loggedIn: true, token: 'authToken' });
   * ```
   *
   * @param event Event name. Must include only alphanumeric characters, `-`, `/`, `:` and `_`.
   * @param payload Event payload.
   */
  async emit(event, payload) {
    if (localTauriEvents.includes(event)) {
      for (const handler of this.listeners[event] || []) {
        handler({
          event,
          id: -1,
          payload
        });
      }
      return;
    }
    return emit(event, payload);
  }
  /**
   * Emits an event to all {@link EventTarget|targets} matching the given target.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().emit('main', 'window-loaded', { loggedIn: true, token: 'authToken' });
   * ```
   * @param target Label of the target Window/Webview/WebviewWindow or raw {@link EventTarget} object.
   * @param event Event name. Must include only alphanumeric characters, `-`, `/`, `:` and `_`.
   * @param payload Event payload.
   */
  async emitTo(target, event, payload) {
    if (localTauriEvents.includes(event)) {
      for (const handler of this.listeners[event] || []) {
        handler({
          event,
          id: -1,
          payload
        });
      }
      return;
    }
    return emitTo(target, event, payload);
  }
  /** @ignore */
  _handleTauriEvent(event, handler) {
    if (localTauriEvents.includes(event)) {
      if (!(event in this.listeners)) {
        this.listeners[event] = [handler];
      } else {
        this.listeners[event].push(handler);
      }
      return true;
    }
    return false;
  }
  // Getters
  /**
   * The scale factor that can be used to map physical pixels to logical pixels.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const factor = await getCurrentWindow().scaleFactor();
   * ```
   *
   * @returns The window's monitor scale factor.
   */
  async scaleFactor() {
    return invoke("plugin:window|scale_factor", {
      label: this.label
    });
  }
  /**
   * The position of the top-left hand corner of the window's client area relative to the top-left hand corner of the desktop.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const position = await getCurrentWindow().innerPosition();
   * ```
   *
   * @returns The window's inner position.
   */
  async innerPosition() {
    return invoke("plugin:window|inner_position", {
      label: this.label
    }).then((p) => new PhysicalPosition(p));
  }
  /**
   * The position of the top-left hand corner of the window relative to the top-left hand corner of the desktop.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const position = await getCurrentWindow().outerPosition();
   * ```
   *
   * @returns The window's outer position.
   */
  async outerPosition() {
    return invoke("plugin:window|outer_position", {
      label: this.label
    }).then((p) => new PhysicalPosition(p));
  }
  /**
   * The physical size of the window's client area.
   * The client area is the content of the window, excluding the title bar and borders.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const size = await getCurrentWindow().innerSize();
   * ```
   *
   * @returns The window's inner size.
   */
  async innerSize() {
    return invoke("plugin:window|inner_size", {
      label: this.label
    }).then((s) => new PhysicalSize(s));
  }
  /**
   * The physical size of the entire window.
   * These dimensions include the title bar and borders. If you don't want that (and you usually don't), use inner_size instead.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const size = await getCurrentWindow().outerSize();
   * ```
   *
   * @returns The window's outer size.
   */
  async outerSize() {
    return invoke("plugin:window|outer_size", {
      label: this.label
    }).then((s) => new PhysicalSize(s));
  }
  /**
   * Gets the window's current fullscreen state.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const fullscreen = await getCurrentWindow().isFullscreen();
   * ```
   *
   * @returns Whether the window is in fullscreen mode or not.
   */
  async isFullscreen() {
    return invoke("plugin:window|is_fullscreen", {
      label: this.label
    });
  }
  /**
   * Gets the window's current minimized state.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const minimized = await getCurrentWindow().isMinimized();
   * ```
   */
  async isMinimized() {
    return invoke("plugin:window|is_minimized", {
      label: this.label
    });
  }
  /**
   * Gets the window's current maximized state.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const maximized = await getCurrentWindow().isMaximized();
   * ```
   *
   * @returns Whether the window is maximized or not.
   */
  async isMaximized() {
    return invoke("plugin:window|is_maximized", {
      label: this.label
    });
  }
  /**
   * Gets the window's current focus state.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const focused = await getCurrentWindow().isFocused();
   * ```
   *
   * @returns Whether the window is focused or not.
   */
  async isFocused() {
    return invoke("plugin:window|is_focused", {
      label: this.label
    });
  }
  /**
   * Gets the window's current decorated state.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const decorated = await getCurrentWindow().isDecorated();
   * ```
   *
   * @returns Whether the window is decorated or not.
   */
  async isDecorated() {
    return invoke("plugin:window|is_decorated", {
      label: this.label
    });
  }
  /**
   * Gets the window's current resizable state.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const resizable = await getCurrentWindow().isResizable();
   * ```
   *
   * @returns Whether the window is resizable or not.
   */
  async isResizable() {
    return invoke("plugin:window|is_resizable", {
      label: this.label
    });
  }
  /**
   * Gets the window's native maximize button state.
   *
   * #### Platform-specific
   *
   * - **Linux / iOS / Android:** Unsupported.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const maximizable = await getCurrentWindow().isMaximizable();
   * ```
   *
   * @returns Whether the window's native maximize button is enabled or not.
   */
  async isMaximizable() {
    return invoke("plugin:window|is_maximizable", {
      label: this.label
    });
  }
  /**
   * Gets the window's native minimize button state.
   *
   * #### Platform-specific
   *
   * - **Linux / iOS / Android:** Unsupported.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const minimizable = await getCurrentWindow().isMinimizable();
   * ```
   *
   * @returns Whether the window's native minimize button is enabled or not.
   */
  async isMinimizable() {
    return invoke("plugin:window|is_minimizable", {
      label: this.label
    });
  }
  /**
   * Gets the window's native close button state.
   *
   * #### Platform-specific
   *
   * - **iOS / Android:** Unsupported.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const closable = await getCurrentWindow().isClosable();
   * ```
   *
   * @returns Whether the window's native close button is enabled or not.
   */
  async isClosable() {
    return invoke("plugin:window|is_closable", {
      label: this.label
    });
  }
  /**
   * Gets the window's current visible state.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const visible = await getCurrentWindow().isVisible();
   * ```
   *
   * @returns Whether the window is visible or not.
   */
  async isVisible() {
    return invoke("plugin:window|is_visible", {
      label: this.label
    });
  }
  /**
   * Gets the window's current title.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const title = await getCurrentWindow().title();
   * ```
   */
  async title() {
    return invoke("plugin:window|title", {
      label: this.label
    });
  }
  /**
   * Gets the window's current theme.
   *
   * #### Platform-specific
   *
   * - **macOS:** Theme was introduced on macOS 10.14. Returns `light` on macOS 10.13 and below.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const theme = await getCurrentWindow().theme();
   * ```
   *
   * @returns The window theme.
   */
  async theme() {
    return invoke("plugin:window|theme", {
      label: this.label
    });
  }
  /**
   * Whether the window is configured to be always on top of other windows or not.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const alwaysOnTop = await getCurrentWindow().isAlwaysOnTop();
   * ```
   *
   * @returns Whether the window is visible or not.
   */
  async isAlwaysOnTop() {
    return invoke("plugin:window|is_always_on_top", {
      label: this.label
    });
  }
  async activityName() {
    return invoke("plugin:window|activity_name", {
      label: this.label
    });
  }
  async sceneIdentifier() {
    return invoke("plugin:window|scene_identifier", {
      label: this.label
    });
  }
  // Setters
  /**
   * Centers the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().center();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async center() {
    return invoke("plugin:window|center", {
      label: this.label
    });
  }
  /**
   *  Requests user attention to the window, this has no effect if the application
   * is already focused. How requesting for user attention manifests is platform dependent,
   * see `UserAttentionType` for details.
   *
   * Providing `null` will unset the request for user attention. Unsetting the request for
   * user attention might not be done automatically by the WM when the window receives input.
   *
   * #### Platform-specific
   *
   * - **macOS:** `null` has no effect.
   * - **Linux:** Urgency levels have the same effect.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().requestUserAttention();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async requestUserAttention(requestType) {
    let requestType_ = null;
    if (requestType) {
      if (requestType === UserAttentionType.Critical) {
        requestType_ = { type: "Critical" };
      } else {
        requestType_ = { type: "Informational" };
      }
    }
    return invoke("plugin:window|request_user_attention", {
      label: this.label,
      value: requestType_
    });
  }
  /**
   * Updates the window resizable flag.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setResizable(false);
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async setResizable(resizable) {
    return invoke("plugin:window|set_resizable", {
      label: this.label,
      value: resizable
    });
  }
  /**
   * Enable or disable the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setEnabled(false);
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   *
   * @since 2.0.0
   */
  async setEnabled(enabled) {
    return invoke("plugin:window|set_enabled", {
      label: this.label,
      value: enabled
    });
  }
  /**
   * Whether the window is enabled or disabled.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setEnabled(false);
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   *
   * @since 2.0.0
   */
  async isEnabled() {
    return invoke("plugin:window|is_enabled", {
      label: this.label
    });
  }
  /**
   * Sets whether the window's native maximize button is enabled or not.
   * If resizable is set to false, this setting is ignored.
   *
   * #### Platform-specific
   *
   * - **macOS:** Disables the "zoom" button in the window titlebar, which is also used to enter fullscreen mode.
   * - **Linux / iOS / Android:** Unsupported.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setMaximizable(false);
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async setMaximizable(maximizable) {
    return invoke("plugin:window|set_maximizable", {
      label: this.label,
      value: maximizable
    });
  }
  /**
   * Sets whether the window's native minimize button is enabled or not.
   *
   * #### Platform-specific
   *
   * - **Linux / iOS / Android:** Unsupported.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setMinimizable(false);
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async setMinimizable(minimizable) {
    return invoke("plugin:window|set_minimizable", {
      label: this.label,
      value: minimizable
    });
  }
  /**
   * Sets whether the window's native close button is enabled or not.
   *
   * #### Platform-specific
   *
   * - **Linux:** GTK+ will do its best to convince the window manager not to show a close button. Depending on the system, this function may not have any effect when called on a window that is already visible
   * - **iOS / Android:** Unsupported.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setClosable(false);
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async setClosable(closable) {
    return invoke("plugin:window|set_closable", {
      label: this.label,
      value: closable
    });
  }
  /**
   * Sets the window title.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setTitle('Tauri');
   * ```
   *
   * @param title The new title
   * @returns A promise indicating the success or failure of the operation.
   */
  async setTitle(title) {
    return invoke("plugin:window|set_title", {
      label: this.label,
      value: title
    });
  }
  /**
   * Maximizes the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().maximize();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async maximize() {
    return invoke("plugin:window|maximize", {
      label: this.label
    });
  }
  /**
   * Unmaximizes the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().unmaximize();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async unmaximize() {
    return invoke("plugin:window|unmaximize", {
      label: this.label
    });
  }
  /**
   * Toggles the window maximized state.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().toggleMaximize();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async toggleMaximize() {
    return invoke("plugin:window|toggle_maximize", {
      label: this.label
    });
  }
  /**
   * Minimizes the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().minimize();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async minimize() {
    return invoke("plugin:window|minimize", {
      label: this.label
    });
  }
  /**
   * Unminimizes the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().unminimize();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async unminimize() {
    return invoke("plugin:window|unminimize", {
      label: this.label
    });
  }
  /**
   * Sets the window visibility to true.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().show();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async show() {
    return invoke("plugin:window|show", {
      label: this.label
    });
  }
  /**
   * Sets the window visibility to false.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().hide();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async hide() {
    return invoke("plugin:window|hide", {
      label: this.label
    });
  }
  /**
   * Closes the window.
   *
   * Note this emits a closeRequested event so you can intercept it. To force window close, use {@link Window.destroy}.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().close();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async close() {
    return invoke("plugin:window|close", {
      label: this.label
    });
  }
  /**
   * Destroys the window. Behaves like {@link Window.close} but forces the window close instead of emitting a closeRequested event.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().destroy();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async destroy() {
    return invoke("plugin:window|destroy", {
      label: this.label
    });
  }
  /**
   * Whether the window should have borders and bars.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setDecorations(false);
   * ```
   *
   * @param decorations Whether the window should have borders and bars.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setDecorations(decorations) {
    return invoke("plugin:window|set_decorations", {
      label: this.label,
      value: decorations
    });
  }
  /**
   * Whether or not the window should have shadow.
   *
   * #### Platform-specific
   *
   * - **Windows:**
   *   - `false` has no effect on decorated window, shadows are always ON.
   *   - `true` will make undecorated window have a 1px white border,
   * and on Windows 11, it will have a rounded corners.
   * - **Linux:** Unsupported.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setShadow(false);
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async setShadow(enable) {
    return invoke("plugin:window|set_shadow", {
      label: this.label,
      value: enable
    });
  }
  /**
   * Set window effects.
   */
  async setEffects(effects) {
    return invoke("plugin:window|set_effects", {
      label: this.label,
      value: effects
    });
  }
  /**
   * Clear any applied effects if possible.
   */
  async clearEffects() {
    return invoke("plugin:window|set_effects", {
      label: this.label,
      value: null
    });
  }
  /**
   * Whether the window should always be on top of other windows.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setAlwaysOnTop(true);
   * ```
   *
   * @param alwaysOnTop Whether the window should always be on top of other windows or not.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setAlwaysOnTop(alwaysOnTop) {
    return invoke("plugin:window|set_always_on_top", {
      label: this.label,
      value: alwaysOnTop
    });
  }
  /**
   * Whether the window should always be below other windows.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setAlwaysOnBottom(true);
   * ```
   *
   * @param alwaysOnBottom Whether the window should always be below other windows or not.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setAlwaysOnBottom(alwaysOnBottom) {
    return invoke("plugin:window|set_always_on_bottom", {
      label: this.label,
      value: alwaysOnBottom
    });
  }
  /**
   * Prevents the window contents from being captured by other apps.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setContentProtected(true);
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async setContentProtected(protected_) {
    return invoke("plugin:window|set_content_protected", {
      label: this.label,
      value: protected_
    });
  }
  /**
   * Resizes the window with a new inner size.
   * @example
   * ```typescript
   * import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
   * await getCurrentWindow().setSize(new LogicalSize(600, 500));
   * ```
   *
   * @param size The logical or physical inner size.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setSize(size) {
    return invoke("plugin:window|set_size", {
      label: this.label,
      value: size instanceof Size ? size : new Size(size)
    });
  }
  /**
   * Sets the window minimum inner size. If the `size` argument is not provided, the constraint is unset.
   * @example
   * ```typescript
   * import { getCurrentWindow, PhysicalSize } from '@tauri-apps/api/window';
   * await getCurrentWindow().setMinSize(new PhysicalSize(600, 500));
   * ```
   *
   * @param size The logical or physical inner size, or `null` to unset the constraint.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setMinSize(size) {
    return invoke("plugin:window|set_min_size", {
      label: this.label,
      value: size instanceof Size ? size : size ? new Size(size) : null
    });
  }
  /**
   * Sets the window maximum inner size. If the `size` argument is undefined, the constraint is unset.
   * @example
   * ```typescript
   * import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
   * await getCurrentWindow().setMaxSize(new LogicalSize(600, 500));
   * ```
   *
   * @param size The logical or physical inner size, or `null` to unset the constraint.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setMaxSize(size) {
    return invoke("plugin:window|set_max_size", {
      label: this.label,
      value: size instanceof Size ? size : size ? new Size(size) : null
    });
  }
  /**
   * Sets the window inner size constraints.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setSizeConstraints({ minWidth: 300 });
   * ```
   *
   * @param constraints The logical or physical inner size, or `null` to unset the constraint.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setSizeConstraints(constraints) {
    function logical(pixel) {
      return pixel ? { Logical: pixel } : null;
    }
    return invoke("plugin:window|set_size_constraints", {
      label: this.label,
      value: {
        minWidth: logical(constraints === null || constraints === void 0 ? void 0 : constraints.minWidth),
        minHeight: logical(constraints === null || constraints === void 0 ? void 0 : constraints.minHeight),
        maxWidth: logical(constraints === null || constraints === void 0 ? void 0 : constraints.maxWidth),
        maxHeight: logical(constraints === null || constraints === void 0 ? void 0 : constraints.maxHeight)
      }
    });
  }
  /**
   * Sets the window outer position.
   * @example
   * ```typescript
   * import { getCurrentWindow, LogicalPosition } from '@tauri-apps/api/window';
   * await getCurrentWindow().setPosition(new LogicalPosition(600, 500));
   * ```
   *
   * @param position The new position, in logical or physical pixels.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setPosition(position) {
    return invoke("plugin:window|set_position", {
      label: this.label,
      value: position instanceof Position ? position : new Position(position)
    });
  }
  /**
   * Sets the window fullscreen state.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setFullscreen(true);
   * ```
   *
   * @param fullscreen Whether the window should go to fullscreen or not.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setFullscreen(fullscreen) {
    return invoke("plugin:window|set_fullscreen", {
      label: this.label,
      value: fullscreen
    });
  }
  /**
   * On macOS, Toggles a fullscreen mode that doesn’t require a new macOS space. Returns a boolean indicating whether the transition was successful (this won’t work if the window was already in the native fullscreen).
   * This is how fullscreen used to work on macOS in versions before Lion. And allows the user to have a fullscreen window without using another space or taking control over the entire monitor.
   *
   * On other platforms, this is the same as {@link Window.setFullscreen}.
   *
   * @param fullscreen Whether the window should go to simple fullscreen or not.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setSimpleFullscreen(fullscreen) {
    return invoke("plugin:window|set_simple_fullscreen", {
      label: this.label,
      value: fullscreen
    });
  }
  /**
   * Bring the window to front and focus.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setFocus();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async setFocus() {
    return invoke("plugin:window|set_focus", {
      label: this.label
    });
  }
  /**
   * Sets whether the window can be focused.
   *
   * #### Platform-specific
   *
   * - **macOS**: If the window is already focused, it is not possible to unfocus it after calling `set_focusable(false)`.
   *   In this case, you might consider calling {@link Window.setFocus} but it will move the window to the back i.e. at the bottom in terms of z-order.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setFocusable(true);
   * ```
   *
   * @param focusable Whether the window can be focused.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setFocusable(focusable) {
    return invoke("plugin:window|set_focusable", {
      label: this.label,
      value: focusable
    });
  }
  /**
   * Sets the window icon.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setIcon('/tauri/awesome.png');
   * ```
   *
   * Note that you may need the `image-ico` or `image-png` Cargo features to use this API.
   * To enable it, change your Cargo.toml file:
   * ```toml
   * [dependencies]
   * tauri = { version = "...", features = ["...", "image-png"] }
   * ```
   *
   * @param icon Icon bytes or path to the icon file.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setIcon(icon) {
    return invoke("plugin:window|set_icon", {
      label: this.label,
      value: transformImage(icon)
    });
  }
  /**
   * Whether the window icon should be hidden from the taskbar or not.
   *
   * #### Platform-specific
   *
   * - **macOS:** Unsupported.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setSkipTaskbar(true);
   * ```
   *
   * @param skip true to hide window icon, false to show it.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setSkipTaskbar(skip) {
    return invoke("plugin:window|set_skip_taskbar", {
      label: this.label,
      value: skip
    });
  }
  /**
   * Grabs the cursor, preventing it from leaving the window.
   *
   * There's no guarantee that the cursor will be hidden. You should
   * hide it by yourself if you want so.
   *
   * #### Platform-specific
   *
   * - **Linux:** Unsupported.
   * - **macOS:** This locks the cursor in a fixed location, which looks visually awkward.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setCursorGrab(true);
   * ```
   *
   * @param grab `true` to grab the cursor icon, `false` to release it.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setCursorGrab(grab) {
    return invoke("plugin:window|set_cursor_grab", {
      label: this.label,
      value: grab
    });
  }
  /**
   * Modifies the cursor's visibility.
   *
   * #### Platform-specific
   *
   * - **Windows:** The cursor is only hidden within the confines of the window.
   * - **macOS:** The cursor is hidden as long as the window has input focus, even if the cursor is
   *   outside of the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setCursorVisible(false);
   * ```
   *
   * @param visible If `false`, this will hide the cursor. If `true`, this will show the cursor.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setCursorVisible(visible) {
    return invoke("plugin:window|set_cursor_visible", {
      label: this.label,
      value: visible
    });
  }
  /**
   * Modifies the cursor icon of the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setCursorIcon('help');
   * ```
   *
   * @param icon The new cursor icon.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setCursorIcon(icon) {
    return invoke("plugin:window|set_cursor_icon", {
      label: this.label,
      value: icon
    });
  }
  /**
   * Sets the window background color.
   *
   * #### Platform-specific:
   *
   * - **Windows:** alpha channel is ignored.
   * - **iOS / Android:** Unsupported.
   *
   * @returns A promise indicating the success or failure of the operation.
   *
   * @since 2.1.0
   */
  async setBackgroundColor(color) {
    return invoke("plugin:window|set_background_color", { color });
  }
  /**
   * Changes the position of the cursor in window coordinates.
   * @example
   * ```typescript
   * import { getCurrentWindow, LogicalPosition } from '@tauri-apps/api/window';
   * await getCurrentWindow().setCursorPosition(new LogicalPosition(600, 300));
   * ```
   *
   * @param position The new cursor position.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setCursorPosition(position) {
    return invoke("plugin:window|set_cursor_position", {
      label: this.label,
      value: position instanceof Position ? position : new Position(position)
    });
  }
  /**
   * Changes the cursor events behavior.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setIgnoreCursorEvents(true);
   * ```
   *
   * @param ignore `true` to ignore the cursor events; `false` to process them as usual.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setIgnoreCursorEvents(ignore) {
    return invoke("plugin:window|set_ignore_cursor_events", {
      label: this.label,
      value: ignore
    });
  }
  /**
   * Starts dragging the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().startDragging();
   * ```
   *
   * @return A promise indicating the success or failure of the operation.
   */
  async startDragging() {
    return invoke("plugin:window|start_dragging", {
      label: this.label
    });
  }
  /**
   * Starts resize-dragging the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().startResizeDragging();
   * ```
   *
   * @return A promise indicating the success or failure of the operation.
   */
  async startResizeDragging(direction) {
    return invoke("plugin:window|start_resize_dragging", {
      label: this.label,
      value: direction
    });
  }
  /**
   * Sets the badge count. It is app wide and not specific to this window.
   *
   * #### Platform-specific
   *
   * - **Windows**: Unsupported. Use @{linkcode Window.setOverlayIcon} instead.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setBadgeCount(5);
   * ```
   *
   * @param count The badge count. Use `undefined` to remove the badge.
   * @return A promise indicating the success or failure of the operation.
   */
  async setBadgeCount(count) {
    return invoke("plugin:window|set_badge_count", {
      label: this.label,
      value: count
    });
  }
  /**
   * Sets the badge cont **macOS only**.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setBadgeLabel("Hello");
   * ```
   *
   * @param label The badge label. Use `undefined` to remove the badge.
   * @return A promise indicating the success or failure of the operation.
   */
  async setBadgeLabel(label) {
    return invoke("plugin:window|set_badge_label", {
      label: this.label,
      value: label
    });
  }
  /**
   * Sets the overlay icon. **Windows only**
   * The overlay icon can be set for every window.
   *
   *
   * Note that you may need the `image-ico` or `image-png` Cargo features to use this API.
   * To enable it, change your Cargo.toml file:
   *
   * ```toml
   * [dependencies]
   * tauri = { version = "...", features = ["...", "image-png"] }
   * ```
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setOverlayIcon("/tauri/awesome.png");
   * ```
   *
   * @param icon Icon bytes or path to the icon file. Use `undefined` to remove the overlay icon.
   * @return A promise indicating the success or failure of the operation.
   */
  async setOverlayIcon(icon) {
    return invoke("plugin:window|set_overlay_icon", {
      label: this.label,
      value: icon ? transformImage(icon) : void 0
    });
  }
  /**
   * Sets the taskbar progress state.
   *
   * #### Platform-specific
   *
   * - **Linux / macOS**: Progress bar is app-wide and not specific to this window.
   * - **Linux**: Only supported desktop environments with `libunity` (e.g. GNOME).
   *
   * @example
   * ```typescript
   * import { getCurrentWindow, ProgressBarStatus } from '@tauri-apps/api/window';
   * await getCurrentWindow().setProgressBar({
   *   status: ProgressBarStatus.Normal,
   *   progress: 50,
   * });
   * ```
   *
   * @return A promise indicating the success or failure of the operation.
   */
  async setProgressBar(state) {
    return invoke("plugin:window|set_progress_bar", {
      label: this.label,
      value: state
    });
  }
  /**
   * Sets whether the window should be visible on all workspaces or virtual desktops.
   *
   * #### Platform-specific
   *
   * - **Windows / iOS / Android:** Unsupported.
   *
   * @since 2.0.0
   */
  async setVisibleOnAllWorkspaces(visible) {
    return invoke("plugin:window|set_visible_on_all_workspaces", {
      label: this.label,
      value: visible
    });
  }
  /**
   * Sets the title bar style. **macOS only**.
   *
   * @since 2.0.0
   */
  async setTitleBarStyle(style) {
    return invoke("plugin:window|set_title_bar_style", {
      label: this.label,
      value: style
    });
  }
  /**
   * Set window theme, pass in `null` or `undefined` to follow system theme
   *
   * #### Platform-specific
   *
   * - **Linux / macOS**: Theme is app-wide and not specific to this window.
   * - **iOS / Android:** Unsupported.
   *
   * @since 2.0.0
   */
  async setTheme(theme) {
    return invoke("plugin:window|set_theme", {
      label: this.label,
      value: theme
    });
  }
  // Listeners
  /**
   * Listen to window resize.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from "@tauri-apps/api/window";
   * const unlisten = await getCurrentWindow().onResized(({ payload: size }) => {
   *  console.log('Window resized', size);
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async onResized(handler) {
    return this.listen(TauriEvent.WINDOW_RESIZED, (e) => {
      e.payload = new PhysicalSize(e.payload);
      handler(e);
    });
  }
  /**
   * Listen to window move.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from "@tauri-apps/api/window";
   * const unlisten = await getCurrentWindow().onMoved(({ payload: position }) => {
   *  console.log('Window moved', position);
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async onMoved(handler) {
    return this.listen(TauriEvent.WINDOW_MOVED, (e) => {
      e.payload = new PhysicalPosition(e.payload);
      handler(e);
    });
  }
  /**
   * Listen to window close requested. Emitted when the user requests to closes the window.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from "@tauri-apps/api/window";
   * import { confirm } from '@tauri-apps/api/dialog';
   * const unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
   *   const confirmed = await confirm('Are you sure?');
   *   if (!confirmed) {
   *     // user did not confirm closing the window; let's prevent it
   *     event.preventDefault();
   *   }
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async onCloseRequested(handler) {
    return this.listen(TauriEvent.WINDOW_CLOSE_REQUESTED, async (event) => {
      const evt = new CloseRequestedEvent(event);
      await handler(evt);
      if (!evt.isPreventDefault()) {
        await this.destroy();
      }
    });
  }
  /**
   * Listen to a file drop event.
   * The listener is triggered when the user hovers the selected files on the webview,
   * drops the files or cancels the operation.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from "@tauri-apps/api/webview";
   * const unlisten = await getCurrentWindow().onDragDropEvent((event) => {
   *  if (event.payload.type === 'over') {
   *    console.log('User hovering', event.payload.position);
   *  } else if (event.payload.type === 'drop') {
   *    console.log('User dropped', event.payload.paths);
   *  } else {
   *    console.log('File drop cancelled');
   *  }
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async onDragDropEvent(handler) {
    const unlistenDrag = await this.listen(TauriEvent.DRAG_ENTER, (event) => {
      handler({
        ...event,
        payload: {
          type: "enter",
          paths: event.payload.paths,
          position: new PhysicalPosition(event.payload.position)
        }
      });
    });
    const unlistenDragOver = await this.listen(TauriEvent.DRAG_OVER, (event) => {
      handler({
        ...event,
        payload: {
          type: "over",
          position: new PhysicalPosition(event.payload.position)
        }
      });
    });
    const unlistenDrop = await this.listen(TauriEvent.DRAG_DROP, (event) => {
      handler({
        ...event,
        payload: {
          type: "drop",
          paths: event.payload.paths,
          position: new PhysicalPosition(event.payload.position)
        }
      });
    });
    const unlistenCancel = await this.listen(TauriEvent.DRAG_LEAVE, (event) => {
      handler({ ...event, payload: { type: "leave" } });
    });
    return () => {
      unlistenDrag();
      unlistenDrop();
      unlistenDragOver();
      unlistenCancel();
    };
  }
  /**
   * Listen to window focus change.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from "@tauri-apps/api/window";
   * const unlisten = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
   *  console.log('Focus changed, window is focused? ' + focused);
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async onFocusChanged(handler) {
    const unlistenFocus = await this.listen(TauriEvent.WINDOW_FOCUS, (event) => {
      handler({ ...event, payload: true });
    });
    const unlistenBlur = await this.listen(TauriEvent.WINDOW_BLUR, (event) => {
      handler({ ...event, payload: false });
    });
    return () => {
      unlistenFocus();
      unlistenBlur();
    };
  }
  /**
   * Listen to window scale change. Emitted when the window's scale factor has changed.
   * The following user actions can cause DPI changes:
   * - Changing the display's resolution.
   * - Changing the display's scale factor (e.g. in Control Panel on Windows).
   * - Moving the window to a display with a different scale factor.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from "@tauri-apps/api/window";
   * const unlisten = await getCurrentWindow().onScaleChanged(({ payload }) => {
   *  console.log('Scale changed', payload.scaleFactor, payload.size);
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async onScaleChanged(handler) {
    return this.listen(TauriEvent.WINDOW_SCALE_FACTOR_CHANGED, handler);
  }
  /**
   * Listen to the system theme change.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from "@tauri-apps/api/window";
   * const unlisten = await getCurrentWindow().onThemeChanged(({ payload: theme }) => {
   *  console.log('New theme: ' + theme);
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async onThemeChanged(handler) {
    return this.listen(TauriEvent.WINDOW_THEME_CHANGED, handler);
  }
};
var BackgroundThrottlingPolicy;
(function(BackgroundThrottlingPolicy2) {
  BackgroundThrottlingPolicy2["Disabled"] = "disabled";
  BackgroundThrottlingPolicy2["Throttle"] = "throttle";
  BackgroundThrottlingPolicy2["Suspend"] = "suspend";
})(BackgroundThrottlingPolicy || (BackgroundThrottlingPolicy = {}));
var ScrollBarStyle;
(function(ScrollBarStyle2) {
  ScrollBarStyle2["Default"] = "default";
  ScrollBarStyle2["FluentOverlay"] = "fluentOverlay";
})(ScrollBarStyle || (ScrollBarStyle = {}));
var Effect;
(function(Effect2) {
  Effect2["AppearanceBased"] = "appearanceBased";
  Effect2["Light"] = "light";
  Effect2["Dark"] = "dark";
  Effect2["MediumLight"] = "mediumLight";
  Effect2["UltraDark"] = "ultraDark";
  Effect2["Titlebar"] = "titlebar";
  Effect2["Selection"] = "selection";
  Effect2["Menu"] = "menu";
  Effect2["Popover"] = "popover";
  Effect2["Sidebar"] = "sidebar";
  Effect2["HeaderView"] = "headerView";
  Effect2["Sheet"] = "sheet";
  Effect2["WindowBackground"] = "windowBackground";
  Effect2["HudWindow"] = "hudWindow";
  Effect2["FullScreenUI"] = "fullScreenUI";
  Effect2["Tooltip"] = "tooltip";
  Effect2["ContentBackground"] = "contentBackground";
  Effect2["UnderWindowBackground"] = "underWindowBackground";
  Effect2["UnderPageBackground"] = "underPageBackground";
  Effect2["Mica"] = "mica";
  Effect2["Blur"] = "blur";
  Effect2["Acrylic"] = "acrylic";
  Effect2["Tabbed"] = "tabbed";
  Effect2["TabbedDark"] = "tabbedDark";
  Effect2["TabbedLight"] = "tabbedLight";
})(Effect || (Effect = {}));
var EffectState;
(function(EffectState2) {
  EffectState2["FollowsWindowActiveState"] = "followsWindowActiveState";
  EffectState2["Active"] = "active";
  EffectState2["Inactive"] = "inactive";
})(EffectState || (EffectState = {}));

// ../../node_modules/.pnpm/@tauri-apps+api@2.11.1/node_modules/@tauri-apps/api/webview.js
function getCurrentWebview() {
  return new Webview(getCurrentWindow(), window.__TAURI_INTERNALS__.metadata.currentWebview.label, {
    // @ts-expect-error `skip` is not defined in the public API but it is handled by the constructor
    skip: true
  });
}
async function getAllWebviews() {
  return invoke("plugin:webview|get_all_webviews").then((webviews) => webviews.map((w) => new Webview(new Window(w.windowLabel, {
    // @ts-expect-error `skip` is not defined in the public API but it is handled by the constructor
    skip: true
  }), w.label, {
    // @ts-expect-error `skip` is not defined in the public API but it is handled by the constructor
    skip: true
  })));
}
var localTauriEvents2 = ["tauri://created", "tauri://error"];
var Webview = class {
  /**
   * Creates a new Webview.
   * @example
   * ```typescript
   * import { Window } from '@tauri-apps/api/window'
   * import { Webview } from '@tauri-apps/api/webview'
   * const appWindow = new Window('my-label')
   *
   * appWindow.once('tauri://created', async function() {
   *   const webview = new Webview(appWindow, 'my-label', {
   *     url: 'https://github.com/tauri-apps/tauri',
   *
   *     // create a webview with specific logical position and size
   *     x: 0,
   *     y: 0,
   *     width: 800,
   *     height: 600,
   *   });
   *
   *   webview.once('tauri://created', function () {
   *     // webview successfully created
   *   });
   *   webview.once('tauri://error', function (e) {
   *     // an error happened creating the webview
   *   });
   * });
   * ```
   *
   * @param window the window to add this webview to.
   * @param label The unique webview label. Must be alphanumeric: `a-zA-Z-/:_`.
   * @returns The {@link Webview} instance to communicate with the webview.
   */
  constructor(window2, label, options) {
    this.window = window2;
    this.label = label;
    this.listeners = /* @__PURE__ */ Object.create(null);
    if (!(options === null || options === void 0 ? void 0 : options.skip)) {
      invoke("plugin:webview|create_webview", {
        windowLabel: window2.label,
        options: {
          ...options,
          label
        }
      }).then(async () => this.emit("tauri://created")).catch(async (e) => this.emit("tauri://error", e));
    }
  }
  /**
   * Gets the Webview for the webview associated with the given label.
   * @example
   * ```typescript
   * import { Webview } from '@tauri-apps/api/webview';
   * const mainWebview = Webview.getByLabel('main');
   * ```
   *
   * @param label The webview label.
   * @returns The Webview instance to communicate with the webview or null if the webview doesn't exist.
   */
  static async getByLabel(label) {
    var _a;
    return (_a = (await getAllWebviews()).find((w) => w.label === label)) !== null && _a !== void 0 ? _a : null;
  }
  /**
   * Get an instance of `Webview` for the current webview.
   */
  static getCurrent() {
    return getCurrentWebview();
  }
  /**
   * Gets a list of instances of `Webview` for all available webviews.
   */
  static async getAll() {
    return getAllWebviews();
  }
  /**
   * Listen to an emitted event on this webview.
   *
   * @example
   * ```typescript
   * import { getCurrentWebview } from '@tauri-apps/api/webview';
   * const unlisten = await getCurrentWebview().listen<string>('state-changed', (event) => {
   *   console.log(`Got error: ${payload}`);
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @param event Event name. Must include only alphanumeric characters, `-`, `/`, `:` and `_`.
   * @param handler Event handler.
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async listen(event, handler) {
    if (this._handleTauriEvent(event, handler)) {
      return () => {
        const listeners = this.listeners[event];
        listeners.splice(listeners.indexOf(handler), 1);
      };
    }
    return listen(event, handler, {
      target: { kind: "Webview", label: this.label }
    });
  }
  /**
   * Listen to an emitted event on this webview only once.
   *
   * @example
   * ```typescript
   * import { getCurrentWebview } from '@tauri-apps/api/webview';
   * const unlisten = await getCurrent().once<null>('initialized', (event) => {
   *   console.log(`Webview initialized!`);
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @param event Event name. Must include only alphanumeric characters, `-`, `/`, `:` and `_`.
   * @param handler Event handler.
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async once(event, handler) {
    if (this._handleTauriEvent(event, handler)) {
      return () => {
        const listeners = this.listeners[event];
        listeners.splice(listeners.indexOf(handler), 1);
      };
    }
    return once(event, handler, {
      target: { kind: "Webview", label: this.label }
    });
  }
  /**
   * Emits an event to all {@link EventTarget|targets}.
   *
   * @example
   * ```typescript
   * import { getCurrentWebview } from '@tauri-apps/api/webview';
   * await getCurrentWebview().emit('webview-loaded', { loggedIn: true, token: 'authToken' });
   * ```
   *
   * @param event Event name. Must include only alphanumeric characters, `-`, `/`, `:` and `_`.
   * @param payload Event payload.
   */
  async emit(event, payload) {
    if (localTauriEvents2.includes(event)) {
      for (const handler of this.listeners[event] || []) {
        handler({
          event,
          id: -1,
          payload
        });
      }
      return;
    }
    return emit(event, payload);
  }
  /**
   * Emits an event to all {@link EventTarget|targets} matching the given target.
   *
   * @example
   * ```typescript
   * import { getCurrentWebview } from '@tauri-apps/api/webview';
   * await getCurrentWebview().emitTo('main', 'webview-loaded', { loggedIn: true, token: 'authToken' });
   * ```
   *
   * @param target Label of the target Window/Webview/WebviewWindow or raw {@link EventTarget} object.
   * @param event Event name. Must include only alphanumeric characters, `-`, `/`, `:` and `_`.
   * @param payload Event payload.
   */
  async emitTo(target, event, payload) {
    if (localTauriEvents2.includes(event)) {
      for (const handler of this.listeners[event] || []) {
        handler({
          event,
          id: -1,
          payload
        });
      }
      return;
    }
    return emitTo(target, event, payload);
  }
  /** @ignore */
  _handleTauriEvent(event, handler) {
    if (localTauriEvents2.includes(event)) {
      if (!(event in this.listeners)) {
        this.listeners[event] = [handler];
      } else {
        this.listeners[event].push(handler);
      }
      return true;
    }
    return false;
  }
  // Getters
  /**
   * The position of the top-left hand corner of the webview's client area relative to the top-left hand corner of the desktop.
   * @example
   * ```typescript
   * import { getCurrentWebview } from '@tauri-apps/api/webview';
   * const position = await getCurrentWebview().position();
   * ```
   *
   * @returns The webview's position.
   */
  async position() {
    return invoke("plugin:webview|webview_position", {
      label: this.label
    }).then((p) => new PhysicalPosition(p));
  }
  /**
   * The physical size of the webview's client area.
   * The client area is the content of the webview, excluding the title bar and borders.
   * @example
   * ```typescript
   * import { getCurrentWebview } from '@tauri-apps/api/webview';
   * const size = await getCurrentWebview().size();
   * ```
   *
   * @returns The webview's size.
   */
  async size() {
    return invoke("plugin:webview|webview_size", {
      label: this.label
    }).then((s) => new PhysicalSize(s));
  }
  // Setters
  /**
   * Closes the webview.
   * @example
   * ```typescript
   * import { getCurrentWebview } from '@tauri-apps/api/webview';
   * await getCurrentWebview().close();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async close() {
    return invoke("plugin:webview|webview_close", {
      label: this.label
    });
  }
  /**
   * Resizes the webview.
   * @example
   * ```typescript
   * import { getCurrent, LogicalSize } from '@tauri-apps/api/webview';
   * await getCurrentWebview().setSize(new LogicalSize(600, 500));
   * ```
   *
   * @param size The logical or physical size.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setSize(size) {
    return invoke("plugin:webview|set_webview_size", {
      label: this.label,
      value: size instanceof Size ? size : new Size(size)
    });
  }
  /**
   * Sets the webview position.
   * @example
   * ```typescript
   * import { getCurrent, LogicalPosition } from '@tauri-apps/api/webview';
   * await getCurrentWebview().setPosition(new LogicalPosition(600, 500));
   * ```
   *
   * @param position The new position, in logical or physical pixels.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setPosition(position) {
    return invoke("plugin:webview|set_webview_position", {
      label: this.label,
      value: position instanceof Position ? position : new Position(position)
    });
  }
  /**
   * Bring the webview to front and focus.
   * @example
   * ```typescript
   * import { getCurrentWebview } from '@tauri-apps/api/webview';
   * await getCurrentWebview().setFocus();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async setFocus() {
    return invoke("plugin:webview|set_webview_focus", {
      label: this.label
    });
  }
  /**
   * Sets whether the webview should automatically grow and shrink its size and position when the parent window resizes.
   * @example
   * ```typescript
   * import { getCurrentWebview } from '@tauri-apps/api/webview';
   * await getCurrentWebview().setAutoResize(true);
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async setAutoResize(autoResize) {
    return invoke("plugin:webview|set_webview_auto_resize", {
      label: this.label,
      value: autoResize
    });
  }
  /**
   * Hide the webview.
   * @example
   * ```typescript
   * import { getCurrentWebview } from '@tauri-apps/api/webview';
   * await getCurrentWebview().hide();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async hide() {
    return invoke("plugin:webview|webview_hide", {
      label: this.label
    });
  }
  /**
   * Show the webview.
   * @example
   * ```typescript
   * import { getCurrentWebview } from '@tauri-apps/api/webview';
   * await getCurrentWebview().show();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async show() {
    return invoke("plugin:webview|webview_show", {
      label: this.label
    });
  }
  /**
   * Set webview zoom level.
   * @example
   * ```typescript
   * import { getCurrentWebview } from '@tauri-apps/api/webview';
   * await getCurrentWebview().setZoom(1.5);
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async setZoom(scaleFactor) {
    return invoke("plugin:webview|set_webview_zoom", {
      label: this.label,
      value: scaleFactor
    });
  }
  /**
   * Moves this webview to the given label.
   * @example
   * ```typescript
   * import { getCurrentWebview } from '@tauri-apps/api/webview';
   * await getCurrentWebview().reparent('other-window');
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async reparent(window2) {
    return invoke("plugin:webview|reparent", {
      label: this.label,
      window: typeof window2 === "string" ? window2 : window2.label
    });
  }
  /**
   * Clears all browsing data for this webview.
   * @example
   * ```typescript
   * import { getCurrentWebview } from '@tauri-apps/api/webview';
   * await getCurrentWebview().clearAllBrowsingData();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async clearAllBrowsingData() {
    return invoke("plugin:webview|clear_all_browsing_data");
  }
  /**
   * Specify the webview background color.
   *
   * #### Platfrom-specific:
   *
   * - **macOS / iOS**: Not implemented.
   * - **Windows**:
   *   - On Windows 7, transparency is not supported and the alpha value will be ignored.
   *   - On Windows higher than 7: translucent colors are not supported so any alpha value other than `0` will be replaced by `255`
   *
   * @returns A promise indicating the success or failure of the operation.
   *
   * @since 2.1.0
   */
  async setBackgroundColor(color) {
    return invoke("plugin:webview|set_webview_background_color", { color });
  }
  // Listeners
  /**
   * Listen to a file drop event.
   * The listener is triggered when the user hovers the selected files on the webview,
   * drops the files or cancels the operation.
   *
   * @example
   * ```typescript
   * import { getCurrentWebview } from "@tauri-apps/api/webview";
   * const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
   *  if (event.payload.type === 'over') {
   *    console.log('User hovering', event.payload.position);
   *  } else if (event.payload.type === 'drop') {
   *    console.log('User dropped', event.payload.paths);
   *  } else {
   *    console.log('File drop cancelled');
   *  }
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * When the debugger panel is open, the drop position of this event may be inaccurate due to a known limitation.
   * To retrieve the correct drop position, please detach the debugger.
   *
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async onDragDropEvent(handler) {
    const unlistenDragEnter = await this.listen(TauriEvent.DRAG_ENTER, (event) => {
      handler({
        ...event,
        payload: {
          type: "enter",
          paths: event.payload.paths,
          position: new PhysicalPosition(event.payload.position)
        }
      });
    });
    const unlistenDragOver = await this.listen(TauriEvent.DRAG_OVER, (event) => {
      handler({
        ...event,
        payload: {
          type: "over",
          position: new PhysicalPosition(event.payload.position)
        }
      });
    });
    const unlistenDragDrop = await this.listen(TauriEvent.DRAG_DROP, (event) => {
      handler({
        ...event,
        payload: {
          type: "drop",
          paths: event.payload.paths,
          position: new PhysicalPosition(event.payload.position)
        }
      });
    });
    const unlistenDragLeave = await this.listen(TauriEvent.DRAG_LEAVE, (event) => {
      handler({ ...event, payload: { type: "leave" } });
    });
    return () => {
      unlistenDragEnter();
      unlistenDragDrop();
      unlistenDragOver();
      unlistenDragLeave();
    };
  }
};

// ../../node_modules/.pnpm/@tauri-apps+api@2.11.1/node_modules/@tauri-apps/api/webviewWindow.js
function getCurrentWebviewWindow() {
  const webview = getCurrentWebview();
  return new WebviewWindow(webview.label, { skip: true });
}
async function getAllWebviewWindows() {
  return invoke("plugin:window|get_all_windows").then((windows) => windows.map((w) => new WebviewWindow(w, {
    // @ts-expect-error `skip` is not defined in the public API but it is handled by the constructor
    skip: true
  })));
}
var WebviewWindow = class _WebviewWindow {
  /**
   * Creates a new {@link Window} hosting a {@link Webview}.
   * @example
   * ```typescript
   * import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
   * const webview = new WebviewWindow('my-label', {
   *   url: 'https://github.com/tauri-apps/tauri'
   * });
   * webview.once('tauri://created', function () {
   *  // webview successfully created
   * });
   * webview.once('tauri://error', function (e) {
   *  // an error happened creating the webview
   * });
   * ```
   *
   * @param label The unique webview label. Must be alphanumeric: `a-zA-Z-/:_`.
   * @returns The {@link WebviewWindow} instance to communicate with the window and webview.
   */
  constructor(label, options = {}) {
    var _a;
    this.label = label;
    this.listeners = /* @__PURE__ */ Object.create(null);
    if (!(options === null || options === void 0 ? void 0 : options.skip)) {
      invoke("plugin:webview|create_webview_window", {
        options: {
          ...options,
          parent: typeof options.parent === "string" ? options.parent : (_a = options.parent) === null || _a === void 0 ? void 0 : _a.label,
          label
        }
      }).then(async () => this.emit("tauri://created")).catch(async (e) => this.emit("tauri://error", e));
    }
  }
  /**
   * Gets the Webview for the webview associated with the given label.
   * @example
   * ```typescript
   * import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
   * const mainWebview = WebviewWindow.getByLabel('main');
   * ```
   *
   * @param label The webview label.
   * @returns The Webview instance to communicate with the webview or null if the webview doesn't exist.
   */
  static async getByLabel(label) {
    var _a;
    const webview = (_a = (await getAllWebviewWindows()).find((w) => w.label === label)) !== null && _a !== void 0 ? _a : null;
    if (webview) {
      return new _WebviewWindow(webview.label, { skip: true });
    }
    return null;
  }
  /**
   * Get an instance of `Webview` for the current webview.
   */
  static getCurrent() {
    return getCurrentWebviewWindow();
  }
  /**
   * Gets a list of instances of `Webview` for all available webviews.
   */
  static async getAll() {
    return getAllWebviewWindows();
  }
  /**
   * Listen to an emitted event on this webview window.
   *
   * @example
   * ```typescript
   * import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
   * const unlisten = await WebviewWindow.getCurrent().listen<string>('state-changed', (event) => {
   *   console.log(`Got error: ${payload}`);
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @param event Event name. Must include only alphanumeric characters, `-`, `/`, `:` and `_`.
   * @param handler Event handler.
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async listen(event, handler) {
    if (this._handleTauriEvent(event, handler)) {
      return () => {
        const listeners = this.listeners[event];
        listeners.splice(listeners.indexOf(handler), 1);
      };
    }
    return listen(event, handler, {
      target: { kind: "WebviewWindow", label: this.label }
    });
  }
  /**
   * Listen to an emitted event on this webview window only once.
   *
   * @example
   * ```typescript
   * import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
   * const unlisten = await WebviewWindow.getCurrent().once<null>('initialized', (event) => {
   *   console.log(`Webview initialized!`);
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @param event Event name. Must include only alphanumeric characters, `-`, `/`, `:` and `_`.
   * @param handler Event handler.
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async once(event, handler) {
    if (this._handleTauriEvent(event, handler)) {
      return () => {
        const listeners = this.listeners[event];
        listeners.splice(listeners.indexOf(handler), 1);
      };
    }
    return once(event, handler, {
      target: { kind: "WebviewWindow", label: this.label }
    });
  }
  /**
   * Set the window and webview background color.
   *
   * #### Platform-specific:
   *
   * - **Android / iOS:** Unsupported for the window layer.
   * - **macOS / iOS**: Not implemented for the webview layer.
   * - **Windows**:
   *   - alpha channel is ignored for the window layer.
   *   - On Windows 7, alpha channel is ignored for the webview layer.
   *   - On Windows 8 and newer, if alpha channel is not `0`, it will be ignored.
   *
   * @returns A promise indicating the success or failure of the operation.
   *
   * @since 2.1.0
   */
  async setBackgroundColor(color) {
    return invoke("plugin:window|set_background_color", { color }).then(() => {
      return invoke("plugin:webview|set_webview_background_color", { color });
    });
  }
};
applyMixins(WebviewWindow, [Window, Webview]);
function applyMixins(baseClass, extendedClasses) {
  (Array.isArray(extendedClasses) ? extendedClasses : [extendedClasses]).forEach((extendedClass) => {
    Object.getOwnPropertyNames(extendedClass.prototype).forEach((name) => {
      var _a;
      if (typeof baseClass.prototype === "object" && baseClass.prototype && name in baseClass.prototype)
        return;
      Object.defineProperty(
        baseClass.prototype,
        name,
        // eslint-disable-next-line
        (_a = Object.getOwnPropertyDescriptor(extendedClass.prototype, name)) !== null && _a !== void 0 ? _a : /* @__PURE__ */ Object.create(null)
      );
    });
  });
}

// ../../node_modules/.pnpm/tauri-plugin-mcp@0.3.1/node_modules/tauri-plugin-mcp/dist-js/index.js
var _elementsWithListeners = /* @__PURE__ */ new WeakSet();
var INTERACTIVE_LISTENER_TYPES = /* @__PURE__ */ new Set([
  "click",
  "dblclick",
  "mousedown",
  "mouseup",
  "pointerdown",
  "pointerup",
  "touchstart",
  "touchend",
  "keydown",
  "keyup",
  "keypress"
]);
if (typeof window !== "undefined" && !window.__TAURI_MCP_LISTENER_PATCH__) {
  let _captureFlag = function(options) {
    if (typeof options === "boolean")
      return options;
    if (options && typeof options === "object")
      return !!options.capture;
    return false;
  };
  const _origAdd = EventTarget.prototype.addEventListener;
  const _origRemove = EventTarget.prototype.removeEventListener;
  const _listenerSets = /* @__PURE__ */ new WeakMap();
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (INTERACTIVE_LISTENER_TYPES.has(type) && this instanceof Element && listener) {
      const key = `${type}|${_captureFlag(options) ? "1" : "0"}`;
      let map = _listenerSets.get(this);
      if (!map) {
        map = /* @__PURE__ */ new Map();
        _listenerSets.set(this, map);
      }
      let set = map.get(key);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        map.set(key, set);
      }
      set.add(listener);
      _elementsWithListeners.add(this);
    }
    return _origAdd.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function(type, listener, options) {
    if (INTERACTIVE_LISTENER_TYPES.has(type) && this instanceof Element && listener) {
      const map = _listenerSets.get(this);
      if (map) {
        const key = `${type}|${_captureFlag(options) ? "1" : "0"}`;
        const set = map.get(key);
        if (set) {
          set.delete(listener);
          if (set.size === 0)
            map.delete(key);
        }
        if (map.size === 0) {
          _elementsWithListeners.delete(this);
          _listenerSets.delete(this);
        }
      }
    }
    return _origRemove.call(this, type, listener, options);
  };
  window.__TAURI_MCP_LISTENER_PATCH__ = true;
}
var domContentUnlistenFunction = null;
var pageMapUnlistenFunction = null;
var localStorageUnlistenFunction = null;
var jsExecutionUnlistenFunction = null;
var elementPositionUnlistenFunction = null;
var sendTextToElementUnlistenFunction = null;
var getPageStateUnlistenFunction = null;
var navigateBackUnlistenFunction = null;
var scrollPageUnlistenFunction = null;
var fillFormUnlistenFunction = null;
var waitForUnlistenFunction = null;
var navigateWebviewUnlistenFunction = null;
var manageZoomUnlistenFunction = null;
var typeIntoFocusedUnlistenFunction = null;
var pressKeyUnlistenFunction = null;
var setFileInputUnlistenFunction = null;
var ipcInvokeUnlistenFunction = null;
var readTextUnlistenFunction = null;
var inspectElementUnlistenFunction = null;
var dispatchPointerUnlistenFunction = null;
var appBridgeUnlistenFunction = null;
function getCorrelationId(payload) {
  if (typeof payload === "object" && payload !== null && typeof payload._correlationId === "string") {
    return payload._correlationId;
  }
  return null;
}
async function emitResponse(baseEventName, correlationId, data) {
  if (correlationId) {
    await emit(`${baseEventName}-${correlationId}`, data);
  } else {
    await emit(baseEventName, data);
  }
}
var _pageMapRefElements = /* @__PURE__ */ new Map();
var _lastFocusedElement = null;
function isTypeable(el) {
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
    return true;
  if (el instanceof HTMLElement && el.isContentEditable)
    return true;
  if (el.hasAttribute("data-lexical-editor") || el.hasAttribute("data-slate-editor"))
    return true;
  if (el.closest("[data-lexical-editor]") || el.closest("[data-slate-editor]"))
    return true;
  return false;
}
if (typeof document !== "undefined") {
  document.addEventListener("focus", (e) => {
    const target = e.target;
    if (target && target instanceof Element && isTypeable(target)) {
      _lastFocusedElement = target;
    }
  }, true);
}
var _previousPageMapFingerprints = /* @__PURE__ */ new Map();
var _previousPageMapMaxRef = 0;
var _handledCorrelationIds = /* @__PURE__ */ new Set();
async function setupPluginListeners() {
  await cleanupPluginListeners();
  const currentWindow = getCurrentWebviewWindow();
  domContentUnlistenFunction = await currentWindow.listen("got-dom-content", handleDomContentRequest);
  pageMapUnlistenFunction = await currentWindow.listen("get-page-map", handleGetPageMapRequest);
  localStorageUnlistenFunction = await currentWindow.listen("get-local-storage", handleLocalStorageRequest);
  jsExecutionUnlistenFunction = await currentWindow.listen("execute-js", handleJsExecutionRequest);
  elementPositionUnlistenFunction = await currentWindow.listen("get-element-position", handleGetElementPositionRequest);
  sendTextToElementUnlistenFunction = await currentWindow.listen("send-text-to-element", handleSendTextToElementRequest);
  getPageStateUnlistenFunction = await currentWindow.listen("get-page-state", handleGetPageStateRequest);
  navigateBackUnlistenFunction = await currentWindow.listen("navigate-back", handleNavigateBackRequest);
  scrollPageUnlistenFunction = await currentWindow.listen("scroll-page", handleScrollPageRequest);
  fillFormUnlistenFunction = await currentWindow.listen("fill-form", handleFillFormRequest);
  waitForUnlistenFunction = await currentWindow.listen("wait-for", handleWaitForRequest);
  navigateWebviewUnlistenFunction = await currentWindow.listen("navigate-webview", handleNavigateWebviewRequest);
  manageZoomUnlistenFunction = await currentWindow.listen("manage-zoom", handleManageZoomRequest);
  typeIntoFocusedUnlistenFunction = await currentWindow.listen("type-into-focused", handleTypeIntoFocusedRequest);
  pressKeyUnlistenFunction = await currentWindow.listen("press-key", handlePressKeyRequest);
  setFileInputUnlistenFunction = await currentWindow.listen("set-file-input", handleSetFileInputRequest);
  ipcInvokeUnlistenFunction = await currentWindow.listen("ipc-invoke", handleIpcInvokeRequest);
  readTextUnlistenFunction = await currentWindow.listen("read-text", handleReadTextRequest);
  inspectElementUnlistenFunction = await currentWindow.listen("inspect-element", handleInspectElementRequest);
  dispatchPointerUnlistenFunction = await currentWindow.listen("dispatch-pointer", handleDispatchPointerRequest);
  appBridgeUnlistenFunction = await currentWindow.listen("app-bridge", handleAppBridgeRequest);
  ensureMcpBridge();
  console.log("TAURI-PLUGIN-MCP: All event listeners are set up on the current window.");
}
async function cleanupPluginListeners() {
  if (domContentUnlistenFunction) {
    domContentUnlistenFunction();
    domContentUnlistenFunction = null;
    console.log('TAURI-PLUGIN-MCP: Event listener for "got-dom-content" has been removed.');
  }
  if (pageMapUnlistenFunction) {
    pageMapUnlistenFunction();
    pageMapUnlistenFunction = null;
    console.log('TAURI-PLUGIN-MCP: Event listener for "get-page-map" has been removed.');
  }
  if (localStorageUnlistenFunction) {
    localStorageUnlistenFunction();
    localStorageUnlistenFunction = null;
    console.log('TAURI-PLUGIN-MCP: Event listener for "get-local-storage" has been removed.');
  }
  if (jsExecutionUnlistenFunction) {
    jsExecutionUnlistenFunction();
    jsExecutionUnlistenFunction = null;
    console.log('TAURI-PLUGIN-MCP: Event listener for "execute-js" has been removed.');
  }
  if (elementPositionUnlistenFunction) {
    elementPositionUnlistenFunction();
    elementPositionUnlistenFunction = null;
    console.log('TAURI-PLUGIN-MCP: Event listener for "get-element-position" has been removed.');
  }
  if (sendTextToElementUnlistenFunction) {
    sendTextToElementUnlistenFunction();
    sendTextToElementUnlistenFunction = null;
  }
  if (getPageStateUnlistenFunction) {
    getPageStateUnlistenFunction();
    getPageStateUnlistenFunction = null;
  }
  if (navigateBackUnlistenFunction) {
    navigateBackUnlistenFunction();
    navigateBackUnlistenFunction = null;
  }
  if (scrollPageUnlistenFunction) {
    scrollPageUnlistenFunction();
    scrollPageUnlistenFunction = null;
  }
  if (fillFormUnlistenFunction) {
    fillFormUnlistenFunction();
    fillFormUnlistenFunction = null;
  }
  if (waitForUnlistenFunction) {
    waitForUnlistenFunction();
    waitForUnlistenFunction = null;
  }
  if (navigateWebviewUnlistenFunction) {
    navigateWebviewUnlistenFunction();
    navigateWebviewUnlistenFunction = null;
  }
  if (manageZoomUnlistenFunction) {
    manageZoomUnlistenFunction();
    manageZoomUnlistenFunction = null;
  }
  if (typeIntoFocusedUnlistenFunction) {
    typeIntoFocusedUnlistenFunction();
    typeIntoFocusedUnlistenFunction = null;
  }
  if (pressKeyUnlistenFunction) {
    pressKeyUnlistenFunction();
    pressKeyUnlistenFunction = null;
  }
  if (setFileInputUnlistenFunction) {
    setFileInputUnlistenFunction();
    setFileInputUnlistenFunction = null;
  }
  if (ipcInvokeUnlistenFunction) {
    ipcInvokeUnlistenFunction();
    ipcInvokeUnlistenFunction = null;
  }
  if (readTextUnlistenFunction) {
    readTextUnlistenFunction();
    readTextUnlistenFunction = null;
  }
  if (inspectElementUnlistenFunction) {
    inspectElementUnlistenFunction();
    inspectElementUnlistenFunction = null;
  }
  if (dispatchPointerUnlistenFunction) {
    dispatchPointerUnlistenFunction();
    dispatchPointerUnlistenFunction = null;
  }
  if (appBridgeUnlistenFunction) {
    appBridgeUnlistenFunction();
    appBridgeUnlistenFunction = null;
  }
  console.log("TAURI-PLUGIN-MCP: All event listeners have been removed.");
}
async function handleGetElementPositionRequest(event) {
  console.log("TAURI-PLUGIN-MCP: Received get-element-position, payload:", event.payload);
  const correlationId = getCorrelationId(event.payload);
  try {
    const { selectorType, selectorValue, shouldClick = false, scopeSelector = null, matchMode = null, nth = null } = event.payload;
    let scopeRoot = document;
    if (scopeSelector) {
      const scoped = document.querySelector(scopeSelector);
      if (!scoped) {
        throw new Error(`scope_selector "${scopeSelector}" matched no element`);
      }
      scopeRoot = scoped;
    }
    const nthIndex = typeof nth === "number" && nth >= 0 ? nth : 0;
    let element = null;
    let debugInfo = [];
    switch (selectorType) {
      case "ref":
        const refNum = parseInt(selectorValue, 10);
        element = getElementByRef(refNum);
        if (!element) {
          debugInfo.push(isRefDetached(refNum) ? `Element ref=${refNum} is no longer attached to the DOM (the page changed since the map was taken). Re-run query_page(mode='map') to get fresh refs.` : `No element found with ref=${refNum}. Refs are renumbered on every query_page(mode='map') call \u2014 run it first to populate refs.`);
        }
        break;
      case "id":
        element = document.getElementById(selectorValue);
        if (!element) {
          debugInfo.push(`No element found with id="${selectorValue}"`);
        }
        break;
      case "class": {
        const classSel = "." + selectorValue.trim().split(/\s+/).join(".");
        const elemsByClass = scopeRoot.querySelectorAll(classSel);
        element = elemsByClass.length > nthIndex ? elemsByClass[nthIndex] : null;
        if (!element) {
          debugInfo.push(`No elements found with class="${selectorValue}" at nth=${nthIndex} (total matching: ${elemsByClass.length})`);
        } else if (elemsByClass.length > 1 && nthIndex === 0) {
          debugInfo.push(`Found ${elemsByClass.length} elements with class="${selectorValue}", using the first one`);
        }
        break;
      }
      case "tag": {
        const elemsByTag = scopeRoot.querySelectorAll(selectorValue);
        element = elemsByTag.length > nthIndex ? elemsByTag[nthIndex] : null;
        if (!element) {
          debugInfo.push(`No elements found with tag="${selectorValue}" at nth=${nthIndex} (total matching: ${elemsByTag.length})`);
        } else if (elemsByTag.length > 1 && nthIndex === 0) {
          debugInfo.push(`Found ${elemsByTag.length} elements with tag="${selectorValue}", using the first one`);
        }
        break;
      }
      case "css": {
        const elemsByCss = scopeRoot.querySelectorAll(selectorValue);
        element = elemsByCss.length > nthIndex ? elemsByCss[nthIndex] : null;
        if (!element) {
          debugInfo.push(`No element found matching CSS selector "${selectorValue}" at nth=${nthIndex} (total matching: ${elemsByCss.length})`);
        }
        break;
      }
      case "text":
        element = findElementByText(selectorValue, {
          root: scopeRoot,
          match: matchMode === "exact" || matchMode === "contains" ? matchMode : "auto",
          nth: nthIndex
        });
        if (!element) {
          debugInfo.push(`No element found with text="${selectorValue}"${scopeSelector ? ` within scope "${scopeSelector}"` : ""}${matchMode ? ` (match=${matchMode})` : ""}`);
          const containingElements = Array.from(document.querySelectorAll("*")).filter((el) => el.textContent && el.textContent.includes(selectorValue));
          if (containingElements.length > 0) {
            debugInfo.push(`Found ${containingElements.length} elements containing part of the text.`);
            debugInfo.push(`First element with partial match: ${containingElements[0].tagName}, text="${containingElements[0].textContent?.trim()}"`);
          }
          const inputs = Array.from(document.querySelectorAll("input, textarea"));
          const inputsWithSimilarPlaceholders = inputs.filter((input) => input.placeholder && input.placeholder.includes(selectorValue));
          if (inputsWithSimilarPlaceholders.length > 0) {
            debugInfo.push(`Found ${inputsWithSimilarPlaceholders.length} input elements with similar placeholders.`);
            const firstMatch = inputsWithSimilarPlaceholders[0];
            debugInfo.push(`First input with similar placeholder: ${firstMatch.tagName}, placeholder="${firstMatch.placeholder}"`);
          }
        }
        break;
      default:
        throw new Error(`Unsupported selector type: ${selectorType}`);
    }
    if (!element) {
      throw new Error(`Element with ${selectorType}="${selectorValue}" not found. ${debugInfo.join(" ")}`);
    }
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      throw new Error(`Element with ${selectorType}="${selectorValue}" was found but has a zero-size bounding box (likely hidden via display:none or not rendered). Refusing to return coordinates that cannot be clicked.`);
    }
    console.log("TAURI-PLUGIN-MCP: Element rect:", {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    });
    const elementViewportCssX = rect.left + rect.width / 2;
    const elementViewportCssY = rect.top + rect.height / 2;
    const elementDocumentCssX = elementViewportCssX + window.scrollX;
    const elementDocumentCssY = elementViewportCssY + window.scrollY;
    const targetX = elementDocumentCssX;
    const targetY = elementDocumentCssY;
    console.log("TAURI-PLUGIN-MCP: Raw coordinates for mouse_movement:", { x: targetX, y: targetY });
    let clickResult = null;
    if (shouldClick) {
      clickResult = clickElement(element, elementViewportCssX, elementViewportCssY);
    }
    await emitResponse("get-element-position-response", correlationId, {
      success: true,
      data: {
        x: targetX,
        y: targetY,
        element: {
          tag: element.tagName,
          classes: element.className,
          id: element.id,
          text: element.textContent?.trim() || "",
          placeholder: element instanceof HTMLInputElement ? element.placeholder : void 0
        },
        clicked: shouldClick,
        clickResult,
        debug: {
          elementRect: rect,
          viewportCenter: {
            x: elementViewportCssX,
            y: elementViewportCssY
          },
          documentCenter: {
            x: elementDocumentCssX,
            y: elementDocumentCssY
          },
          window: {
            innerSize: {
              width: window.innerWidth,
              height: window.innerHeight
            },
            scrollPosition: {
              x: window.scrollX,
              y: window.scrollY
            }
          }
        }
      }
    });
  } catch (error) {
    console.error("TAURI-PLUGIN-MCP: Error handling get-element-position request", error);
    await emitResponse("get-element-position-response", correlationId, {
      success: false,
      error: error instanceof Error ? error.toString() : String(error)
    }).catch((e) => console.error("TAURI-PLUGIN-MCP: Error emitting error response", e));
  }
}
function elementMatchesText(element, text, exact) {
  const content = element.textContent?.trim();
  if (content && (exact ? content === text : content.includes(text)))
    return true;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const ph = element.placeholder;
    if (ph && (exact ? ph === text : ph.includes(text)))
      return true;
  }
  const title = element.getAttribute("title");
  if (title && (exact ? title === text : title.includes(text)))
    return true;
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel && (exact ? ariaLabel === text : ariaLabel.includes(text)))
    return true;
  return false;
}
function findElementByText(text, opts = {}) {
  const root = opts.root ?? document;
  const matchMode = opts.match ?? "auto";
  const nth = opts.nth ?? 0;
  const allElements = Array.from(root.querySelectorAll("*"));
  const collect = (exact) => allElements.filter((el) => elementMatchesText(el, text, exact));
  let candidates;
  if (matchMode === "exact") {
    candidates = collect(true);
  } else if (matchMode === "contains") {
    candidates = collect(false);
  } else {
    candidates = collect(true);
    if (candidates.length === 0)
      candidates = collect(false);
  }
  if (candidates.length === 0)
    return null;
  const candidateSet = new Set(candidates);
  const innermost = candidates.filter((c) => !candidates.some((o) => o !== c && c.contains(o)));
  const hoisted = [];
  for (const el of innermost) {
    let pick = el;
    let p = el;
    while (p && p !== document.body) {
      if (candidateSet.has(p) && isInteractive(p)) {
        pick = p;
        break;
      }
      p = p.parentElement;
    }
    if (!hoisted.includes(pick))
      hoisted.push(pick);
  }
  const rank = (el) => isInteractive(el) ? 0 : isSemanticElement(el) ? 1 : 2;
  hoisted.sort((a, b) => rank(a) - rank(b) || (a.textContent?.trim().length ?? 0) - (b.textContent?.trim().length ?? 0));
  return hoisted[nth] ?? null;
}
function clickElement(element, centerX, centerY) {
  try {
    if (!isInteractive(element)) {
      let p = element.parentElement;
      while (p && p !== document.body) {
        if (isInteractive(p)) {
          console.log(`TAURI-PLUGIN-MCP: Click target <${element.tagName.toLowerCase()}> is not interactive; retargeting to ancestor <${p.tagName.toLowerCase()}${p.id ? "#" + p.id : ""}>`);
          element = p;
          break;
        }
        p = p.parentElement;
      }
    }
    if (element instanceof HTMLElement) {
      element.focus();
    }
    if (isTypeable(element)) {
      _lastFocusedElement = element;
    }
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: centerX,
      clientY: centerY,
      button: 0
    };
    const pointerBase = {
      ...base,
      pointerId: 1,
      isPrimary: true,
      pointerType: "mouse"
    };
    element.dispatchEvent(new PointerEvent("pointerdown", { ...pointerBase, buttons: 1 }));
    element.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }));
    element.dispatchEvent(new PointerEvent("pointerup", { ...pointerBase, buttons: 0 }));
    element.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
    element.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0, detail: 1 }));
    return {
      success: true,
      elementTag: element.tagName,
      position: { x: centerX, y: centerY }
    };
  } catch (error) {
    console.error("TAURI-PLUGIN-MCP: Error clicking element:", error);
    return {
      success: false,
      error: error instanceof Error ? error.toString() : String(error)
    };
  }
}
async function handleReadTextRequest(event) {
  const correlationId = getCorrelationId(event.payload);
  try {
    const { selector, all = true, limit = 20, attrs = null, maxChars = 4e3, scopeSelector = null } = event.payload;
    if (!selector || typeof selector !== "string") {
      throw new Error('read_text requires a CSS "selector" string');
    }
    let root = document;
    if (scopeSelector) {
      const scoped = document.querySelector(scopeSelector);
      if (!scoped)
        throw new Error(`scope_selector "${scopeSelector}" matched no element`);
      root = scoped;
    }
    const nodes = Array.from(root.querySelectorAll(selector));
    const totalMatches = nodes.length;
    const selected = all ? nodes.slice(0, Math.max(1, limit)) : nodes.slice(0, 1);
    const perElement = Math.max(80, Math.floor(maxChars / Math.max(1, selected.length)));
    let truncated = totalMatches > selected.length;
    const matches = selected.map((el) => {
      const raw = (el instanceof HTMLElement ? el.innerText : el.textContent) || "";
      let text = raw.replace(/\s+/g, " ").trim();
      if (text.length > perElement) {
        text = text.slice(0, perElement) + `\u2026[+${raw.length - perElement} chars]`;
        truncated = true;
      }
      const entry = {
        tag: el.tagName.toLowerCase(),
        text,
        visible: isElementVisible(el)
      };
      if (Array.isArray(attrs) && attrs.length > 0) {
        const collected = {};
        for (const name of attrs)
          collected[name] = el.getAttribute(name);
        entry.attrs = collected;
      }
      return entry;
    });
    await emitResponse("read-text-response", correlationId, {
      success: true,
      data: { matches, total_matches: totalMatches, truncated }
    });
  } catch (error) {
    console.error("TAURI-PLUGIN-MCP: Error handling read-text request", error);
    await emitResponse("read-text-response", correlationId, {
      success: false,
      error: error instanceof Error ? error.toString() : String(error)
    }).catch((e) => console.error("TAURI-PLUGIN-MCP: Error emitting error response", e));
  }
}
var DEFAULT_INSPECT_STYLE_PROPS = [
  "display",
  "position",
  "padding",
  "margin",
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "z-index",
  "opacity",
  "overflow",
  "flex-direction",
  "gap",
  "border-radius"
];
async function handleInspectElementRequest(event) {
  const correlationId = getCorrelationId(event.payload);
  try {
    const { selector, all = false, limit = 10, styleProps = null } = event.payload;
    if (!selector || typeof selector !== "string") {
      throw new Error('inspect_element requires a CSS "selector" string');
    }
    const nodes = Array.from(document.querySelectorAll(selector));
    if (nodes.length === 0) {
      throw new Error(`No element found matching CSS selector "${selector}"`);
    }
    const selected = all ? nodes.slice(0, Math.max(1, limit)) : nodes.slice(0, 1);
    const props = Array.isArray(styleProps) && styleProps.length > 0 ? styleProps : DEFAULT_INSPECT_STYLE_PROPS;
    const elements = selected.map((el) => {
      const rect = el.getBoundingClientRect();
      const computed = window.getComputedStyle(el);
      const styles = {};
      for (const prop of props)
        styles[prop] = computed.getPropertyValue(prop);
      const attributes = {};
      for (const attr of Array.from(el.attributes)) {
        if (attr.name === "style" || attr.name === "class")
          continue;
        attributes[attr.name] = attr.value;
      }
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classList: Array.from(el.classList),
        rect: {
          x: Math.round(rect.x * 100) / 100,
          y: Math.round(rect.y * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100
        },
        visible: isElementVisible(el),
        attrs: attributes,
        styles
      };
    });
    await emitResponse("inspect-element-response", correlationId, {
      success: true,
      data: { elements, total_matches: nodes.length }
    });
  } catch (error) {
    console.error("TAURI-PLUGIN-MCP: Error handling inspect-element request", error);
    await emitResponse("inspect-element-response", correlationId, {
      success: false,
      error: error instanceof Error ? error.toString() : String(error)
    }).catch((e) => console.error("TAURI-PLUGIN-MCP: Error emitting error response", e));
  }
}
function pointerOpts(x, y, button, buttons, modifiers, extra = {}) {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    button,
    buttons,
    shiftKey: modifiers.includes("shift"),
    ctrlKey: modifiers.includes("ctrl"),
    altKey: modifiers.includes("alt"),
    metaKey: modifiers.includes("meta"),
    ...extra
  };
}
function dispatchPointerGesture(el, gesture, opts) {
  const { x, y, button, modifiers, to, steps } = opts;
  const dispatched = [];
  const pBase = { pointerId: 1, isPrimary: true, pointerType: "mouse" };
  const downButtons = button === 2 ? 2 : button === 1 ? 4 : 1;
  const fire = (target, name, px, py, buttons, extra = {}) => {
    const base = pointerOpts(px, py, button, buttons, modifiers, extra);
    const ev = name.startsWith("pointer") ? new PointerEvent(name, { ...base, ...pBase }) : new MouseEvent(name, base);
    target.dispatchEvent(ev);
    if (target === el)
      dispatched.push(name);
  };
  const down = (px, py) => {
    fire(el, "pointerdown", px, py, downButtons);
    fire(el, "mousedown", px, py, downButtons);
  };
  const up = (px, py) => {
    fire(el, "pointerup", px, py, 0);
    fire(el, "mouseup", px, py, 0);
  };
  const click = (px, py, detail = 1) => {
    fire(el, "click", px, py, 0, { detail });
  };
  switch (gesture) {
    case "down":
      down(x, y);
      break;
    case "up":
      up(x, y);
      fire(el, "click", x, y, 0, { detail: 1 });
      break;
    case "click":
      down(x, y);
      up(x, y);
      click(x, y);
      break;
    case "dblclick":
      down(x, y);
      up(x, y);
      click(x, y, 1);
      down(x, y);
      up(x, y);
      click(x, y, 2);
      fire(el, "dblclick", x, y, 0, { detail: 2 });
      break;
    case "hover":
      fire(el, "pointerover", x, y, 0);
      fire(el, "pointerenter", x, y, 0);
      fire(el, "pointermove", x, y, 0);
      fire(el, "mouseover", x, y, 0);
      fire(el, "mouseenter", x, y, 0);
      fire(el, "mousemove", x, y, 0);
      break;
    case "drag": {
      if (!to)
        throw new Error("gesture 'drag' requires a 'to' destination");
      down(x, y);
      const n = Math.max(1, steps);
      for (let i = 1; i <= n; i++) {
        const mx = x + (to.x - x) * i / n;
        const my = y + (to.y - y) * i / n;
        fire(el, "pointermove", mx, my, downButtons);
        fire(el, "mousemove", mx, my, downButtons);
        fire(document, "pointermove", mx, my, downButtons);
        fire(document, "mousemove", mx, my, downButtons);
      }
      fire(el, "pointerup", to.x, to.y, 0);
      fire(el, "mouseup", to.x, to.y, 0);
      fire(document, "pointerup", to.x, to.y, 0);
      fire(document, "mouseup", to.x, to.y, 0);
      break;
    }
    default:
      throw new Error(`Unsupported gesture: ${gesture}. Use click|dblclick|down|up|hover|drag.`);
  }
  return dispatched;
}
async function handleDispatchPointerRequest(event) {
  const correlationId = getCorrelationId(event.payload);
  try {
    const { selectorType = "css", selectorValue, gesture, offset = null, to = null, steps = 8, button = 0, modifiers = null } = event.payload;
    if (!selectorValue)
      throw new Error("dispatch_pointer requires selector_value");
    if (!gesture)
      throw new Error("dispatch_pointer requires gesture");
    let element = null;
    if (selectorType === "ref") {
      const refNum = parseInt(selectorValue, 10);
      element = getElementByRef(refNum);
      if (!element) {
        throw new Error(isRefDetached(refNum) ? `Element ref=${refNum} is no longer attached to the DOM. Re-run query_page(mode='map') for fresh refs.` : `No element found with ref=${refNum}. Run query_page(mode='map') first.`);
      }
    } else {
      element = document.querySelector(selectorValue);
      if (!element)
        throw new Error(`No element found matching CSS selector "${selectorValue}"`);
    }
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      throw new Error(`Element "${selectorValue}" has a zero-size bounding box (hidden or unrendered).`);
    }
    const originX = offset && typeof offset.x === "number" ? rect.left + offset.x : rect.left + rect.width / 2;
    const originY = offset && typeof offset.y === "number" ? rect.top + offset.y : rect.top + rect.height / 2;
    let dest;
    if (to && typeof to === "object") {
      if (typeof to.dx === "number" || typeof to.dy === "number") {
        dest = { x: originX + (to.dx ?? 0), y: originY + (to.dy ?? 0) };
      } else if (typeof to.x === "number" && typeof to.y === "number") {
        dest = { x: to.x, y: to.y };
      }
    }
    const dispatched = dispatchPointerGesture(element, gesture, {
      x: originX,
      y: originY,
      button: typeof button === "number" ? button : 0,
      modifiers: Array.isArray(modifiers) ? modifiers : [],
      to: dest,
      steps: typeof steps === "number" ? steps : 8
    });
    await emitResponse("dispatch-pointer-response", correlationId, {
      success: true,
      data: {
        dispatched,
        target: { tag: element.tagName.toLowerCase(), id: element.id || null },
        from: { x: Math.round(originX), y: Math.round(originY) },
        to: dest ? { x: Math.round(dest.x), y: Math.round(dest.y) } : void 0
      }
    });
  } catch (error) {
    console.error("TAURI-PLUGIN-MCP: Error handling dispatch-pointer request", error);
    await emitResponse("dispatch-pointer-response", correlationId, {
      success: false,
      error: error instanceof Error ? error.toString() : String(error)
    }).catch((e) => console.error("TAURI-PLUGIN-MCP: Error emitting error response", e));
  }
}
function ensureMcpBridge() {
  const w = window;
  if (w.__MCP_BRIDGE__ && w.__MCP_BRIDGE__.__isMcpBridge) {
    return w.__MCP_BRIDGE__;
  }
  const registry = /* @__PURE__ */ new Map();
  const bridge = {
    __isMcpBridge: true,
    // register() overwrites silently so HMR / effect re-runs are safe.
    register(name, fn, description = "") {
      registry.set(name, { fn, description });
    },
    unregister(name) {
      registry.delete(name);
    },
    list() {
      return Array.from(registry.entries()).map(([name, entry]) => ({
        name,
        description: entry.description
      }));
    },
    async call(name, args = []) {
      const entry = registry.get(name);
      if (!entry) {
        const known = Array.from(registry.keys()).join(", ") || "(none registered)";
        throw new Error(`No bridge helper named "${name}". Registered helpers: ${known}`);
      }
      return await entry.fn(...Array.isArray(args) ? args : [args]);
    }
  };
  w.__MCP_BRIDGE__ = bridge;
  return bridge;
}
async function handleAppBridgeRequest(event) {
  const correlationId = getCorrelationId(event.payload);
  try {
    const { action, name = null, args = null, timeoutMs = 1e4, maxChars = 2e4 } = event.payload;
    const bridge = ensureMcpBridge();
    if (action === "list") {
      await emitResponse("app-bridge-response", correlationId, {
        success: true,
        data: { helpers: bridge.list() }
      });
      return;
    }
    if (action !== "call") {
      throw new Error(`Unsupported app_bridge action: ${action}. Use 'list' or 'call'.`);
    }
    if (!name)
      throw new Error("app_bridge action 'call' requires a helper name");
    const callArgs = args == null ? [] : Array.isArray(args) ? args : [args];
    const result = await Promise.race([
      bridge.call(name, callArgs),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Bridge helper "${name}" timed out after ${timeoutMs}ms`)), timeoutMs))
    ]);
    let serialized = stringifyJsResult(result);
    let truncated = false;
    if (serialized.length > maxChars) {
      serialized = serialized.slice(0, maxChars) + `\u2026[truncated ${serialized.length - maxChars} chars \u2014 pass a narrower helper/args or raise max_chars]`;
      truncated = true;
    }
    await emitResponse("app-bridge-response", correlationId, {
      success: true,
      data: { result: serialized, type: typeof result, truncated }
    });
  } catch (error) {
    console.error("TAURI-PLUGIN-MCP: Error handling app-bridge request", error);
    await emitResponse("app-bridge-response", correlationId, {
      success: false,
      error: error instanceof Error ? error.toString() : String(error)
    }).catch((e) => console.error("TAURI-PLUGIN-MCP: Error emitting error response", e));
  }
}
async function handleDomContentRequest(event) {
  console.log("TAURI-PLUGIN-MCP: Received got-dom-content, payload:", event.payload);
  const correlationId = getCorrelationId(event.payload);
  try {
    const domContent = getDomContent();
    await emitResponse("got-dom-content-response", correlationId, domContent);
    console.log("TAURI-PLUGIN-MCP: Emitted got-dom-content-response");
  } catch (error) {
    console.error("TAURI-PLUGIN-MCP: Error handling dom content request", error);
    await emitResponse("got-dom-content-response", correlationId, "").catch((e) => console.error("TAURI-PLUGIN-MCP: Error emitting empty response", e));
  }
}
function getDomContent() {
  if (document.readyState === "complete" || document.readyState === "interactive") {
    const domContent = document.documentElement.outerHTML;
    console.log("TAURI-PLUGIN-MCP: DOM content fetched, length:", domContent.length);
    return domContent;
  }
  console.warn("TAURI-PLUGIN-MCP: DOM not fully loaded when got-dom-content received. Returning empty content.");
  return "";
}
function waitForDomStable(quietMs = 300, maxWaitMs = 3e3) {
  return new Promise((resolve) => {
    let resolved = false;
    let timer;
    function done() {
      if (resolved)
        return;
      resolved = true;
      clearTimeout(timer);
      clearTimeout(timeout);
      observer.disconnect();
      resolve();
    }
    const timeout = setTimeout(done, maxWaitMs);
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(done, quietMs);
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
    timer = setTimeout(done, quietMs);
  });
}
async function handleGetPageMapRequest(event) {
  console.log("TAURI-PLUGIN-MCP: Received get-page-map, payload:", event.payload);
  const correlationId = getCorrelationId(event.payload);
  try {
    const options = typeof event.payload === "object" ? event.payload : {};
    if (options.waitForStable) {
      const quietMs = typeof options.quietMs === "number" ? options.quietMs : 300;
      const maxWaitMs = typeof options.maxWaitMs === "number" ? options.maxWaitMs : 3e3;
      console.log(`TAURI-PLUGIN-MCP: Waiting for DOM to stabilize (quiet=${quietMs}ms, max=${maxWaitMs}ms)`);
      await waitForDomStable(quietMs, maxWaitMs);
    }
    const result = getPageMap(options);
    await emitResponse("get-page-map-response", correlationId, JSON.stringify(result));
    console.log("TAURI-PLUGIN-MCP: Emitted get-page-map-response");
  } catch (error) {
    console.error("TAURI-PLUGIN-MCP: Error handling get-page-map request", error);
    await emitResponse("get-page-map-response", correlationId, JSON.stringify({
      url: window.location.href,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      elements: [],
      content: "",
      error: error instanceof Error ? error.message : String(error)
    })).catch((e) => console.error("TAURI-PLUGIN-MCP: Error emitting error response", e));
  }
}
var NOISE_TAGS = /* @__PURE__ */ new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "LINK",
  "META",
  "HEAD",
  "BR",
  "HR",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "TEMPLATE",
  "SLOT"
]);
var INTERACTIVE_TAGS = /* @__PURE__ */ new Set([
  "A",
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "DETAILS",
  "SUMMARY"
]);
var INTERACTIVE_ROLES = /* @__PURE__ */ new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "combobox",
  "listbox",
  "option",
  "menuitem",
  "tab",
  "searchbox"
]);
var SEMANTIC_TAGS = /* @__PURE__ */ new Set([
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "IMG",
  "NAV",
  "MAIN",
  "HEADER",
  "FOOTER",
  "ASIDE",
  "SECTION",
  "ARTICLE",
  "FIGURE",
  "FIGCAPTION",
  "TABLE",
  "FORM",
  "LABEL",
  "FIELDSET",
  "LEGEND",
  "P",
  "LI",
  "OL",
  "UL",
  "DL",
  "DT",
  "DD"
]);
function isElementVisible(el) {
  if (!(el instanceof HTMLElement))
    return true;
  if (el.getAttribute("aria-hidden") === "true")
    return false;
  if (el.hidden)
    return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")
    return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0)
    return false;
  if (style.overflow === "hidden" && (rect.width <= 1 || rect.height <= 1))
    return false;
  const clip = style.getPropertyValue("clip");
  if (clip && clip !== "auto") {
    const m = clip.match(/rect\(\s*([^\s,]+)[\s,]+([^\s,]+)[\s,]+([^\s,]+)[\s,]+([^\s,]+)\s*\)/);
    if (m) {
      const [, top, right, bottom, left] = m.map((v) => parseFloat(v) || 0);
      if (top === bottom && left === right)
        return false;
    }
  }
  const clipPath = style.getPropertyValue("clip-path");
  if (clipPath) {
    const insetMatch = clipPath.match(/inset\(\s*([\d.]+)(%|px)?\s*\)/);
    if (insetMatch) {
      const val = parseFloat(insetMatch[1]);
      const unit = insetMatch[2] || "%";
      if (unit === "%" && val >= 50 || unit === "px" && val >= Math.min(rect.width, rect.height) / 2)
        return false;
    }
  }
  const position = style.position;
  if (position === "absolute" || position === "fixed") {
    const left = parseFloat(style.left);
    const top = parseFloat(style.top);
    if (!isNaN(left) && left <= -9e3 || !isNaN(top) && top <= -9e3)
      return false;
  }
  return true;
}
function isInteractive(el) {
  if (INTERACTIVE_TAGS.has(el.tagName))
    return true;
  const role = el.getAttribute("role");
  if (role && INTERACTIVE_ROLES.has(role))
    return true;
  if (el instanceof HTMLElement && el.isContentEditable)
    return true;
  if (el.getAttribute("tabindex") !== null && el.getAttribute("tabindex") !== "-1")
    return true;
  if (el.getAttribute("onclick") || el.getAttribute("ng-click") || el.getAttribute("@click"))
    return true;
  if (_elementsWithListeners.has(el))
    return true;
  if (window.__TAURI_MCP_ELEMENTS_WITH_LISTENERS__?.has(el))
    return true;
  return false;
}
function isSemanticElement(el) {
  if (SEMANTIC_TAGS.has(el.tagName))
    return true;
  if (el.getAttribute("role"))
    return true;
  if (el.getAttribute("aria-label"))
    return true;
  if (el.getAttribute("data-testid") || el.id)
    return true;
  return false;
}
var CONTEXT_TAGS = /* @__PURE__ */ new Set([
  "NAV",
  "MAIN",
  "HEADER",
  "FOOTER",
  "ASIDE",
  "SECTION",
  "ARTICLE",
  "FORM",
  "DIALOG",
  "DETAILS",
  "FIELDSET",
  "FIGURE",
  "TABLE"
]);
var LANDMARK_ROLES = {
  navigation: "nav",
  main: "main",
  banner: "header",
  contentinfo: "footer",
  complementary: "aside",
  search: "search",
  form: "form",
  region: "region",
  dialog: "dialog"
};
function isContextElement(el) {
  if (CONTEXT_TAGS.has(el.tagName))
    return true;
  const role = el.getAttribute("role");
  return !!(role && LANDMARK_ROLES[role]);
}
function buildContextLabel(el) {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role");
  let label = role && LANDMARK_ROLES[role] ? `[role=${role}]` : tag;
  if (el.id)
    label += `#${el.id}`;
  else {
    const cls = el.className;
    if (typeof cls === "string" && cls.trim()) {
      label += `.${cls.trim().split(/\s+/)[0]}`;
    }
  }
  return label;
}
function getElementText(el) {
  if (el instanceof HTMLInputElement) {
    return el.value || el.placeholder || "";
  }
  if (el instanceof HTMLTextAreaElement) {
    return el.value || el.placeholder || "";
  }
  if (el instanceof HTMLSelectElement) {
    return el.options[el.selectedIndex]?.text || "";
  }
  let text = "";
  if (el instanceof HTMLElement) {
    text = (el.innerText || "").trim();
  }
  if (!text) {
    text = el.getAttribute("aria-label") || el.getAttribute("title") || "";
  }
  if (text.length > 100) {
    text = text.substring(0, 97) + "...";
  }
  return text;
}
function elementFingerprint(el) {
  const tag = el.tagName.toLowerCase();
  const id = el.id || "";
  const name = el.name || "";
  const type = el.type || "";
  const href = el.href || "";
  const text50 = (el.textContent || "").trim().substring(0, 50);
  const class50 = (typeof el.className === "string" ? el.className : "").substring(0, 50);
  let nthChild = 0;
  if (el.parentElement) {
    const siblings = el.parentElement.children;
    for (let i = 0; i < siblings.length; i++) {
      if (siblings[i] === el) {
        nthChild = i;
        break;
      }
    }
  }
  return `${tag}|${id}|${name}|${type}|${href}|${text50}|${class50}|${nthChild}`;
}
function buildPageMapEntry(el, interactiveOnly) {
  const interactive = isInteractive(el);
  if (!interactive && (interactiveOnly || !isSemanticElement(el)))
    return null;
  const entry = {
    ref: 0,
    tag: el.tagName.toLowerCase()
  };
  if (!interactive)
    entry.interactive = false;
  if (el instanceof HTMLInputElement) {
    entry.type = el.type;
    if (el.value)
      entry.value = el.value.substring(0, 100);
    if (el.placeholder)
      entry.placeholder = el.placeholder;
    if (el.name)
      entry.name = el.name;
    if (el.type === "checkbox" || el.type === "radio") {
      entry.checked = el.checked;
    }
    if (el.disabled)
      entry.disabled = true;
  } else if (el instanceof HTMLTextAreaElement) {
    entry.type = "textarea";
    if (el.value)
      entry.value = el.value.substring(0, 100);
    if (el.placeholder)
      entry.placeholder = el.placeholder;
    if (el.name)
      entry.name = el.name;
    if (el.disabled)
      entry.disabled = true;
  } else if (el instanceof HTMLSelectElement) {
    entry.type = "select";
    entry.options = Array.from(el.options).map((o) => o.text).slice(0, 10);
    if (el.name)
      entry.name = el.name;
    if (el.disabled)
      entry.disabled = true;
  } else if (el instanceof HTMLAnchorElement) {
    entry.href = el.href;
  } else if (el instanceof HTMLImageElement) {
    if (el.alt)
      entry.text = el.alt;
  }
  const text = getElementText(el);
  if (text)
    entry.text = text;
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel && ariaLabel !== text)
    entry.ariaLabel = ariaLabel;
  const role = el.getAttribute("role");
  if (role) {
    entry.role = role;
    if (role === "radio" || role === "checkbox" || role === "switch") {
      const checked = el.getAttribute("aria-checked");
      if (checked !== null)
        entry.checked = checked === "true";
    } else if (role === "tab" || role === "option") {
      const selected = el.getAttribute("aria-selected");
      if (selected !== null)
        entry.checked = selected === "true";
    }
  }
  if (entry.checked === void 0) {
    const pressed = el.getAttribute("aria-pressed");
    if (pressed !== null)
      entry.checked = pressed === "true";
  }
  if (el.id)
    entry.id = el.id;
  return entry;
}
function extractPageMetadata() {
  const metadata = {};
  const descMeta = document.querySelector('meta[name="description"]');
  if (descMeta) {
    const content = descMeta.getAttribute("content");
    if (content)
      metadata.description = content;
  }
  const ogTags = document.querySelectorAll('meta[property^="og:"]');
  if (ogTags.length > 0) {
    const og = {};
    ogTags.forEach((tag) => {
      const prop = tag.getAttribute("property");
      const content = tag.getAttribute("content");
      if (prop && content)
        og[prop] = content;
    });
    if (Object.keys(og).length > 0)
      metadata.openGraph = og;
  }
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
  if (jsonLdScripts.length > 0) {
    const jsonLd = [];
    jsonLdScripts.forEach((script) => {
      try {
        const parsed = JSON.parse(script.textContent || "");
        jsonLd.push(parsed);
      } catch {
      }
    });
    if (jsonLd.length > 0)
      metadata.jsonLd = jsonLd;
  }
  return metadata;
}
function getPageMap(options) {
  const interactiveOnly = options?.interactiveOnly === true;
  const includeContent = interactiveOnly ? false : options?.includeContent !== false;
  const includeMetadata = options?.includeMetadata !== false;
  const maxDepth = typeof options?.maxDepth === "number" ? options.maxDepth : Infinity;
  const isDelta = options?.delta === true;
  const scopeSelector = options?.scopeSelector;
  _pageMapRefElements.clear();
  const elements = [];
  let refCounter = isDelta ? _previousPageMapMaxRef + 1 : 1;
  const seenTexts = /* @__PURE__ */ new Set();
  const SECONDARY_CONTEXT_TAGS = /* @__PURE__ */ new Set(["NAV", "FOOTER", "ASIDE", "HEADER"]);
  const mainContentParts = [];
  const secondaryContentParts = [];
  const currentFingerprints = /* @__PURE__ */ new Map();
  function assignRef(el, entry) {
    if (isDelta) {
      const fp = elementFingerprint(el);
      const prev = _previousPageMapFingerprints.get(fp);
      if (prev) {
        entry.ref = prev.ref;
        _pageMapRefElements.set(prev.ref, el);
        currentFingerprints.set(fp, { ref: prev.ref, props: entry });
        return prev.ref;
      }
    }
    const ref = refCounter++;
    entry.ref = ref;
    _pageMapRefElements.set(ref, el);
    if (isDelta) {
      currentFingerprints.set(elementFingerprint(el), { ref, props: entry });
    }
    return ref;
  }
  function isSecondaryContext(contextStack) {
    for (const ctx of contextStack) {
      for (const tag of SECONDARY_CONTEXT_TAGS) {
        if (ctx.toLowerCase().startsWith(tag.toLowerCase()) || ctx.startsWith(`[role=${tag.toLowerCase()}`))
          return true;
      }
    }
    return false;
  }
  let nodesVisited = 0;
  function walkNode(node, depth, contextStack, parentRefNum, hiddenAncestor = false) {
    nodesVisited++;
    if (depth > maxDepth)
      return;
    if (node.nodeType === Node.TEXT_NODE) {
      if (interactiveOnly)
        return;
      if (hiddenAncestor)
        return;
      const text = (node.textContent || "").trim();
      if (includeContent && text && !seenTexts.has(text)) {
        seenTexts.add(text);
        if (isSecondaryContext(contextStack)) {
          secondaryContentParts.push(text);
        } else {
          mainContentParts.push(text);
        }
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE)
      return;
    const el = node;
    if (NOISE_TAGS.has(el.tagName))
      return;
    const tagUpper = el.tagName.toUpperCase();
    const isSvgNamespace = el.namespaceURI === "http://www.w3.org/2000/svg";
    if (tagUpper === "SVG" || isSvgNamespace && tagUpper !== "SVG") {
      if (tagUpper === "SVG") {
        const label = el.getAttribute("aria-label");
        if (label && isElementVisible(el)) {
          const entry = {
            ref: 0,
            tag: "svg",
            ariaLabel: label,
            depth
          };
          if (contextStack.length > 0)
            entry.context = contextStack.join(" > ");
          if (parentRefNum !== null)
            entry.parentRef = parentRefNum;
          assignRef(el, entry);
          elements.push(entry);
        }
      }
      return;
    }
    let newContextStack = contextStack;
    if (isContextElement(el)) {
      newContextStack = [...contextStack, buildContextLabel(el)];
    }
    const selfVisible = isElementVisible(el);
    const isHidden = hiddenAncestor || !selfVisible;
    let currentParentRef = parentRefNum;
    if (selfVisible && !hiddenAncestor) {
      const entry = buildPageMapEntry(el, interactiveOnly);
      if (entry) {
        entry.depth = depth;
        if (newContextStack.length > 0)
          entry.context = newContextStack.join(" > ");
        if (parentRefNum !== null)
          entry.parentRef = parentRefNum;
        assignRef(el, entry);
        elements.push(entry);
        currentParentRef = entry.ref;
      }
    } else {
      const entry = buildPageMapEntry(el, interactiveOnly);
      if (entry) {
        entry.depth = depth;
        entry.visible = false;
        if (newContextStack.length > 0)
          entry.context = newContextStack.join(" > ");
        if (parentRefNum !== null)
          entry.parentRef = parentRefNum;
        assignRef(el, entry);
        elements.push(entry);
        currentParentRef = entry.ref;
      }
    }
    for (const child of el.childNodes) {
      walkNode(child, depth + 1, newContextStack, currentParentRef, isHidden);
    }
  }
  const roots = [];
  if (scopeSelector) {
    const selectors = Array.isArray(scopeSelector) ? scopeSelector : [scopeSelector];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el)
        roots.push(el);
    }
    if (roots.length === 0) {
      throw new Error(`scope_selector matched no elements: ${selectors.join(", ")}. Nothing was scanned \u2014 fix the selector, or omit scope_selector to scan the whole page.`);
    }
  }
  if (roots.length === 0) {
    roots.push(document.body || document.documentElement);
  }
  for (const root of roots) {
    walkNode(root, 0, [], null);
  }
  if (elements.length === 0 && nodesVisited < 5) {
    console.warn(`TAURI-PLUGIN-MCP: Recursive walk visited only ${nodesVisited} nodes. Trying flat scan fallback.`);
    const allEls = document.querySelectorAll("body *");
    for (const el of allEls) {
      if (NOISE_TAGS.has(el.tagName))
        continue;
      if (el.namespaceURI === "http://www.w3.org/2000/svg")
        continue;
      if (!isElementVisible(el))
        continue;
      const entry = buildPageMapEntry(el, interactiveOnly);
      if (entry) {
        const ctxParts = [];
        let ancestor = el.parentElement;
        while (ancestor && ancestor !== document.body) {
          if (isContextElement(ancestor)) {
            ctxParts.unshift(buildContextLabel(ancestor));
          }
          ancestor = ancestor.parentElement;
        }
        if (ctxParts.length > 0)
          entry.context = ctxParts.join(" > ");
        assignRef(el, entry);
        elements.push(entry);
      }
      if (!interactiveOnly && includeContent) {
        for (const child of el.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            const text = (child.textContent || "").trim();
            if (text && !seenTexts.has(text)) {
              seenTexts.add(text);
              mainContentParts.push(text);
            }
          }
        }
      }
    }
  }
  let deltaResult;
  if (isDelta) {
    const added = [];
    const removed = [];
    const changed = [];
    for (const [fp, cur] of currentFingerprints) {
      const prev = _previousPageMapFingerprints.get(fp);
      if (!prev) {
        added.push(cur.ref);
      } else {
        const curClone = { ...cur.props, ref: 0 };
        const prevClone = { ...prev.props, ref: 0 };
        if (JSON.stringify(curClone) !== JSON.stringify(prevClone)) {
          changed.push(cur.ref);
        }
      }
    }
    for (const [fp, prev] of _previousPageMapFingerprints) {
      if (!currentFingerprints.has(fp)) {
        removed.push(prev.ref);
      }
    }
    deltaResult = { added, removed, changed };
    _previousPageMapFingerprints = currentFingerprints;
    _previousPageMapMaxRef = Math.max(refCounter - 1, ...elements.map((e) => e.ref));
  } else {
    _previousPageMapFingerprints = /* @__PURE__ */ new Map();
    _previousPageMapMaxRef = 0;
  }
  let content = "";
  if (includeContent) {
    const mainText = mainContentParts.join(" ").replace(/\s+/g, " ").trim();
    const secondaryText = secondaryContentParts.join(" ").replace(/\s+/g, " ").trim();
    const CONTENT_BUDGET = 5e3;
    if (mainText.length >= CONTENT_BUDGET) {
      content = mainText.substring(0, CONTENT_BUDGET - 3) + "...";
    } else {
      content = mainText;
      const remaining = CONTENT_BUDGET - content.length;
      if (remaining > 10 && secondaryText) {
        const sep = content ? " " : "";
        if (secondaryText.length <= remaining - sep.length) {
          content += sep + secondaryText;
        } else {
          content += sep + secondaryText.substring(0, remaining - sep.length - 3) + "...";
        }
      }
    }
  }
  const result = {
    url: window.location.href,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    elements,
    content
  };
  if (includeMetadata) {
    const metadata = extractPageMetadata();
    if (metadata.description || metadata.openGraph || metadata.jsonLd) {
      result.metadata = metadata;
    }
  }
  if (scopeSelector)
    result.scope = scopeSelector;
  if (typeof options?.maxDepth === "number")
    result.maxDepth = options.maxDepth;
  if (deltaResult)
    result.delta = deltaResult;
  const interactiveCount = elements.filter((e) => e.interactive !== false).length;
  console.log(`TAURI-PLUGIN-MCP: Page map generated: ${elements.length} total elements (${interactiveCount} interactive), ${content.length} chars content, ${nodesVisited} nodes visited`);
  return result;
}
function getElementByRef(ref) {
  const el = _pageMapRefElements.get(ref) || null;
  if (el && !el.isConnected)
    return null;
  return el;
}
function isRefDetached(ref) {
  const el = _pageMapRefElements.get(ref);
  return !!el && !el.isConnected;
}
async function handleLocalStorageRequest(event) {
  console.log("TAURI-PLUGIN-MCP: Received get-local-storage, payload:", event.payload);
  const correlationId = getCorrelationId(event.payload);
  try {
    const { action, key, value } = event.payload;
    console.log("TAURI-PLUGIN-MCP: Processing localStorage operation", { action, key });
    const result = performLocalStorageOperation(action, key, value);
    await emitResponse("get-local-storage-response", correlationId, result);
    console.log("TAURI-PLUGIN-MCP: Emitted get-local-storage-response");
  } catch (error) {
    console.error("TAURI-PLUGIN-MCP: Error handling localStorage request", error);
    await emitResponse("get-local-storage-response", correlationId, {
      success: false,
      error: error instanceof Error ? error.toString() : String(error)
    }).catch((e) => console.error("TAURI-PLUGIN-MCP: Error emitting error response", e));
  }
}
function performLocalStorageOperation(action, key, value) {
  console.log("TAURI-PLUGIN-MCP: LocalStorage operation", {
    action,
    key: typeof key === "undefined" ? "undefined" : key,
    value: typeof value === "undefined" ? "undefined" : value,
    keyType: typeof key,
    valueType: typeof value
  });
  switch (action) {
    case "get":
      if (!key) {
        console.log("TAURI-PLUGIN-MCP: Getting all localStorage items");
        const allItems = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k) {
            allItems[k] = localStorage.getItem(k) || "";
          }
        }
        return {
          success: true,
          data: allItems
        };
      }
      console.log(`TAURI-PLUGIN-MCP: Getting localStorage item with key: ${key}`);
      return {
        success: true,
        data: localStorage.getItem(String(key))
      };
    case "set":
      if (!key) {
        console.log("TAURI-PLUGIN-MCP: Set operation failed - no key provided");
        throw new Error("Key is required for set operation");
      }
      if (value === void 0) {
        console.log("TAURI-PLUGIN-MCP: Set operation failed - no value provided");
        throw new Error("Value is required for set operation");
      }
      const keyStr = String(key);
      const valueStr = String(value);
      console.log(`TAURI-PLUGIN-MCP: Setting localStorage item: ${keyStr}`);
      localStorage.setItem(keyStr, valueStr);
      return { success: true, data: { action: "set", key: keyStr, length: valueStr.length } };
    case "remove":
      if (!key) {
        console.log("TAURI-PLUGIN-MCP: Remove operation failed - no key provided");
        throw new Error("Key is required for remove operation");
      }
      console.log(`TAURI-PLUGIN-MCP: Removing localStorage item with key: ${key}`);
      localStorage.removeItem(String(key));
      return { success: true, data: { action: "remove", key: String(key) } };
    case "clear":
      console.log("TAURI-PLUGIN-MCP: Clearing all localStorage items");
      localStorage.clear();
      return { success: true, data: { action: "clear" } };
    case "keys":
      console.log("TAURI-PLUGIN-MCP: Getting all localStorage keys");
      return {
        success: true,
        data: Object.keys(localStorage)
      };
    default:
      console.log(`TAURI-PLUGIN-MCP: Unsupported localStorage action: ${action}`);
      throw new Error(`Unsupported localStorage action: ${action}`);
  }
}
async function handleJsExecutionRequest(event) {
  console.log("TAURI-PLUGIN-MCP: Received execute-js, payload:", event.payload);
  const correlationId = getCorrelationId(event.payload);
  try {
    const code = typeof event.payload === "object" && event.payload._payload !== void 0 ? event.payload._payload : event.payload;
    let result = executeJavaScript(code);
    if (result !== null && (typeof result === "object" || typeof result === "function") && typeof result.then === "function") {
      result = await result;
    }
    const response = {
      result: stringifyJsResult(result),
      type: result === null ? "null" : typeof result
    };
    await emitResponse("execute-js-response", correlationId, response);
    console.log("TAURI-PLUGIN-MCP: Emitted execute-js-response");
  } catch (error) {
    console.error("TAURI-PLUGIN-MCP: Error executing JavaScript:", error);
    const errorMessage = error instanceof Error ? error.toString() : String(error);
    await emitResponse("execute-js-response", correlationId, {
      result: null,
      type: "error",
      error: errorMessage
    }).catch((e) => console.error("TAURI-PLUGIN-MCP: Error emitting error response", e));
  }
}
function stringifyJsResult(result) {
  if (result === void 0)
    return "undefined";
  if (result === null)
    return "null";
  if (typeof result === "object") {
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }
  return String(result);
}
function executeJavaScript(code) {
  if (/^\s*\{/.test(code)) {
    try {
      return (0, eval)("(" + code + ")");
    } catch (e) {
      if (!(e instanceof SyntaxError))
        throw e;
    }
  }
  try {
    return (0, eval)(code);
  } catch (e) {
    if (!(e instanceof SyntaxError))
      throw e;
    return new Function(code)();
  }
}
async function handleSendTextToElementRequest(event) {
  console.log("TAURI-PLUGIN-MCP: Received send-text-to-element, payload:", event.payload);
  const correlationId = getCorrelationId(event.payload);
  if (correlationId && _handledCorrelationIds.has(correlationId)) {
    console.warn("TAURI-PLUGIN-MCP: Ignoring duplicate send-text-to-element for correlation ID:", correlationId);
    return;
  }
  if (correlationId) {
    _handledCorrelationIds.add(correlationId);
    setTimeout(() => _handledCorrelationIds.delete(correlationId), 3e4);
  }
  try {
    const { selectorType, selectorValue, text, delayMs = 20 } = event.payload;
    let element = null;
    let debugInfo = [];
    switch (selectorType) {
      case "ref":
        const refNum = parseInt(selectorValue, 10);
        element = getElementByRef(refNum);
        if (!element) {
          debugInfo.push(isRefDetached(refNum) ? `Element ref=${refNum} is no longer attached to the DOM (the page changed since the map was taken). Re-run query_page(mode='map') to get fresh refs.` : `No element found with ref=${refNum}. Refs are renumbered on every query_page(mode='map') call \u2014 run it first to populate refs.`);
        }
        break;
      case "id":
        element = document.getElementById(selectorValue);
        if (!element) {
          debugInfo.push(`No element found with id="${selectorValue}"`);
        }
        break;
      case "class":
        const elemsByClass = document.getElementsByClassName(selectorValue);
        element = elemsByClass.length > 0 ? elemsByClass[0] : null;
        if (!element) {
          debugInfo.push(`No elements found with class="${selectorValue}" (total matching: 0)`);
        } else if (elemsByClass.length > 1) {
          debugInfo.push(`Found ${elemsByClass.length} elements with class="${selectorValue}", using the first one`);
        }
        break;
      case "tag":
        const elemsByTag = document.getElementsByTagName(selectorValue);
        element = elemsByTag.length > 0 ? elemsByTag[0] : null;
        if (!element) {
          debugInfo.push(`No elements found with tag="${selectorValue}" (total matching: 0)`);
        } else if (elemsByTag.length > 1) {
          debugInfo.push(`Found ${elemsByTag.length} elements with tag="${selectorValue}", using the first one`);
        }
        break;
      case "css":
        element = document.querySelector(selectorValue);
        if (!element) {
          debugInfo.push(`No element found matching CSS selector "${selectorValue}"`);
        }
        break;
      case "text":
        element = findElementByText(selectorValue);
        if (!element) {
          debugInfo.push(`No element found with text="${selectorValue}"`);
        }
        break;
      default:
        throw new Error(`Unsupported selector type: ${selectorType}`);
    }
    if (!element) {
      throw new Error(`Element with ${selectorType}="${selectorValue}" not found. ${debugInfo.join(" ")}`);
    }
    if (element instanceof HTMLSelectElement) {
      if (!selectOptionOnSelect(element, text)) {
        throw selectOptionError(element, text);
      }
      await emitResponse("send-text-to-element-response", correlationId, {
        success: true,
        data: {
          element: {
            tag: element.tagName,
            classes: element.className,
            id: element.id,
            type: "select",
            text,
            isEditable: true,
            strategy: "select"
          }
        }
      });
      return;
    }
    const isEditableElement = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable;
    if (!isEditableElement) {
      console.warn(`Element is not normally editable: ${element.tagName}. Will try to set value/textContent directly.`);
    }
    element.focus();
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      await simulateReactInputTyping(element, text, delayMs);
    } else if (element.isContentEditable) {
      console.log(`TAURI-PLUGIN-MCP: Setting text in contentEditable element: ${element.id || element.className}`);
      const isLexicalEditor = element.hasAttribute("data-lexical-editor");
      const isSlateEditor = element.hasAttribute("data-slate-editor") || element.querySelector('[data-slate-editor="true"]') !== null;
      if (isLexicalEditor) {
        console.log("TAURI-PLUGIN-MCP: Detected Lexical editor, using specialized handling");
        await typeIntoLexicalEditor(element, text, delayMs);
      } else if (isSlateEditor) {
        console.log("TAURI-PLUGIN-MCP: Detected Slate editor, using specialized handling");
        await typeIntoSlateEditor(element, text, delayMs);
      } else {
        await typeIntoContentEditable(element, text, delayMs);
      }
    } else {
      element.textContent = text;
      console.warn("TAURI-PLUGIN-MCP: Element is not an input, textarea, or contentEditable. Text was set directly but may not behave as expected.");
    }
    await emitResponse("send-text-to-element-response", correlationId, {
      success: true,
      data: {
        element: {
          tag: element.tagName,
          classes: element.className,
          id: element.id,
          type: element instanceof HTMLInputElement ? element.type : null,
          text,
          isEditable: isEditableElement
        }
      }
    });
  } catch (error) {
    console.error("TAURI-PLUGIN-MCP: Error handling send-text-to-element request", error);
    await emitResponse("send-text-to-element-response", correlationId, {
      success: false,
      error: error instanceof Error ? error.toString() : String(error)
    }).catch((e) => console.error("TAURI-PLUGIN-MCP: Error emitting error response", e));
  }
}
function selectOptionOnSelect(el, value) {
  const needle = value.toLowerCase().trim();
  for (const opt of el.options) {
    if (opt.value.toLowerCase().trim() === needle || opt.text.toLowerCase().trim() === needle) {
      el.focus();
      opt.selected = true;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
  }
  return false;
}
function selectOptionError(el, value) {
  const available = Array.from(el.options).map((o) => o.text || o.value).slice(0, 20);
  return new Error(`No <option> matching "${value}" found in <select>${el.id ? " #" + el.id : ""}. Available options: ${JSON.stringify(available)}`);
}
async function simulateReactInputTyping(element, text, delayMs, clear = true) {
  console.log("TAURI-PLUGIN-MCP: Simulating typing on React component via execCommand");
  element.focus();
  await new Promise((resolve) => setTimeout(resolve, 50));
  try {
    if (clear) {
      element.select();
      document.execCommand("delete", false);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (delayMs > 0) {
      for (let i = 0; i < text.length; i++) {
        document.execCommand("insertText", false, text[i]);
        if (i < text.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    } else {
      document.execCommand("insertText", false, text);
    }
    console.log("TAURI-PLUGIN-MCP: Completed React input typing simulation");
  } catch (e) {
    console.error("TAURI-PLUGIN-MCP: execCommand approach failed, trying nativeInputValueSetter fallback:", e);
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (nativeSetter) {
      nativeSetter.call(element, text);
    } else {
      element.value = text;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
}
async function typeIntoContentEditable(element, text, delayMs) {
  console.log("TAURI-PLUGIN-MCP: Using general contentEditable typing approach");
  try {
    element.focus();
    await new Promise((resolve) => setTimeout(resolve, 50));
    element.innerHTML = "";
    element.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const keydownEvent = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: char,
        code: `Key${char.toUpperCase()}`
      });
      element.dispatchEvent(keydownEvent);
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const textNode = document.createTextNode(char);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: char
      }));
      const keyupEvent = new KeyboardEvent("keyup", {
        bubbles: true,
        cancelable: true,
        key: char,
        code: `Key${char.toUpperCase()}`
      });
      element.dispatchEvent(keyupEvent);
      if (delayMs > 0 && i < text.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
    console.log("TAURI-PLUGIN-MCP: Completed contentEditable text entry");
  } catch (e) {
    console.error("TAURI-PLUGIN-MCP: Error in contentEditable typing:", e);
    element.textContent = text;
    element.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }
}
async function typeIntoLexicalEditor(element, text, delayMs) {
  console.log("TAURI-PLUGIN-MCP: Starting specialized Lexical editor typing");
  try {
    element.focus();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const paragraphs = element.querySelectorAll("p");
    if (paragraphs.length > 0) {
      for (const p of paragraphs) {
        p.innerHTML = "<br>";
      }
    } else {
      element.innerHTML = '<p class="editor-paragraph"><br></p>';
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const targetParagraph = element.querySelector("p") || element;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const activeElement = document.activeElement;
      const currentTarget = activeElement && element.contains(activeElement) ? activeElement : targetParagraph;
      const beforeInputEvent = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: char
      });
      currentTarget.dispatchEvent(beforeInputEvent);
      const keydownEvent = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: char,
        code: `Key${char.toUpperCase()}`,
        composed: true
      });
      currentTarget.dispatchEvent(keydownEvent);
      if (!beforeInputEvent.defaultPrevented) {
        document.execCommand("insertText", false, char);
      }
      const inputEvent = new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: char
      });
      currentTarget.dispatchEvent(inputEvent);
      const keyupEvent = new KeyboardEvent("keyup", {
        bubbles: true,
        cancelable: true,
        key: char,
        code: `Key${char.toUpperCase()}`,
        composed: true
      });
      currentTarget.dispatchEvent(keyupEvent);
      if (delayMs > 0 && i < text.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(targetParagraph);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } catch (e) {
      console.warn("TAURI-PLUGIN-MCP: Error setting final selection:", e);
    }
    console.log("TAURI-PLUGIN-MCP: Completed Lexical editor typing");
  } catch (e) {
    console.error("TAURI-PLUGIN-MCP: Error in Lexical editor typing:", e);
    try {
      const firstParagraph = element.querySelector("p") || element;
      firstParagraph.textContent = text;
      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } catch (innerError) {
      console.error("TAURI-PLUGIN-MCP: Fallback for Lexical editor failed:", innerError);
    }
  }
}
async function typeIntoSlateEditor(element, text, delayMs) {
  console.log("TAURI-PLUGIN-MCP: Starting specialized Slate editor typing");
  try {
    element.focus();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const editableDiv = element.querySelector('[contenteditable="true"]') || element;
    if (editableDiv instanceof HTMLElement) {
      editableDiv.focus();
    }
    document.execCommand("selectAll", false, void 0);
    document.execCommand("delete", false, void 0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const activeElement = document.activeElement || editableDiv;
      activeElement.dispatchEvent(new KeyboardEvent("keydown", {
        key: char,
        bubbles: true,
        cancelable: true
      }));
      document.execCommand("insertText", false, char);
      activeElement.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: char
      }));
      activeElement.dispatchEvent(new KeyboardEvent("keyup", {
        key: char,
        bubbles: true,
        cancelable: true
      }));
      if (delayMs > 0 && i < text.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    console.log("TAURI-PLUGIN-MCP: Completed Slate editor typing");
  } catch (e) {
    console.error("TAURI-PLUGIN-MCP: Error in Slate editor typing:", e);
    try {
      const editableDiv = element.querySelector('[contenteditable="true"]') || element;
      editableDiv.textContent = text;
      editableDiv.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } catch (innerError) {
      console.error("TAURI-PLUGIN-MCP: Fallback for Slate editor failed:", innerError);
    }
  }
}
async function handleGetPageStateRequest(event) {
  console.log("TAURI-PLUGIN-MCP: Received get-page-state");
  const correlationId = getCorrelationId(event.payload);
  try {
    await emitResponse("get-page-state-response", correlationId, JSON.stringify({
      success: true,
      data: {
        url: window.location.href,
        title: document.title,
        readyState: document.readyState,
        scrollPosition: { x: window.scrollX, y: window.scrollY },
        viewport: { width: window.innerWidth, height: window.innerHeight }
      }
    }));
  } catch (error) {
    await emitResponse("get-page-state-response", correlationId, JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}
async function handleNavigateBackRequest(event) {
  console.log("TAURI-PLUGIN-MCP: Received navigate-back, payload:", event.payload);
  const correlationId = getCorrelationId(event.payload);
  try {
    const { direction, delta } = event.payload || {};
    if (typeof delta === "number") {
      history.go(delta);
    } else if (direction === "forward") {
      history.forward();
    } else {
      history.back();
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    await emitResponse("navigate-back-response", correlationId, JSON.stringify({
      success: true,
      data: {
        url: window.location.href,
        title: document.title
      }
    }));
  } catch (error) {
    await emitResponse("navigate-back-response", correlationId, JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}
async function handleScrollPageRequest(event) {
  console.log("TAURI-PLUGIN-MCP: Received scroll-page, payload:", event.payload);
  const correlationId = getCorrelationId(event.payload);
  try {
    const { direction, amount, toRef, toTop, toBottom } = event.payload || {};
    if (toTop) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (toBottom) {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
    } else if (typeof toRef === "number") {
      const el = getElementByRef(toRef);
      if (!el) {
        throw new Error(`No element found with ref=${toRef}. Refs are renumbered on every query_page(mode='map') call \u2014 run it first.`);
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      const vh = window.innerHeight;
      let pixels;
      if (typeof amount === "number") {
        pixels = amount;
      } else if (amount === "half") {
        pixels = Math.round(vh / 2);
      } else {
        pixels = vh;
      }
      if (direction === "up") {
        pixels = -pixels;
      }
      window.scrollBy({ top: pixels, behavior: "smooth" });
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
    let target;
    if (typeof toRef === "number") {
      const el = getElementByRef(toRef);
      if (el) {
        const r = el.getBoundingClientRect();
        target = {
          ref: toRef,
          inViewport: r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth,
          rect: { x: r.x, y: r.y, width: r.width, height: r.height }
        };
      }
    }
    await emitResponse("scroll-page-response", correlationId, JSON.stringify({
      success: true,
      data: {
        scrollPosition: { x: window.scrollX, y: window.scrollY },
        pageHeight: document.documentElement.scrollHeight,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        ...target ? { target } : {}
      }
    }));
  } catch (error) {
    await emitResponse("scroll-page-response", correlationId, JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}
function resolveElement(field) {
  if (typeof field.ref === "number") {
    return getElementByRef(field.ref);
  }
  if (field.selectorType && field.selectorValue) {
    switch (field.selectorType) {
      case "id":
        return document.getElementById(field.selectorValue);
      case "class":
        return document.getElementsByClassName(field.selectorValue)[0] || null;
      case "css":
        return document.querySelector(field.selectorValue);
      case "tag":
        return document.getElementsByTagName(field.selectorValue)[0] || null;
      case "text":
        return findElementByText(field.selectorValue);
      default:
        return null;
    }
  }
  return null;
}
async function handleFillFormRequest(event) {
  console.log("TAURI-PLUGIN-MCP: Received fill-form, payload:", event.payload);
  const correlationId = getCorrelationId(event.payload);
  if (correlationId && _handledCorrelationIds.has(correlationId)) {
    console.warn("TAURI-PLUGIN-MCP: Ignoring duplicate fill-form for correlation ID:", correlationId);
    return;
  }
  if (correlationId) {
    _handledCorrelationIds.add(correlationId);
    setTimeout(() => _handledCorrelationIds.delete(correlationId), 3e4);
  }
  try {
    const { fields, submitRef } = event.payload || {};
    if (!Array.isArray(fields) || fields.length === 0) {
      throw new Error("fields array is required and must not be empty");
    }
    const results = [];
    for (const field of fields) {
      const entry = { ref: field.ref, success: false };
      try {
        const el = resolveElement(field);
        if (!el) {
          entry.error = `Element not found (ref=${field.ref}, selector=${field.selectorType}:${field.selectorValue})`;
          results.push(entry);
          continue;
        }
        const clear = field.clear !== false;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.focus();
          await simulateReactInputTyping(el, field.value, 0, clear);
        } else if (el instanceof HTMLSelectElement) {
          if (!selectOptionOnSelect(el, field.value)) {
            throw selectOptionError(el, field.value);
          }
        } else if (el instanceof HTMLElement && el.isContentEditable) {
          el.focus();
          if (clear) {
            el.innerHTML = "";
            el.dispatchEvent(new InputEvent("input", { bubbles: true }));
          }
          await typeIntoContentEditable(el, field.value, 0);
        } else {
          entry.error = `Element <${el.tagName}> is not a form field`;
          results.push(entry);
          continue;
        }
        entry.success = true;
      } catch (fieldError) {
        entry.error = fieldError instanceof Error ? fieldError.message : String(fieldError);
      }
      results.push(entry);
    }
    let submitResult = null;
    if (typeof submitRef === "number") {
      const submitEl = getElementByRef(submitRef);
      if (submitEl && submitEl instanceof HTMLElement) {
        submitEl.click();
        submitResult = { clicked: true, tag: submitEl.tagName };
      } else {
        submitResult = { clicked: false, error: `Submit element ref=${submitRef} not found` };
      }
    }
    await emitResponse("fill-form-response", correlationId, JSON.stringify({
      success: true,
      data: { fields: results, submit: submitResult }
    }));
  } catch (error) {
    await emitResponse("fill-form-response", correlationId, JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}
async function handleWaitForRequest(event) {
  console.log("TAURI-PLUGIN-MCP: Received wait-for, payload:", event.payload);
  const correlationId = getCorrelationId(event.payload);
  try {
    const { text, selector, ref: refNum, state = "visible", timeoutMs = 1e4 } = event.payload || {};
    const pollInterval = 200;
    const result = await new Promise((resolve) => {
      const startTime = Date.now();
      let observer = null;
      function checkCondition() {
        if (typeof text === "string") {
          const bodyText = document.body?.innerText || "";
          const found = bodyText.includes(text);
          return state === "hidden" ? !found : found;
        }
        let el = null;
        if (typeof refNum === "number") {
          el = getElementByRef(refNum);
        } else if (typeof selector === "string") {
          el = document.querySelector(selector);
        }
        switch (state) {
          case "attached":
            return el !== null;
          case "detached":
            return el === null;
          case "hidden":
            if (!el)
              return true;
            return !isElementVisible(el);
          case "visible":
          default:
            if (!el)
              return false;
            return isElementVisible(el);
        }
      }
      function finish(found) {
        if (observer)
          observer.disconnect();
        resolve({ found, elapsed: Date.now() - startTime });
      }
      if (checkCondition()) {
        finish(true);
        return;
      }
      const interval = setInterval(() => {
        if (checkCondition()) {
          clearInterval(interval);
          finish(true);
          return;
        }
        if (Date.now() - startTime >= timeoutMs) {
          clearInterval(interval);
          finish(false);
        }
      }, pollInterval);
      observer = new MutationObserver(() => {
        if (checkCondition()) {
          clearInterval(interval);
          finish(true);
        }
      });
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
      setTimeout(() => {
        clearInterval(interval);
        finish(checkCondition());
      }, timeoutMs);
    });
    await emitResponse("wait-for-response", correlationId, JSON.stringify({
      success: true,
      data: {
        found: result.found,
        elapsed: result.elapsed,
        timedOut: !result.found
      }
    }));
  } catch (error) {
    await emitResponse("wait-for-response", correlationId, JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}
async function handleTypeIntoFocusedRequest(event) {
  console.log("TAURI-PLUGIN-MCP: Received type-into-focused, payload:", event.payload);
  const correlationId = getCorrelationId(event.payload);
  if (correlationId && _handledCorrelationIds.has(correlationId)) {
    console.warn("TAURI-PLUGIN-MCP: Ignoring duplicate type-into-focused for correlation ID:", correlationId);
    return;
  }
  if (correlationId) {
    _handledCorrelationIds.add(correlationId);
    setTimeout(() => _handledCorrelationIds.delete(correlationId), 3e4);
  }
  try {
    const { text, delayMs = 20, initialDelayMs } = event.payload || {};
    if (!text) {
      throw new Error("text parameter is required");
    }
    if (typeof initialDelayMs === "number" && initialDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, initialDelayMs));
    }
    let el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement || !isTypeable(el)) {
      el = _lastFocusedElement;
    }
    if (!el || el === document.body || el === document.documentElement || !isTypeable(el)) {
      const coords = window.__mcpLastClickCoords;
      if (coords && typeof coords.x === "number" && typeof coords.y === "number") {
        let pointEl = document.elementFromPoint(coords.x, coords.y);
        while (pointEl && pointEl !== document.body) {
          if (isTypeable(pointEl))
            break;
          pointEl = pointEl.parentElement;
        }
        if (pointEl && pointEl !== document.body && isTypeable(pointEl)) {
          el = pointEl;
          if (el instanceof HTMLElement)
            el.focus({ preventScroll: true });
          _lastFocusedElement = el;
        }
      }
    }
    if (!el || el === document.body || el === document.documentElement) {
      throw new Error("No element is currently focused. Click an element first or use selector mode.");
    }
    if (el instanceof HTMLElement) {
      el.focus();
    }
    const elementInfo = {
      tag: el.tagName.toLowerCase()
    };
    if (el.id)
      elementInfo.id = el.id;
    if (el instanceof HTMLElement && el.className)
      elementInfo.className = el.className.toString().substring(0, 100);
    if (el instanceof HTMLSelectElement) {
      elementInfo.strategy = "select";
      if (!selectOptionOnSelect(el, text)) {
        throw selectOptionError(el, text);
      }
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      elementInfo.strategy = "react-input";
      await simulateReactInputTyping(
        el,
        text,
        delayMs,
        /* clear */
        false
      );
    } else if (el instanceof HTMLElement) {
      const lexicalEl = el.closest("[data-lexical-editor]") || (el.hasAttribute("data-lexical-editor") ? el : null);
      if (lexicalEl && lexicalEl instanceof HTMLElement) {
        elementInfo.strategy = "lexical";
        await typeIntoLexicalEditor(lexicalEl, text, delayMs);
      } else {
        const slateEl = el.closest("[data-slate-editor]") || (el.hasAttribute("data-slate-editor") ? el : null);
        if (slateEl && slateEl instanceof HTMLElement) {
          elementInfo.strategy = "slate";
          await typeIntoSlateEditor(slateEl, text, delayMs);
        } else if (el.isContentEditable) {
          elementInfo.strategy = "contenteditable";
          await typeIntoContentEditable(el, text, delayMs);
        } else {
          elementInfo.strategy = "execCommand-fallback";
          el.focus();
          const inserted = document.execCommand("insertText", false, text);
          if (!inserted) {
            throw new Error(`Cannot type into focused <${el.tagName.toLowerCase()}> element \u2014 it is not an editable field.`);
          }
        }
      }
    } else {
      throw new Error(`Cannot type into focused <${el.tagName.toLowerCase()}> element \u2014 unsupported element type.`);
    }
    await emitResponse("type-into-focused-response", correlationId, JSON.stringify({
      success: true,
      data: {
        element: elementInfo,
        charsTyped: text.length
      }
    }));
  } catch (error) {
    await emitResponse("type-into-focused-response", correlationId, JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}
var NAMED_KEY_CODES = {
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  " ": "Space",
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12"
};
function codeForKey(key) {
  if (NAMED_KEY_CODES[key])
    return NAMED_KEY_CODES[key];
  if (key.length === 1) {
    if (/[a-zA-Z]/.test(key))
      return "Key" + key.toUpperCase();
    if (/[0-9]/.test(key))
      return "Digit" + key;
  }
  return "";
}
function tabbableElements() {
  const sel = "a[href], button, input, textarea, select, summary, [tabindex]";
  return Array.from(document.querySelectorAll(sel)).filter((el) => el instanceof HTMLElement).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1 && isElementVisible(el));
}
function emulateDefaultKeyAction(el, key, shift) {
  const isTextInput = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
  const isEditable = isTextInput || el instanceof HTMLElement && el.isContentEditable;
  if (key.length === 1) {
    if (isEditable)
      document.execCommand("insertText", false, key);
    return;
  }
  switch (key) {
    case "Enter":
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLElement && el.isContentEditable) {
        document.execCommand("insertText", false, "\n");
      } else if (el instanceof HTMLInputElement && el.form) {
        if (typeof el.form.requestSubmit === "function")
          el.form.requestSubmit();
        else
          el.form.submit();
      } else if (el instanceof HTMLElement && (el.tagName === "BUTTON" || el.getAttribute("role") === "button")) {
        el.click();
      }
      break;
    case "Tab": {
      const tabbables = tabbableElements();
      if (tabbables.length === 0)
        break;
      const idx = tabbables.indexOf(el);
      const next = shift ? tabbables[(idx <= 0 ? tabbables.length : idx) - 1] : tabbables[(idx + 1) % tabbables.length];
      if (next) {
        next.focus();
        if (isTypeable(next))
          _lastFocusedElement = next;
      }
      break;
    }
    case "Backspace":
      if (isEditable)
        document.execCommand("delete", false);
      break;
    case "Delete":
      if (isEditable)
        document.execCommand("forwardDelete", false);
      break;
  }
}
async function handlePressKeyRequest(event) {
  console.log("TAURI-PLUGIN-MCP: Received press-key, payload:", event.payload);
  const correlationId = getCorrelationId(event.payload);
  if (correlationId && _handledCorrelationIds.has(correlationId)) {
    console.warn("TAURI-PLUGIN-MCP: Ignoring duplicate press-key for correlation ID:", correlationId);
    return;
  }
  if (correlationId) {
    _handledCorrelationIds.add(correlationId);
    setTimeout(() => _handledCorrelationIds.delete(correlationId), 3e4);
  }
  try {
    const p = event.payload || {};
    const rawKey = p.key;
    const modifiers = Array.isArray(p.modifiers) ? p.modifiers : [];
    const repeat = typeof p.repeat === "number" && p.repeat > 0 ? p.repeat : 1;
    const selectorType = p.selectorType || null;
    const selectorValue = p.selectorValue || null;
    if (!rawKey || typeof rawKey !== "string") {
      throw new Error('key parameter is required (e.g. "Escape", "Enter", "Tab", "ArrowDown", or a single character)');
    }
    const key = rawKey === "Space" ? " " : rawKey;
    let target = null;
    if (selectorType && selectorValue) {
      target = resolveElement({
        ref: selectorType === "ref" ? parseInt(selectorValue, 10) : void 0,
        selectorType: selectorType === "ref" ? void 0 : selectorType,
        selectorValue
      });
      if (!target) {
        throw new Error(`Element with ${selectorType}="${selectorValue}" not found. ${selectorType === "ref" ? "Call query_page (mode=map) first to populate refs." : ""}`);
      }
      if (target instanceof HTMLElement)
        target.focus();
    } else {
      target = document.activeElement && document.activeElement !== document.body ? document.activeElement : _lastFocusedElement || document.body;
    }
    const mods = new Set(modifiers.map((m) => String(m).toLowerCase()));
    const eventInit = {
      key,
      code: codeForKey(key),
      bubbles: true,
      cancelable: true,
      composed: true,
      ctrlKey: mods.has("ctrl") || mods.has("control"),
      metaKey: mods.has("cmd") || mods.has("meta") || mods.has("command"),
      shiftKey: mods.has("shift"),
      altKey: mods.has("alt") || mods.has("option")
    };
    const hasCtrlOrMeta = !!(eventInit.ctrlKey || eventInit.metaKey);
    const count = Math.max(1, Math.min(100, Number(repeat) || 1));
    let lastDefaultPrevented = false;
    for (let i = 0; i < count; i++) {
      const el = document.activeElement && document.activeElement !== document.body ? document.activeElement : target || document.body;
      const kd = new KeyboardEvent("keydown", eventInit);
      const proceed = el.dispatchEvent(kd);
      lastDefaultPrevented = !proceed;
      if (proceed && !hasCtrlOrMeta && !eventInit.altKey) {
        emulateDefaultKeyAction(el, key, eventInit.shiftKey === true);
      }
      el.dispatchEvent(new KeyboardEvent("keyup", eventInit));
      if (i < count - 1)
        await new Promise((r) => setTimeout(r, 30));
    }
    const finalTarget = document.activeElement || target;
    await emitResponse("press-key-response", correlationId, JSON.stringify({
      success: true,
      data: {
        key: rawKey,
        code: eventInit.code,
        modifiers: Array.from(mods),
        repeat: count,
        defaultPrevented: lastDefaultPrevented,
        target: finalTarget ? {
          tag: finalTarget.tagName.toLowerCase(),
          id: finalTarget.id || void 0
        } : null
      }
    }));
  } catch (error) {
    await emitResponse("press-key-response", correlationId, JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    })).catch((e) => console.error("TAURI-PLUGIN-MCP: Error emitting error response", e));
  }
}
async function handleSetFileInputRequest(event) {
  console.log("TAURI-PLUGIN-MCP: Received set-file-input");
  const correlationId = getCorrelationId(event.payload);
  if (correlationId && _handledCorrelationIds.has(correlationId)) {
    console.warn("TAURI-PLUGIN-MCP: Ignoring duplicate set-file-input for correlation ID:", correlationId);
    return;
  }
  if (correlationId) {
    _handledCorrelationIds.add(correlationId);
    setTimeout(() => _handledCorrelationIds.delete(correlationId), 3e4);
  }
  try {
    const { selectorType, selectorValue, files } = event.payload || {};
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error("files array is required");
    }
    if (!selectorType || !selectorValue) {
      throw new Error("selectorType and selectorValue are required to target the file input");
    }
    const element = resolveElement({
      ref: selectorType === "ref" ? parseInt(selectorValue, 10) : void 0,
      selectorType: selectorType === "ref" ? void 0 : selectorType,
      selectorValue
    });
    if (!element) {
      throw new Error(`Element with ${selectorType}="${selectorValue}" not found.`);
    }
    let input = null;
    if (element instanceof HTMLInputElement && element.type === "file") {
      input = element;
    } else {
      input = element.querySelector('input[type="file"]');
    }
    if (!input) {
      throw new Error(`Element <${element.tagName.toLowerCase()}> is not (and does not contain) an <input type="file">`);
    }
    if (files.length > 1 && !input.multiple) {
      throw new Error(`Input does not accept multiple files (got ${files.length}). Set the "multiple" attribute or send one file.`);
    }
    const dt = new DataTransfer();
    for (const f of files) {
      const resp = await fetch(`data:application/octet-stream;base64,${f.dataBase64}`);
      const bytes = await resp.arrayBuffer();
      dt.items.add(new File([bytes], f.name, { type: f.mimeType || "application/octet-stream" }));
    }
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await emitResponse("set-file-input-response", correlationId, JSON.stringify({
      success: true,
      data: {
        filesAttached: files.map((f) => f.name),
        input: { id: input.id || void 0, name: input.name || void 0 }
      }
    }));
  } catch (error) {
    await emitResponse("set-file-input-response", correlationId, JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    })).catch((e) => console.error("TAURI-PLUGIN-MCP: Error emitting error response", e));
  }
}
var MAX_IPC_RESULT_CHARS = 3e4;
async function handleIpcInvokeRequest(event) {
  console.log("TAURI-PLUGIN-MCP: Received ipc-invoke, payload:", event.payload);
  const correlationId = getCorrelationId(event.payload);
  if (correlationId && _handledCorrelationIds.has(correlationId)) {
    console.warn("TAURI-PLUGIN-MCP: Ignoring duplicate ipc-invoke for correlation ID:", correlationId);
    return;
  }
  if (correlationId) {
    _handledCorrelationIds.add(correlationId);
    setTimeout(() => _handledCorrelationIds.delete(correlationId), 3e4);
  }
  try {
    const { command, args, timeoutMs = 1e4 } = event.payload || {};
    if (!command || typeof command !== "string") {
      throw new Error("command parameter is required");
    }
    const started = Date.now();
    const result = await Promise.race([
      invoke(command, args && typeof args === "object" ? args : {}),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`invoke("${command}") timed out after ${timeoutMs}ms (the command may still be running)`)), timeoutMs))
    ]);
    let serialized;
    try {
      serialized = result === void 0 ? "undefined" : typeof result === "string" ? result : JSON.stringify(result);
    } catch {
      serialized = String(result);
    }
    let truncated = false;
    if (serialized.length > MAX_IPC_RESULT_CHARS) {
      serialized = serialized.slice(0, MAX_IPC_RESULT_CHARS);
      truncated = true;
    }
    await emitResponse("ipc-invoke-response", correlationId, JSON.stringify({
      success: true,
      data: {
        command,
        result: serialized,
        resultType: typeof result,
        truncated: truncated || void 0,
        durationMs: Date.now() - started
      }
    }));
  } catch (error) {
    let message;
    if (error instanceof Error)
      message = error.message;
    else if (typeof error === "string")
      message = error;
    else {
      try {
        message = JSON.stringify(error);
      } catch {
        message = String(error);
      }
    }
    await emitResponse("ipc-invoke-response", correlationId, JSON.stringify({
      success: false,
      error: `invoke failed: ${message}`
    })).catch((e) => console.error("TAURI-PLUGIN-MCP: Error emitting error response", e));
  }
}
async function handleNavigateWebviewRequest(event) {
  console.log("TAURI-PLUGIN-MCP: Received navigate-webview, payload:", event.payload);
  const correlationId = getCorrelationId(event.payload);
  try {
    const { action } = event.payload;
    if (action === "back") {
      window.history.back();
      await emitResponse("navigate-webview-response", correlationId, JSON.stringify({
        success: true,
        data: { action: "back" }
      }));
    } else if (action === "forward") {
      window.history.forward();
      await emitResponse("navigate-webview-response", correlationId, JSON.stringify({
        success: true,
        data: { action: "forward" }
      }));
    } else {
      await emitResponse("navigate-webview-response", correlationId, JSON.stringify({
        success: false,
        error: `Unknown navigate-webview action: ${action}`
      }));
    }
  } catch (error) {
    await emitResponse("navigate-webview-response", correlationId, JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}
async function handleManageZoomRequest(event) {
  console.log("TAURI-PLUGIN-MCP: Received manage-zoom, payload:", event.payload);
  const correlationId = getCorrelationId(event.payload);
  try {
    const { action } = event.payload;
    if (action === "get") {
      const visualScale = window.visualViewport?.scale ?? null;
      await emitResponse("manage-zoom-response", correlationId, JSON.stringify({
        success: true,
        data: {
          devicePixelRatio: window.devicePixelRatio,
          visualViewportScale: visualScale
        }
      }));
    } else {
      await emitResponse("manage-zoom-response", correlationId, JSON.stringify({
        success: false,
        error: `Unknown manage-zoom action: ${action}`
      }));
    }
  } catch (error) {
    await emitResponse("manage-zoom-response", correlationId, JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}
export {
  setupPluginListeners
};
