// Minimal ambient types for the untyped `cubejs` package — only the surface we
// use as the independent validation/round-trip oracle (and move application for
// calibration). A local shim so this package can type cubejs without a dependency on one.
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
