// The algorithms speedcubers actually use, one per case, from the sheets they learn from.
//
// HAND-MAINTAINED, AND SOURCED — the one table of algorithms in this repository that nobody here
// derived. `case-tables.js` holds the PROVED answer to each of the 119 cases: the fewest turns there
// are. That is a fact about the cube and it is the wrong thing to teach: of its 119 algorithms, 84 turn
// the back, bottom or left face, and one PLL is `R2 B2 F2 L2 D R2 B2 F2 L2` where every cuber learns
// `M2 U M2 U2 M2 U M2`. What makes an algorithm learnable is how fast hands can do it — right, top and
// front turns, wide turns and slices, few regrips — and that is a judgement the speedcubing community
// has already made and published. So this table COPIES it, names where each row came from, and changes
// nothing a test cannot account for.
//
// WHAT EACH ROW IS:
//   name      this repository's id for the row — `pll-T`, `oll-27`, `f2l-1`
//   label     the name the community uses: the PLL letter, `OLL 27`, `F2L 1` (the standard numbering
//             on J Perm, SpeedCubeDB and the Speedsolving wiki)
//   nickname  OLL only: the Speedsolving wiki's first name for the case, where it has one
//   case      the proved case this algorithm answers — a KEY into `case-tables.js`. Not trusted:
//             `human-algs.test.mjs` re-derives it by running the algorithm on every proved case and
//             requires exactly one to come out solved, and the 119 rows to cover the 119 cases once
//   alg       what the app teaches
//   sourceAlg the string as the source wrote it, present only where `alg` differs from it
//   source    a key into `SOURCES`
//
// THE TWO CHANGES MADE TO A SOURCE STRING, and the test that holds `alg` against `sourceAlg` admits
// these and nothing else:
//   1. Two identical quarter turns side by side are written as the half turn they are. J Perm writes
//      `R' R'` in OLL 1 and 35 and `r' r'` in OLL 18, and the method solver would merge the face turns
//      anyway, so a drill page and a lesson would otherwise print one algorithm two ways.
//   2. A whole-cube turn the source leaves open is closed at the end. J Perm's Aa, Ab, E and Ja begin
//      with `x` and never undo it, V turns `y` halfway through, and SpeedCubeDB's F2L 13, 18 and 20
//      begin with `y'`. Every algorithm here ends with the cube held the way it began, because the
//      solver hands the next stage the cube AS HELD: an Aa that left the cube on its side would give the
//      PLL stage a cube whose top is not the last layer. SpeedCubeDB writes Aa with the closing `x'` itself.
//
// Fetched 2026-10-13. Where the two sources disagreed, the first-listed J Perm algorithm was taken for
// OLL and PLL (J Perm draws each case from it, so it solves the picture with no turn of the top first),
// and SpeedCubeDB's top-voted Front Right algorithm for F2L, because J Perm publishes no numbered F2L.

/** Where the rows came from. A row names one of these by key. */
export const SOURCES = Object.freeze({
  'jperm-pll': Object.freeze({ url: 'https://jperm.net/algs/pll', what: 'J Perm, PLL — the first algorithm listed for each case' }),
  'jperm-oll': Object.freeze({ url: 'https://jperm.net/algs/oll', what: 'J Perm, OLL — the first algorithm listed for each case' }),
  'speedcubedb-f2l': Object.freeze({ url: 'https://speedcubedb.com/a/3x3/F2L', what: 'SpeedCubeDB, F2L, Front Right — the top-voted algorithm for each case' }),
  'speedsolving-oll-names': Object.freeze({ url: 'https://www.speedsolving.com/wiki/index.php?title=OLL', what: 'Speedsolving wiki, OLL — the first name given for each case' }),
});

const entry = (row) => Object.freeze(row);

