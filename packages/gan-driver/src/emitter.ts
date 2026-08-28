// Minimal browser-safe event emitter — a drop-in for the subset of node:events the
// driver uses (on / off / once / emit), so gan-driver runs in the browser + Tauri
// webview with no Node dependency. once() stores the original listener on its wrapper
// so off(event, original) still removes it after once(event, original) — matching
// Node's EventEmitter semantics (the driver relies on that in request()/waitLive()).

type Listener = (...args: any[]) => void;
type Wrapped = Listener & { listener?: Listener };

export class TinyEmitter {
  private readonly registry = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener): this {
    let set = this.registry.get(event);
    if (!set) {
      set = new Set();
      this.registry.set(event, set);
    }
    set.add(fn);
    return this;
  }

  once(event: string, fn: Listener): this {
    const wrap: Wrapped = (...args) => {
      this.off(event, fn);
      fn(...args);
    };
    wrap.listener = fn;
    return this.on(event, wrap);
  }

  off(event: string, fn: Listener): this {
    const set = this.registry.get(event);
    if (set) {
      for (const l of set) {
        if (l === fn || (l as Wrapped).listener === fn) set.delete(l);
      }
    }
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const set = this.registry.get(event);
    if (!set || set.size === 0) return false;
    for (const l of [...set]) l(...args);
    return true;
  }
}
