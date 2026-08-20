// Minimal ambient types for the untyped `cubejs` package — the independent
// oracle used to cross-check our engine's facelet convention (algorithm §12/#19).
// Mirrors the shim in cube-scanner / gan-driver.
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