/** The three sets, in the order a solve meets them. */
export const HUMAN_ALGS = Object.freeze([
  // F2L
  entry({ name: 'f2l-1', label: 'F2L 1', case: 'f2l:0b06', alg: "U R U' R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-2', label: 'F2L 2', case: 'f2l:0a01', alg: "F R' F' R", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-3', label: 'F2L 3', case: 'f2l:0b03', alg: "F' U' F", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-4', label: 'F2L 4', case: 'f2l:0a04', alg: "R U R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-5', label: 'F2L 5', case: 'f2l:0b04', alg: "U' R U R' U2 R U' R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-6', label: 'F2L 6', case: 'f2l:0a03', alg: "U' r U' R' U R U r'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-7', label: 'F2L 7', case: 'f2l:0b02', alg: "U' R U2 R' U' R U2 R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-8', label: 'F2L 8', case: 'f2l:0a05', alg: "r' U2 R2 U R2 U r", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-9', label: 'F2L 9', case: 'f2l:0b05', alg: "U' R U' R' U F' U' F", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-10', label: 'F2L 10', case: 'f2l:0a02', alg: "U' R U R' U R U R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-11', label: 'F2L 11', case: 'f2l:0b07', alg: "U' R U2 R' U F' U' F", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-12', label: 'F2L 12', case: 'f2l:0a00', alg: "R U' R' U R U' R' U2 R U' R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-13', label: 'F2L 13', case: 'f2l:0b01', alg: "y' U R' U R U' R' U' R y", sourceAlg: "y' U R' U R U' R' U' R", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-14', label: 'F2L 14', case: 'f2l:0a06', alg: "U' R U' R' U R U R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-15', label: 'F2L 15', case: 'f2l:0b00', alg: "M U r U' r' U' M'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-16', label: 'F2L 16', case: 'f2l:0a07', alg: "R U' R' U2 F' U' F", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-17', label: 'F2L 17', case: 'f2l:0906', alg: "R U2 R' U' R U R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-18', label: 'F2L 18', case: 'f2l:0901', alg: "y' R' U2 R U R' U' R y", sourceAlg: "y' R' U2 R U R' U' R", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-19', label: 'F2L 19', case: 'f2l:0904', alg: "U R U2 R' U R U' R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-20', label: 'F2L 20', case: 'f2l:0903', alg: "y' U' R' U2 R U' R' U R y", sourceAlg: "y' U' R' U2 R U' R' U R", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-21', label: 'F2L 21', case: 'f2l:0902', alg: "U2 R U R' U R U' R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-22', label: 'F2L 22', case: 'f2l:0905', alg: "r U' r' U2 r U r'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-23', label: 'F2L 23', case: 'f2l:0900', alg: "U R U' R' U' R U' R' U R U' R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-24', label: 'F2L 24', case: 'f2l:0907', alg: "F U R U' R' F' R U' R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-25', label: 'F2L 25', case: 'f2l:0c06', alg: "U' R' F R F' R U R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-26', label: 'F2L 26', case: 'f2l:0c07', alg: "U R U' R' F R' F' R", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-27', label: 'F2L 27', case: 'f2l:0d06', alg: "R U' R' U R U' R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-28', label: 'F2L 28', case: 'f2l:0e07', alg: "R U R' U' F R' F' R", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-29', label: 'F2L 29', case: 'f2l:0d07', alg: "R' F R F' U R U' R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-30', label: 'F2L 30', case: 'f2l:0e06', alg: "R U R' U' R U R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-31', label: 'F2L 31', case: 'f2l:0911', alg: "U' R' F R F' R U' R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-32', label: 'F2L 32', case: 'f2l:0910', alg: "U R U' R' U R U' R' U R U' R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-33', label: 'F2L 33', case: 'f2l:0b10', alg: "U' R U' R' U2 R U' R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-34', label: 'F2L 34', case: 'f2l:0a10', alg: "U R U R' U2 R U R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-35', label: 'F2L 35', case: 'f2l:0b11', alg: "U' R U R' U F' U' F", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-36', label: 'F2L 36', case: 'f2l:0a11', alg: "U F' U' F U' R U R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-37', label: 'F2L 37', case: 'f2l:0c11', alg: "R2 U2 F R2 F' U2 R' U R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-38', label: 'F2L 38', case: 'f2l:0d10', alg: "R U' R' U' R U R' U2 R U' R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-39', label: 'F2L 39', case: 'f2l:0e10', alg: "R U' R' U R U2 R' U R U' R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-40', label: 'F2L 40', case: 'f2l:0d11', alg: "r U' r' U2 r U r' R U R'", source: 'speedcubedb-f2l' }),
  entry({ name: 'f2l-41', label: 'F2L 41', case: 'f2l:0e11', alg: "R U' R' r U' r' U2 r U r'", source: 'speedcubedb-f2l' }),
  // OLL
  entry({ name: 'oll-1', label: 'OLL 1', nickname: "Runway", case: 'oll:12121111', alg: "R U2 R2 F R F' U2 R' F R F'", sourceAlg: "R U2 R' R' F R F' U2 R' F R F'", source: 'jperm-oll' }),
  entry({ name: 'oll-2', label: 'OLL 2', nickname: "Zamboni", case: 'oll:11221111', alg: "r U r' U2 r U2 R' U2 R U' r'", source: 'jperm-oll' }),
  entry({ name: 'oll-3', label: 'OLL 3', nickname: "Anti-Pinwheel", case: 'oll:02221111', alg: "r' R2 U R' U r U2 r' U M'", source: 'jperm-oll' }),
  entry({ name: 'oll-4', label: 'OLL 4', nickname: "Pinwheel", case: 'oll:01111111', alg: "M U' r U2 r' U' R U' R' M'", source: 'jperm-oll' }),
  entry({ name: 'oll-5', label: 'OLL 5', nickname: "Right back wide antisune (RBWAS)", case: 'oll:02220011', alg: "l' U2 L U L' U l", source: 'jperm-oll' }),
  entry({ name: 'oll-6', label: 'OLL 6', nickname: "Right front wide antisune (RFWAS)", case: 'oll:01110011', alg: "r U2 R' U' R U' r'", source: 'jperm-oll' }),
  entry({ name: 'oll-7', label: 'OLL 7', nickname: "Lightning", case: 'oll:02221001', alg: "r U R' U R U2 r'", source: 'jperm-oll' }),
  entry({ name: 'oll-8', label: 'OLL 8', nickname: "Wide Left Sune", case: 'oll:01110110', alg: "l' U' L U' L' U2 l", source: 'jperm-oll' }),
  entry({ name: 'oll-9', label: 'OLL 9', nickname: "Kite", case: 'oll:01111100', alg: "R U R' U' R' F R2 U R' U' F'", source: 'jperm-oll' }),
  entry({ name: 'oll-10', label: 'OLL 10', nickname: "Anti-Kite", case: 'oll:02221100', alg: "R U R' U R' F R F' R U2 R'", source: 'jperm-oll' }),
  entry({ name: 'oll-11', label: 'OLL 11', nickname: "Downstairs", case: 'oll:02220110', alg: "r U R' U R' F R F' R U2 r'", source: 'jperm-oll' }),
  entry({ name: 'oll-12', label: 'OLL 12', nickname: "Upstairs", case: 'oll:01111001', alg: "M' R' U' R U' R' U2 R U' R r'", source: 'jperm-oll' }),
  entry({ name: 'oll-13', label: 'OLL 13', nickname: "Gun", case: 'oll:02221010', alg: "F U R U' R2 F' R U R U' R'", source: 'jperm-oll' }),
  entry({ name: 'oll-14', label: 'OLL 14', nickname: "Anti-Gun", case: 'oll:01110101', alg: "R' F R U R' F' R F U' F'", source: 'jperm-oll' }),
  entry({ name: 'oll-15', label: 'OLL 15', nickname: "Squeegee", case: 'oll:02220101', alg: "l' U' l L' U' L U l' U l", source: 'jperm-oll' }),
  entry({ name: 'oll-16', label: 'OLL 16', nickname: "Anti-Squeegee", case: 'oll:01111010', alg: "r U r' R U R' U' r U' r'", source: 'jperm-oll' }),
  entry({ name: 'oll-17', label: 'OLL 17', nickname: "Slash", case: 'oll:01021111', alg: "F R' F' R2 r' U R U' R' U' M'", source: 'jperm-oll' }),
  entry({ name: 'oll-18', label: 'OLL 18', nickname: "Crown", case: 'oll:00211111', alg: "r U R' U R U2 r2 U' R U' R' U2 r", sourceAlg: "r U R' U R U2 r' r' U' R U' R' U2 r", source: 'jperm-oll' }),
  entry({ name: 'oll-19', label: 'OLL 19', nickname: "Bunny", case: 'oll:00121111', alg: "r' R U R U R' U' M' R' F R F'", source: 'jperm-oll' }),
  entry({ name: 'oll-20', label: 'OLL 20', nickname: "X", case: 'oll:00001111', alg: "r U R' U' M2 U R U' R' U' M'", source: 'jperm-oll' }),
  entry({ name: 'oll-21', label: 'OLL 21', nickname: "H", case: 'oll:12120000', alg: "R U2 R' U' R U R' U' R U' R'", source: 'jperm-oll' }),
  entry({ name: 'oll-22', label: 'OLL 22', nickname: "Pi", case: 'oll:11220000', alg: "R U2 R2 U' R2 U' R2 U2 R", source: 'jperm-oll' }),
  entry({ name: 'oll-23', label: 'OLL 23', nickname: "U", case: 'oll:00210000', alg: "R2 D' R U2 R' D R U2 R", source: 'jperm-oll' }),
  entry({ name: 'oll-24', label: 'OLL 24', nickname: "T", case: 'oll:00120000', alg: "r U R' U' r' F R F'", source: 'jperm-oll' }),
  entry({ name: 'oll-25', label: 'OLL 25', nickname: "L", case: 'oll:01020000', alg: "F' r U R' U' r' F R", source: 'jperm-oll' }),
  entry({ name: 'oll-26', label: 'OLL 26', nickname: "Antisune", case: 'oll:01110000', alg: "R U2 R' U' R U' R'", source: 'jperm-oll' }),
  entry({ name: 'oll-27', label: 'OLL 27', nickname: "Sune", case: 'oll:02220000', alg: "R U R' U R U2 R'", source: 'jperm-oll' }),
  entry({ name: 'oll-28', label: 'OLL 28', nickname: "Stealth", case: 'oll:00000011', alg: "r U R' U' r' R U R U' R'", source: 'jperm-oll' }),
  entry({ name: 'oll-29', label: 'OLL 29', nickname: "Spotted Chameleon", case: 'oll:00120110', alg: "R U R' U' R U' R' F' U' F R U R'", source: 'jperm-oll' }),
  entry({ name: 'oll-30', label: 'OLL 30', nickname: "Anti-Spotted Chameleon", case: 'oll:00121100', alg: "F R' F R2 U' R' U' R U R' F2", source: 'jperm-oll' }),
  entry({ name: 'oll-31', label: 'OLL 31', nickname: "Couch", case: 'oll:00120011', alg: "R' U' F U R U' R' F' R", source: 'jperm-oll' }),
  entry({ name: 'oll-32', label: 'OLL 32', nickname: "Anti-Couch", case: 'oll:00121001', alg: "L U F' U' L' U L F L'", source: 'jperm-oll' }),
  entry({ name: 'oll-33', label: 'OLL 33', nickname: "Tying Shoelaces", case: 'oll:00121010', alg: "R U R' U' R' F R F'", source: 'jperm-oll' }),
  entry({ name: 'oll-34', label: 'OLL 34', nickname: "City (C and T)", case: 'oll:00120101', alg: "R U R2 U' R' F R U R U' F'", source: 'jperm-oll' }),
  entry({ name: 'oll-35', label: 'OLL 35', nickname: "Fish Salad", case: 'oll:01020011', alg: "R U2 R2 F R F' R U2 R'", sourceAlg: "R U2 R' R' F R F' R U2 R'", source: 'jperm-oll' }),
  entry({ name: 'oll-36', label: 'OLL 36', nickname: "Sea-Mew", case: 'oll:01021001', alg: "L' U' L U' L' U L U L F' L' F", source: 'jperm-oll' }),
  entry({ name: 'oll-37', label: 'OLL 37', nickname: "Mounted Fish", case: 'oll:01021100', alg: "F R' F' R U R U' R'", source: 'jperm-oll' }),
  entry({ name: 'oll-38', label: 'OLL 38', nickname: "Mario", case: 'oll:01020110', alg: "R U R' U R U' R' U' R' F R F'", source: 'jperm-oll' }),
  entry({ name: 'oll-39', label: 'OLL 39', nickname: "Fung", case: 'oll:01021010', alg: "L F' L' U' L U F U' L'", source: 'jperm-oll' }),
  entry({ name: 'oll-40', label: 'OLL 40', nickname: "Anti-Fung", case: 'oll:01020101', alg: "R' F R U R' U' F' U R", source: 'jperm-oll' }),
  entry({ name: 'oll-41', label: 'OLL 41', nickname: "Awkward Fish", case: 'oll:00211100', alg: "R U R' U R U2 R' F R U R' U' F'", source: 'jperm-oll' }),
  entry({ name: 'oll-42', label: 'OLL 42', nickname: "Lefty Awkward Fish", case: 'oll:00210110', alg: "R' U' R U' R' U2 R F R U R' U' F'", source: 'jperm-oll' }),
  entry({ name: 'oll-43', label: 'OLL 43', nickname: "Anti-P", case: 'oll:00210011', alg: "F' U' L' U L F", source: 'jperm-oll' }),
  entry({ name: 'oll-44', label: 'OLL 44', nickname: "P", case: 'oll:00211001', alg: "F U R U' R' F'", source: 'jperm-oll' }),
  entry({ name: 'oll-45', label: 'OLL 45', nickname: "Suit up", case: 'oll:00211010', alg: "F R U R' U' F'", source: 'jperm-oll' }),
  entry({ name: 'oll-46', label: 'OLL 46', nickname: "Seein' Headlights (C and headlights)", case: 'oll:00210101', alg: "R' U' R' F R F' U R", source: 'jperm-oll' }),
  entry({ name: 'oll-47', label: 'OLL 47', nickname: "Anti-Breakneck", case: 'oll:11220110', alg: "R' U' R' F R F' R' F R F' U R", source: 'jperm-oll' }),
  entry({ name: 'oll-48', label: 'OLL 48', nickname: "Breakneck", case: 'oll:11220011', alg: "F R U R' U' R U R' U' F'", source: 'jperm-oll' }),
  entry({ name: 'oll-49', label: 'OLL 49', nickname: "Right back squeezy", case: 'oll:11221001', alg: "r U' r2 U r2 U r2 U' r", source: 'jperm-oll' }),
  entry({ name: 'oll-50', label: 'OLL 50', nickname: "Right front squeezy", case: 'oll:11221100', alg: "r' U r2 U' r2 U' r2 U r'", source: 'jperm-oll' }),
  entry({ name: 'oll-51', label: 'OLL 51', nickname: "Bottlecap", case: 'oll:11220101', alg: "F U R U' R' U R U' R' F'", source: 'jperm-oll' }),
  entry({ name: 'oll-52', label: 'OLL 52', nickname: "Rice Cooker", case: 'oll:11221010', alg: "R U R' U R U' B U' B' R'", source: 'jperm-oll' }),
  entry({ name: 'oll-53', label: 'OLL 53', nickname: "Frying Pan", case: 'oll:12120011', alg: "l' U2 L U L' U' L U L' U l", source: 'jperm-oll' }),
  entry({ name: 'oll-54', label: 'OLL 54', nickname: "Anti-Frying Pan", case: 'oll:12120110', alg: "r U2 R' U' R U R' U' R U' r'", source: 'jperm-oll' }),
  entry({ name: 'oll-55', label: 'OLL 55', nickname: "Highway", case: 'oll:12121010', alg: "R' F R U R U' R2 F' R2 U' R' U R U R'", source: 'jperm-oll' }),
  entry({ name: 'oll-56', label: 'OLL 56', nickname: "Streetlights", case: 'oll:12120101', alg: "r' U' r U' R' U R U' R' U R r' U r", source: 'jperm-oll' }),
  entry({ name: 'oll-57', label: 'OLL 57', nickname: "Mummy", case: 'oll:00000101', alg: "R U R' U' M' U R U' r'", source: 'jperm-oll' }),
  // PLL
  entry({ name: 'pll-Aa', label: 'Aa', case: 'pll:01323012', alg: "x L2 D2 L' U' L D2 L' U L' x'", sourceAlg: "x L2 D2 L' U' L D2 L' U L'", source: 'jperm-pll' }),
  entry({ name: 'pll-Ab', label: 'Ab', case: 'pll:01321230', alg: "x' L2 D2 L U L' D2 L U' L x", sourceAlg: "x' L2 D2 L U L' D2 L U' L", source: 'jperm-pll' }),
  entry({ name: 'pll-E', label: 'E', case: 'pll:03211230', alg: "x' L' U L D' L' U' L D L' U' L D' L' U L D x", sourceAlg: "x' L' U L D' L' U' L D L' U' L D' L' U L D", source: 'jperm-pll' }),
  entry({ name: 'pll-F', label: 'F', case: 'pll:01322103', alg: "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R", source: 'jperm-pll' }),
  entry({ name: 'pll-Ga', label: 'Ga', case: 'pll:01323201', alg: "R2 U R' U R' U' R U' R2 U' D R' U R D'", source: 'jperm-pll' }),
  entry({ name: 'pll-Gb', label: 'Gb', case: 'pll:01322310', alg: "R' U' R U D' R2 U R' U R U' R U' R2 D", source: 'jperm-pll' }),
  entry({ name: 'pll-Gc', label: 'Gc', case: 'pll:01322031', alg: "R2 U' R U' R U R' U R2 U D' R U' R' D", source: 'jperm-pll' }),
  entry({ name: 'pll-Gd', label: 'Gd', case: 'pll:01321302', alg: "R U R' U' D R2 U' R U' R' U R' U R2 D'", source: 'jperm-pll' }),
  entry({ name: 'pll-H', label: 'H', case: 'pll:01232301', alg: "M2 U M2 U2 M2 U M2", source: 'jperm-pll' }),
  entry({ name: 'pll-Ja', label: 'Ja', case: 'pll:01320132', alg: "x R2 F R F' R U2 r' U r U2 x'", sourceAlg: "x R2 F R F' R U2 r' U r U2", source: 'jperm-pll' }),
  entry({ name: 'pll-Jb', label: 'Jb', case: 'pll:01323120', alg: "R U R' F' R U R' U' R' F R2 U' R'", source: 'jperm-pll' }),
  entry({ name: 'pll-Na', label: 'Na', case: 'pll:03212103', alg: "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'", source: 'jperm-pll' }),
  entry({ name: 'pll-Nb', label: 'Nb', case: 'pll:03210321', alg: "R' U R U' R' F' U' F R U R' F R' F' R U' R", source: 'jperm-pll' }),
  entry({ name: 'pll-Ra', label: 'Ra', case: 'pll:01320213', alg: "R U' R' U' R U R D R' U' R D' R' U2 R'", source: 'jperm-pll' }),
  entry({ name: 'pll-Rb', label: 'Rb', case: 'pll:01321023', alg: "R2 F R U R U' R' F' R U2 R' U2 R", source: 'jperm-pll' }),
  entry({ name: 'pll-T', label: 'T', case: 'pll:01320321', alg: "R U R' U' R' F R2 U' R' U' R U R' F'", source: 'jperm-pll' }),
  entry({ name: 'pll-Ua', label: 'Ua', case: 'pll:01230312', alg: "M2 U M U2 M' U M2", source: 'jperm-pll' }),
  entry({ name: 'pll-Ub', label: 'Ub', case: 'pll:01230231', alg: "M2 U' M U2 M' U' M2", source: 'jperm-pll' }),
  entry({ name: 'pll-V', label: 'V', case: 'pll:03210132', alg: "R' U R' U' y R' F' R2 U' R' U R' F R F y'", sourceAlg: "R' U R' U' y R' F' R2 U' R' U R' F R F", source: 'jperm-pll' }),
  entry({ name: 'pll-Y', label: 'Y', case: 'pll:03210213', alg: "F R U' R' U' R U R' F' R U R' U' R' F R F'", source: 'jperm-pll' }),
  entry({ name: 'pll-Z', label: 'Z', case: 'pll:01231032', alg: "M' U M2 U M2 U M' U2 M2", source: 'jperm-pll' }),
]);

/** One set's rows, in the community's own numbering order. */
const humanSet = (set) => HUMAN_ALGS.filter((row) => row.name.startsWith(`${set}-`));

/** The full OLL, PLL and F2L tables, in the shape the method solver's repertoires take. */
export const HUMAN_F2L = Object.freeze(humanSet('f2l'));
export const HUMAN_OLL = Object.freeze(humanSet('oll'));
export const HUMAN_PLL = Object.freeze(humanSet('pll'));
