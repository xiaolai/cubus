// The platform's camera calls go one at a time (`inTurn`, src/camera.ts). Two things about that gate that the
// ordering tests in camera-track.test.ts do not hold:
//
// 1. IT IS BOUNDED. A call the platform never answers would otherwise hold every later camera open and device
//    list for the life of the page — where, before the gate, pressing Start again simply asked again.
// 2. NOTHING GOES AROUND IT. The gate is only a guarantee if every platform camera call takes its turn, so the
//    package's source is parsed and every `mediaDevices` call must sit inside a function handed to `inTurn`.

import { readdirSync } from 'node:fs';
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
/** The platform requests the gate exists for, by the symbol TypeScript resolves them to. */
const GATED = new Set(['MediaDevices.getUserMedia', 'MediaDevices.enumerateDevices']);
const config = ts.parseJsonConfigFileContent(
  ts.readConfigFile(join(PACKAGE, 'tsconfig.json'), ts.sys.readFile).config,
  ts.sys,
  PACKAGE,
);

/** A program over `files`, with `virtual` files served from memory (the samples below), under the package's options. */
function programOf(files: string[], virtual = new Map<string, string>()): ts.Program {
  const host = ts.createCompilerHost(config.options, true);
  const read = host.getSourceFile.bind(host);
  const exists = host.fileExists.bind(host);
  host.getSourceFile = (name, version, ...rest) => {
    const text = virtual.get(name);
    return text === undefined
      ? read(name, version, ...rest)
      : ts.createSourceFile(name, text, version, true);
  };
  host.fileExists = (name) => virtual.has(name) || exists(name);
  return ts.createProgram(files, config.options, host);
}

/**
 * Every reference in `sf` to a gated `MediaDevices` member that is NOT inside a function passed to
 * `inTurn(…)`, as `file:line member`. By RESOLVED SYMBOL, through the type checker — never by the name
 * `mediaDevices`: an alias (`const md = navigator.mediaDevices; md.enumerateDevices()`), an element access
 * (`navigator.mediaDevices['getUserMedia']`), a destructured alias (`const { mediaDevices: m } = navigator`)
 * and a destructured method (`const { enumerateDevices } = navigator.mediaDevices`) are all the same request,
 * and a comment or a string naming the API is none. A reference counts whether it is called or only read,
 * because a read is how a call around the gate is spelled.
 */
function bypasses(
  program: ts.Program,
  sf: ts.SourceFile,
): { references: number; outside: string[] } {
  const checker = program.getTypeChecker();
  let references = 0;
  const outside: string[] = [];
  const gated = (symbol: ts.Symbol | undefined): string | null => {
    if (!symbol) return null;
    const name = checker.getFullyQualifiedName(symbol);
    return GATED.has(name) ? name : null;
  };
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
    let found: string | null = null;
    if (ts.isPropertyAccessExpression(node)) {
      found = gated(checker.getSymbolAtLocation(node.name));
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      found = gated(
        checker.getTypeAtLocation(node.expression).getProperty(node.argumentExpression.text),
      );
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name;
      if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) {
        found = gated(checker.getTypeAtLocation(node.parent).getProperty(key.text));
      }
    }
    if (found) {
      references += 1;
      if (!insideInTurn(node)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        outside.push(`${sf.fileName.slice(PACKAGE.length)}:${line + 1} ${found.split('.')[1]}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { references, outside };
}

describe('nothing asks the platform for a camera around the gate', () => {
  it('every spelling of a request around inTurn is caught, and the one through it is not', () => {
    const sample = join(PACKAGE, 'src', '__gate-sample__.ts');
    const lines = [
      'declare function inTurn<T>(what: string, ask: () => Promise<T>): Promise<T>;',
      "export const ok = () => inTurn('x', () => navigator.mediaDevices.getUserMedia({ video: true }));",
      'export const direct = () => navigator.mediaDevices.enumerateDevices();',
      'export const alias = () => { const md = navigator.mediaDevices; return md.enumerateDevices(); };',
      "export const element = () => navigator.mediaDevices['getUserMedia']({ video: true });",
      'export const renamed = () => { const { mediaDevices: m } = navigator; return m.getUserMedia({}); };',
      'export const method = () => { const { enumerateDevices } = navigator.mediaDevices; return enumerateDevices; };',
      "// navigator.mediaDevices.getUserMedia() in a comment is not a request; nor is 'enumerateDevices()' in a string",
      "export const said = 'navigator.mediaDevices.enumerateDevices()';",
      "export const listens = () => navigator.mediaDevices.addEventListener('devicechange', () => {});",
    ];
    const program = programOf([sample], new Map([[sample, lines.join('\n')]]));
    const sf = program.getSourceFile(sample);
    if (!sf) throw new Error('the sample was not read');
    const { references, outside } = bypasses(program, sf);
    expect(outside).toEqual([
      'src/__gate-sample__.ts:3 enumerateDevices',
      'src/__gate-sample__.ts:4 enumerateDevices',
      'src/__gate-sample__.ts:5 getUserMedia',
      'src/__gate-sample__.ts:6 getUserMedia',
      'src/__gate-sample__.ts:7 enumerateDevices',
    ]);
    expect(references).toBe(6);
  });

  it('every request in the package goes through inTurn — and there are requests to check', () => {
    const files = SOURCE_DIRS.flatMap((dir) =>
      readdirSync(join(PACKAGE, dir), { recursive: true, encoding: 'utf8' })
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
        .map((f) => join(PACKAGE, dir, f)),
    );
    const program = programOf(files);
    let references = 0;
    const outside: string[] = [];
    for (const file of files) {
      const sf = program.getSourceFile(file);
      if (!sf) throw new Error(`${file} was not read`);
      const found = bypasses(program, sf);
      references += found.references;
      outside.push(...found.outside);
    }
    // A check that reads no request checks nothing: getUserMedia and enumerateDevices are both here today.
    expect(references).toBeGreaterThanOrEqual(2);
    expect(outside).toEqual([]);
  }, 60_000);
});
