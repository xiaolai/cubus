// The platform's camera calls go one at a time (`inTurn`, src/camera.ts). Two things about that gate that the
// ordering tests in camera-track.test.ts do not hold:
//
// 1. IT IS BOUNDED. A call the platform never answers would otherwise hold every later camera open and device
//    list for the life of the page — where, before the gate, pressing Start again simply asked again.
// 2. NOTHING GOES AROUND IT. The gate is only a guarantee if every platform camera call takes its turn, so the
//    package's source is parsed and every `mediaDevices` call must sit inside a function handed to `inTurn`.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAMERA_CALL_RELEASE_MS, listCameras, openCamera } from '../src/camera.js';

describe('the camera gate is bounded', () => {
  afterEach(async () => {
    // A call left unanswered still holds the module's queue until its bound, and that bound is a timer on the
    // fake clock: run the clock past every bound a test could have started before going back to real time.
    await vi.advanceTimersByTimeAsync(CAMERA_CALL_RELEASE_MS * 4);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const video = () => ({ srcObject: null, play: async () => {} }) as unknown as HTMLVideoElement;

  it('a call that never answers stops holding the queue at the bound, says so, and is itself left pending', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let asked = 0;
    vi.stubGlobal('navigator', {
      mediaDevices: {
        // Never answered: no grant, no refusal — a host that never settles a permission request.
        getUserMedia: () => {
          asked += 1;
          return new Promise(() => {});
        },
        enumerateDevices: async () => [],
      },
    });
    let stuckSettled = false;
    openCamera(video()).then(
      () => {
        stuckSettled = true;
      },
      () => {
        stuckSettled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toBe(1);

    // A second open — a person pressing Start again — waits its turn…
    void openCamera(video()).catch(() => {});
    await vi.advanceTimersByTimeAsync(CAMERA_CALL_RELEASE_MS - 1);
    expect(asked).toBe(1);
    expect(warn).not.toHaveBeenCalled();

    // …and is asked once the bound has passed, with the release said out loud.
    await vi.advanceTimersByTimeAsync(1);
    expect(asked).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/getUserMedia.*not answered/);
    // The bound releases the QUEUE, not the call: whoever asked first is still waiting on the platform.
    expect(stuckSettled).toBe(false);
  });

  it('the bound runs from when a call is ASKED, not from when it joined the queue', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const order: string[] = [];
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: () => {
          order.push('camera');
          return new Promise(() => {});
        },
        enumerateDevices: async () => {
          order.push('list');
          return [];
        },
      },
    });
    void openCamera(video()).catch(() => {}); // asked at 0, never answers
    void openCamera(video()).catch(() => {}); // queued at 0, asked at the bound, never answers
    const list = listCameras(); // queued at 0: must wait a FULL bound behind the second, not be freed with it
    await vi.advanceTimersByTimeAsync(CAMERA_CALL_RELEASE_MS);
    expect(order).toEqual(['camera', 'camera']);
    await vi.advanceTimersByTimeAsync(CAMERA_CALL_RELEASE_MS - 1);
    expect(order).toEqual(['camera', 'camera']);
    await vi.advanceTimersByTimeAsync(1);
    await list;
    expect(order).toEqual(['camera', 'camera', 'list']);
  });

  it('a call that answers in time says nothing and holds the queue only as long as it takes', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new DOMException('no', 'NotAllowedError')), 1000),
          ),
        enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'a', label: 'A' }],
      },
    });
    const opening = openCamera(video()).catch(() => {});
    const list = listCameras();
    await vi.advanceTimersByTimeAsync(1000);
    await opening;
    expect(await list).toEqual([{ deviceId: 'a', label: 'A' }]);
    await vi.advanceTimersByTimeAsync(CAMERA_CALL_RELEASE_MS * 2);
    expect(warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_DIRS = ['src', 'view'];
/** Calls on `mediaDevices` that ask the platform nothing: listening for a device change is not a request. */
const NOT_A_REQUEST = new Set(['addEventListener', 'removeEventListener', 'dispatchEvent']);

/**
 * Every call of a `mediaDevices` method in `source` that is NOT inside a function passed to `inTurn(…)`,
 * as `file:line method`. Parsed by TypeScript's own parser, never matched by a pattern: a comment or a string
 * that names the API is not a call, and an optional chain or an alias of `navigator` still is.
 */
function bypasses(file: string, source: string): { calls: number; outside: string[] } {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let calls = 0;
  const outside: string[] = [];
  const insideInTurn = (node: ts.Node): boolean => {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
      if (
        (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
        n.parent &&
        ts.isCallExpression(n.parent) &&
        n.parent.arguments.includes(n as ts.Expression) &&
        ts.isIdentifier(n.parent.expression) &&
        n.parent.expression.text === 'inTurn'
      ) {
        return true;
      }
    }
    return false;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const target = node.expression.expression;
      const onMediaDevices =
        (ts.isPropertyAccessExpression(target) && target.name.text === 'mediaDevices') ||
        (ts.isIdentifier(target) && target.text === 'mediaDevices');
      if (onMediaDevices && !NOT_A_REQUEST.has(node.expression.name.text)) {
        calls += 1;
        if (!insideInTurn(node)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
          outside.push(`${file}:${line + 1} ${node.expression.name.text}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { calls, outside };
}

describe('nothing asks the platform for a camera around the gate', () => {
  it('the check finds a call that goes around inTurn, and passes one that goes through it', () => {
    const around = bypasses(
      'sample.ts',
      `
      // navigator.mediaDevices.getUserMedia() in a comment is not a call
      const said = 'navigator.mediaDevices.enumerateDevices()';
      export const ok = () => inTurn(() => navigator.mediaDevices.getUserMedia({ video: true }));
      export const bad = () => navigator.mediaDevices?.enumerateDevices();
      export const alsoBad = (md: MediaDevices) => md.getUserMedia({});
      export const listens = () => navigator.mediaDevices.addEventListener('devicechange', () => {});
      `,
    );
    expect(around.calls).toBe(2);
    expect(around.outside).toEqual(['sample.ts:5 enumerateDevices']);
  });

  it('every mediaDevices call in the package goes through inTurn — and there are calls to check', () => {
    const files = SOURCE_DIRS.flatMap((dir) =>
      readdirSync(join(PACKAGE, dir), { recursive: true, encoding: 'utf8' })
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
        .map((f) => join(dir, f)),
    );
    let calls = 0;
    const outside: string[] = [];
    for (const file of files) {
      const found = bypasses(file, readFileSync(join(PACKAGE, file), 'utf8'));
      calls += found.calls;
      outside.push(...found.outside);
    }
    // A check that reads no call checks nothing: getUserMedia and enumerateDevices are both here today.
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(outside).toEqual([]);
  });
});
