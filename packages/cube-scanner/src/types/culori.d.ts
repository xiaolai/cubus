// Minimal ambient types for the untyped `culori` package — only the surface we
// use: an sRGB -> D65 CIELAB converter and the CIEDE2000 distance function.
// Channel values follow culori's convention (rgb 0..1, lab L* 0..100 / a*,b*
// signed). We target `lab65` because CIEDE2000 also runs in lab65 internally.
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
  /** Build a converter into a color space. We only ever target D65 CIELAB. */
  export function converter(mode: 'lab65'): (color: Rgb | Lab65) => Lab65;
  /** Build a CIEDE2000 perceptual-distance function over two CIELAB colors. */
  export function differenceCiede2000(): (a: Lab65, b: Lab65) => number;
}
