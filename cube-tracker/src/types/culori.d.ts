// Minimal ambient types for the untyped `culori` package — only the surface we use:
// an sRGB -> D65 CIELAB converter and the CIEDE2000 distance function. Mirrors the
// cube-scanner shim so both packages agree on culori.
declare module 'culori' {
  export interface Rgb {
    mode: 'rgb';
    r: number;
    g: number;
    b: number;
    alpha?: number;
  }
  export interface Lab65 {
    mode: 'lab65';
    l: number;
    a: number;
    b: number;
    alpha?: number;
  }
  export function converter(mode: 'lab65'): (color: Rgb | Lab65) => Lab65;
  export function differenceCiede2000(): (a: Lab65, b: Lab65) => number;
}
