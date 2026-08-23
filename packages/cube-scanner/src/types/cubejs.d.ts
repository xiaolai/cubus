// Minimal ambient types for the untyped `cubejs` package — only the surface we
// use as the independent validation/round-trip oracle (and move application for
// calibration). Mirrors the shim in gan-driver so both packages agree on cubejs.
declare module 'cubejs' {
  class Cube {
    constructor();
    static fromString(facelets: string): Cube;
    move(algorithm: string): Cube;
    asString(): string;
    isSolved(): boolean;
  }
  export default Cube;
}
