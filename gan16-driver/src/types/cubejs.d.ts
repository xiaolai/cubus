// Minimal ambient types for the untyped `cubejs` package — only the surface we
// use (facelet round-trip + move application).
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
