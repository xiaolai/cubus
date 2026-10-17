// The pattern ledger. GENERATED — do not hand-edit.
//
//   regenerate: node apps/web/bench/pattern-ledger.mjs 7 6 --emit
//   re-verify:  node --test apps/web/test/pattern-ledger.test.mjs
//
// Every picture fixed by at least 4 of the 24 whole-cube rotations, with no piece twisted,
// that is within 7 FACE TURNS of solved or within 6 moves when a middle-layer turn (M, E, S)
// counts as one — which is what "pretty" means once it is made mechanical, and is the property a
// checkerboard, a ring of dots and a cube-in-a-cube all share. Both walks were exhaustive for their
// radius, so a row's `moves` and `sliceMoves` are proved minima and not best efforts.
//
// TWO METRICS, because a slice is one movement of a hand and two face turns to the pieces. `moves` and
// `alg` are in face turns — the half-turn metric every solver here speaks — and null when no
// untwisted face-turn route lies within 7. `sliceMoves` and `sliceAlg` count a slice as one, and
// `sliceAlg` is spelled as a child performs it, each letter read in the hold the moves before it left;
// null when no untwisted route lies within 6. Six Spots is the reason: `M E M' E'`, four moves,
// and eight face turns, so the face walk alone never saw it.
//
// THREE CUTS, AND ALL ARE PART OF THE CLAIM.
//
// ORDER. Pictures fixed by fewer than 4 of the 24 are found and COUNTED and not kept — at depth
// 7 there are over a hundred thousand such maneuvers at order 2 alone, and a ledger of them is a
// database rather than a list. So this file is complete for order 4 and above within both radii,
// and says nothing about lower orders except for the book's rows below.
//
// TWIST. 64 of the 213 pictures the face walk finds above the order cut, and
// 216 of the 623 the slice walk finds, cannot be reached inside the radius
// without a piece twisted against the others, and are cut (owner's call, 2026-09-12). A permuted piece
// reads as design, because the whole piece moved; a twisted corner shows ONE sticker of the wrong colour
// inside an otherwise clean block, and a child cannot tell that from a misscramble. "Twisted" is
// `untwisted` in bench/cube-look.mjs: no turn of the whole SHELL leaves every piece oriented. It read
// "oriented against the centres" until 2026-10-17, which cut Six Spots — a solved shell turned against
// its centres — though nothing on it looks twisted.
//
// The cut is on ROUTES and not on pictures: `canonicalLook` renames colours as it rotates, so two
// maneuvers can reach one look and disagree about whether a piece is twisted, and a look is kept when
// SOME route to it is clean. `moves` is therefore the proved minimum among untwisted routes, which could
// in principle be longer than the proved minimum over all routes. Measured: for every picture kept here it is
// not — the shortest route to a picture that can be reached straight at all is already a straight one.
//
// RADIUS. Within the two above. EXCEPT THE BOOK: a famous picture (`name`, with the route a book prints
// as `book`) is kept whatever its order and distance, provided its book route twists nothing — the radius
// and the order cut keep a SEARCH's output a catalogue, and a hand-named list of fourteen does not
// threaten that (owner's call, 2026-10-17). A row reached by neither walk has `moves` and `sliceMoves`
// null: its distance is not proved, and a book's route is not a minimum.
//
// `look` is the canonical facelet string: the smallest of the picture's 24 views, so two cubes that
// are the same picture held differently are one entry. `order` is how many views leave it unchanged.
// `order`, `figures`, `wrong` and `blank` are measured on the cube the row's FIRST route reaches —
// `alg` when there is one, then `sliceAlg`, then `book`. `variants` are the family's other face-turn
// routes.
//
// The solved cube is deliberately absent. It is order 24 at zero moves and it is what patterns are
// measured FROM, not one of them.
//
// SET patterns are not in here and cannot be: they are defined by what they leave free rather than by
// a cube, so no walk reaches them. They live in `SET_PATTERNS` below, with their sizes derived.

export const LEDGER_DEPTH = 7;
export const SLICE_DEPTH = 6;

export const STATE_PATTERNS = Object.freeze([
  { look: "UDUDUDUDURLRLRLRLRFBFBFBFBFDUDUDUDUDLRLRLRLRLBFBFBFBFB", order: 24, moves: 6, alg: "D2 U2 L2 R2 B2 F2", sliceMoves: 3, sliceAlg: "M2 E2 S2", wrong: 24, blank: 0, designs: 1, variants: [], figures: [341,341,341,341,341,341], name: "The Checkerboard", book: "U2 D2 F2 B2 L2 R2" },
  { look: "UDUUUUUDURLRRRRRLRFFFBFBFFFDUDDDDDUDLRLLLLLRLBBBFBFBBB", order: 12, moves: null, alg: null, sliceMoves: null, sliceAlg: null, wrong: 12, blank: 0, designs: 1, variants: [], figures: [381,381,381,381,381,381], name: "Hello!", book: "U2 R2 F2 U2 D2 F2 L2 U2" },
  { look: "BUFBUFBUFRRRRRRRRRUFDUFDUFDFDBFDBFDBLLLLLLLLLUBDUBDUBD", order: 8, moves: 2, alg: "D U", sliceMoves: 2, sliceAlg: "D U", wrong: 24, blank: 2, designs: 1, variants: ["D' U'"], figures: [511,56,56,511,56,56] },
  { look: "DDDUUUDDDLRLLRLLRLFFFFFFFFFUUUDDDUUURLRRLRRLRBBBBBBBBB", order: 8, moves: 2, alg: "D2 U2", sliceMoves: 1, sliceAlg: "M2", wrong: 24, blank: 2, designs: 1, variants: [], figures: [511,56,56,511,56,56] },
  { look: "DDDUUUDDDRLRLRLRLRBBBFFFBBBUUUDDDUUULRLRLRLRLFFFBBBFFF", order: 8, moves: 4, alg: "D2 U2 L2 R2", sliceMoves: 2, sliceAlg: "M2 E2", wrong: 32, blank: 0, designs: 1, variants: [], figures: [56,56,341,56,56,341] },
  { look: "FDBFUBFDBRLRLRLRLRDBUDFUDBUBUFBDFBUFLRLRLRLRLDFUDBUDFU", order: 8, moves: 6, alg: "D U L2 R2 B2 F2", sliceMoves: 4, sliceAlg: "U2 M2 S2 E'", wrong: 40, blank: 0, designs: 2, variants: ["D' U' L2 R2 B2 F2","L2 R2 B2 F2 D U","L2 R2 B2 F2 D' U'"], figures: [341,16,16,341,16,16] },
  { look: "FDBUUUFDBRLRLRLRLRDBUFFFDBUBUFDDDBUFLRLRLRLRLDFUBBBDFU", order: 8, moves: 6, alg: "U L2 R2 B2 F2 D", sliceMoves: 4, sliceAlg: "U M2 S2 D", wrong: 32, blank: 0, designs: 1, variants: ["U' L2 R2 B2 F2 D'"], figures: [341,56,56,341,56,56] },
  { look: "DDDFUBDDDRLRLRLRLRBBBDFUBBBUUUBDFUUULRLRLRLRLFFFDBUFFF", order: 8, moves: 6, alg: "U L2 R2 B2 F2 U'", sliceMoves: 4, sliceAlg: "U M2 S2 U'", wrong: 40, blank: 0, designs: 1, variants: ["U' L2 R2 B2 F2 U"], figures: [341,16,16,341,16,16] },
  { look: "UDUDUDUDURRRLRLRRRFFFBFBFFFDUDUDUDUDLLLRLRLLLBBBFBFBBB", order: 8, moves: 6, alg: "U2 L2 R2 B2 F2 D2", sliceMoves: 4, sliceAlg: "U2 M2 S2 D2", wrong: 16, blank: 0, designs: 1, variants: [], figures: [341,381,381,341,381,381] },
  { look: "DDDDUDDDDLLLLRLLLLFBFBFBFBFUUUUDUUUURRRRLRRRRBFBFBFBFB", order: 8, moves: 6, alg: "U2 L2 R2 B2 F2 U2", sliceMoves: 4, sliceAlg: "U2 M2 S2 U2", wrong: 40, blank: 0, designs: 1, variants: [], figures: [341,16,16,341,16,16] },
  { look: "DDDUUUDDDRRRRRRRRRBBBFFFBBBUUUDDDUUULLLLLLLLLFFFBBBFFF", order: 8, moves: 6, alg: "U2 R2 D2 U2 R2 D2", sliceMoves: 5, sliceAlg: "U2 R2 E2 L2 D2", wrong: 24, blank: 2, designs: 1, variants: [], figures: [56,56,511,56,56,511] },
  { look: "BUFFUBBUFRLRLRLRLRUFDDFUUFDFDBBDFFDBLRLRLRLRLUBDDBUUBD", order: 8, moves: 7, alg: "L2 R2 D U' L2 R2 D2", sliceMoves: 4, sliceAlg: "M2 E' S2 U2", wrong: 32, blank: 0, designs: 2, variants: ["L2 R2 D U' L2 R2 U2","U2 L2 R2 D U' L2 R2","U2 L2 R2 D' U L2 R2"], figures: [341,56,56,341,56,56] },
  { look: "BDFDUDBDFRLRLRLRLRUBDBFBUBDFUBUDUFUBLRLRLRLRLUFDFBFUFD", order: 8, moves: 7, alg: "U L2 R2 B2 F2 D' U2", sliceMoves: 5, sliceAlg: "U M2 E2 S2 D", wrong: 40, blank: 0, designs: 1, variants: ["U' L2 R2 B2 F2 D U2"], figures: [341,16,16,341,16,16] },
  { look: "UDUBUFUDURLRLRLRLRFBFUFDFBFDUDFDBDUDLRLRLRLRLBFBUBDBFB", order: 8, moves: 7, alg: "U L2 R2 B2 F2 D2 U", sliceMoves: 5, sliceAlg: "U M2 E2 S2 U'", wrong: 24, blank: 0, designs: 1, variants: ["U' L2 R2 B2 F2 D2 U'"], figures: [341,341,341,341,341,341] },
  { look: "BDFBUFBDFRRRRRRRRRUBDUFDUBDFUBFDBFUBLLLLLLLLLUFDUBDUFD", order: 8, moves: 7, alg: "U2 L2 R2 D U' B2 F2", sliceMoves: 4, sliceAlg: "U2 M2 E M2", wrong: 32, blank: 2, designs: 1, variants: ["U2 L2 R2 D' U B2 F2"], figures: [511,16,16,511,16,16] },
  { look: "DDDDUDDDDLRRRRRRRLBFFFFFFFBUUUUDUUUURLLLLLLLRFBBBBBBBF", order: 8, moves: null, alg: null, sliceMoves: null, sliceAlg: null, wrong: 24, blank: 0, designs: 1, variants: [], figures: [16,254,254,16,254,254], name: "Opposite Corners", book: "R L U2 F2 D2 F2 R L F2 D2 B2 D2" },
  { look: "DUDUUUDUDLRLRRRLRLFBFBFBFBFUDUDDDUDURLRLLLRLRBFBFBFBFB", order: 8, moves: null, alg: null, sliceMoves: 4, sliceAlg: "M S2 M E2", wrong: 24, blank: 0, designs: 1, variants: [], figures: [186,341,186,186,341,186] },
  { look: "UDUUUUUDURRRRRRRRRFBFFFFFBFDUDDDDDUDLLLLLLLLLBFBBBBBFB", order: 8, moves: null, alg: null, sliceMoves: 4, sliceAlg: "M S2 M S2", wrong: 8, blank: 2, designs: 1, variants: [], figures: [381,511,381,381,511,381] },
  { look: "UDUDUDUDURLRRRRRLRFBFFFFFBFDUDUDUDUDLRLLLLLRLBFBBBBBFB", order: 8, moves: null, alg: null, sliceMoves: 4, sliceAlg: "M S2 M' E2", wrong: 16, blank: 0, designs: 1, variants: [], figures: [381,341,381,381,341,381] },
  { look: "DDDDUDDDDLLLLRLLLLFFFFFFFFFUUUUDUUUURRRRLRRRRBBBBBBBBB", order: 8, moves: null, alg: null, sliceMoves: 4, sliceAlg: "M S2 M' S2", wrong: 32, blank: 2, designs: 1, variants: [], figures: [16,511,16,16,511,16] },
  { look: "DLDUUUDRDLRLDRULRLFBFBFBFBFULUDDDURURLRDLURLRBFBFBFBFB", order: 8, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U M2 E S2 D'", wrong: 32, blank: 0, designs: 1, variants: [], figures: [341,56,56,341,56,56] },
  { look: "FUBUUUFUBRLRLRLRLRDFUFFFDFUBDFDDDBDFLRLRLRLRLDBUBBBDBU", order: 8, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U M2 E S2 U", wrong: 24, blank: 0, designs: 1, variants: [], figures: [341,186,186,341,186,186] },
  { look: "UDUDUDUDURBRRRRRFRFRFFFFFLFDUDUDUDUDLFLLLLLBLBLBBBBBRB", order: 8, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U M2 E' S2 D'", wrong: 16, blank: 0, designs: 1, variants: [], figures: [341,381,381,341,381,381] },
  { look: "BUFDUDBUFRLRLRLRLRUFDBFBUFDFDBUDUFDBLRLRLRLRLUBDFBFUBD", order: 8, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U M2 E' S2 U", wrong: 32, blank: 0, designs: 1, variants: [], figures: [341,56,56,341,56,56] },
  { look: "BDFFUBBDFRRRRRRRRRUBDDFUUBDFUBBDFFUBLLLLLLLLLUFDDBUUFD", order: 8, moves: null, alg: null, sliceMoves: 6, sliceAlg: "M2 E' S2 D2 S2 M2", wrong: 32, blank: 2, designs: 1, variants: [], figures: [511,16,16,511,16,16] },
  { look: "FUBBUFFUBRRRRRRRRRDFUUFDDFUBDFFDBBDFLLLLLLLLLDBUUBDDBU", order: 8, moves: null, alg: null, sliceMoves: 6, sliceAlg: "M2 S2 U2 M2 S2 E", wrong: 24, blank: 2, designs: 1, variants: [], figures: [511,56,56,511,56,56] },
  { look: "BUFUUUBUFRRRRRRRRRUFDFFFUFDFDBDDDFDBLLLLLLLLLUBDBBBUBD", order: 8, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 S2 D M2 S2", wrong: 16, blank: 2, designs: 1, variants: [], figures: [511,186,186,511,186,186] },
  { look: "URUUUUULURRRURDRRRFFFFFFFFFDRDDDDDLDLLLULDLLLBBBBBBBBB", order: 8, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 S2 U' M2 S2", wrong: 8, blank: 2, designs: 1, variants: [], figures: [511,381,381,511,381,381] },
  { look: "DDDUUUDDDLRLLRLLRLFBFBFBFBFUUUDDDUUURLRRLRRLRBFBFBFBFB", order: 8, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 M2 E' S2 D U", wrong: 32, blank: 0, designs: 1, variants: [], figures: [341,56,56,341,56,56] },
  { look: "DUDUUUDUDLRLRRRLRLFFFFFFFFFUDUDDDUDURLRLLLRLRBBBBBBBBB", order: 8, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 M2 S2 D2 M2 S2", wrong: 16, blank: 2, designs: 1, variants: [], figures: [511,186,186,511,186,186] },
  { look: "UDUUUUUDURRRLRLRRRFFFFFFFFFDUDDDDDUDLLLRLRLLLBBBBBBBBB", order: 8, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 M2 S2 U2 M2 S2", wrong: 8, blank: 2, designs: 1, variants: [], figures: [511,381,381,511,381,381] },
  { look: "UDUDUDUDURLRLRLRLRFFFFFFFFFDUDUDUDUDLRLRLRLRLBBBBBBBBB", order: 8, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 R2 E2 L2 D2 S2", wrong: 16, blank: 2, designs: 1, variants: [], figures: [341,341,511,341,341,511] },
  { look: "UDUDUDUDURRRRRRRRRFFFFFFFFFDUDUDUDUDLLLLLLLLLBBBBBBBBB", order: 8, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 R2 E2 L2 U2 M2", wrong: 8, blank: 4, designs: 1, variants: [], figures: [511,511,341,511,511,341] },
  { look: "BUUBUUBUURRRRRRRRRUFFUFFUFFFDDFDDFDDLLLLLLLLLBBDBBDBBD", order: 4, moves: 1, alg: "U", sliceMoves: 1, sliceAlg: "U", wrong: 12, blank: 2, designs: 1, variants: ["U'"], figures: [511,63,63,511,63,63] },
  { look: "DDDUUUUUURRLRRLRRLFFFFFFFFFDDDDDDUUURLLRLLRLLBBBBBBBBB", order: 4, moves: 1, alg: "U2", sliceMoves: 1, sliceAlg: "U2", wrong: 12, blank: 2, designs: 1, variants: [], figures: [511,63,63,511,63,63] },
  { look: "BUBBUBBUBRRRRRRRRRUFUUFUUFUFDFFDFFDFLLLLLLLLLDBDDBDDBD", order: 4, moves: 2, alg: "D U'", sliceMoves: 1, sliceAlg: "E", wrong: 24, blank: 2, designs: 1, variants: [], figures: [511,56,56,511,56,56] },
  { look: "BUDBUDBUDRRRRRRRRRUFBUFBUFBFDUFDUFDULLLLLLLLLFBDFBDFBD", order: 4, moves: 2, alg: "D U2", sliceMoves: 2, sliceAlg: "D U2", wrong: 24, blank: 2, designs: 1, variants: ["D2 U'"], figures: [511,56,56,511,56,56] },
  { look: "BDFBUFBDFLRLLRLLRLDFUDFUDFUFUBFDBFUBRLRRLRRLRDBUDBUDBU", order: 4, moves: 4, alg: "D U L2 R2", sliceMoves: 3, sliceAlg: "D U M2", wrong: 40, blank: 0, designs: 2, variants: ["D' U' L2 R2","L2 R2 D U","L2 R2 D' U'"], figures: [56,56,16,56,56,16] },
  { look: "DDDDUDDDDLRLLRLLRLFFFFFFFFFUUUUDUUUURLRRLRRLRBBBBBBBBB", order: 4, moves: 4, alg: "U2 L2 R2 D2", sliceMoves: 3, sliceAlg: "U2 M2 U2", wrong: 28, blank: 2, designs: 1, variants: [], figures: [56,511,16,56,511,16] },
  { look: "DDDUUUDDDRLRRRRRLRBBBFFFBBBUUUDDDUUULRLLLLLRLFFFBBBFFF", order: 4, moves: 4, alg: "U2 L2 R2 U2", sliceMoves: 3, sliceAlg: "U2 M2 D2", wrong: 28, blank: 0, designs: 1, variants: [], figures: [56,56,381,56,56,381] },
  { look: "BDFFUBBDFLRLLRLLRLDFUDFUDFUFUBBDFFUBRLRRLRRLRDBUDBUDBU", order: 4, moves: 5, alg: "D U' L2 R2 D2", sliceMoves: 3, sliceAlg: "E S2 D2", wrong: 40, blank: 0, designs: 2, variants: ["D U' L2 R2 U2","U2 L2 R2 D U'","U2 L2 R2 D' U"], figures: [56,56,16,56,56,16] },
  { look: "DDUUUDDDURLRLRLRLRBBFFFBBBFUUDDDUUUDLRLRLRLRLBFFFBBBFF", order: 4, moves: 5, alg: "D2 U2 L2 R2 F2", sliceMoves: 3, sliceAlg: "M2 E2 F2", wrong: 28, blank: 0, designs: 2, variants: ["U2 L2 R2 B2 F2"], figures: [113,113,341,113,113,341] },
  { look: "DDBUUFDDBRLRLRLRLRBBUFFDBBUUUFDDBUUFLRLRLRLRLDFFUBBDFF", order: 4, moves: 5, alg: "L2 R2 B2 F2 U", sliceMoves: 3, sliceAlg: "M2 S2 U", wrong: 36, blank: 0, designs: 2, variants: ["L2 R2 B2 F2 U'","U L2 R2 B2 F2","U' L2 R2 B2 F2"], figures: [341,18,18,341,18,18] },
  { look: "DDDUUUDDDLRLRRRLRLFFFFFFFFFUUUDDDUUURLRLLLRLRBBBBBBBBB", order: 4, moves: 6, alg: "U2 L2 R2 U2 L2 R2", sliceMoves: 4, sliceAlg: "U2 M2 D2 M2", wrong: 20, blank: 2, designs: 1, variants: [], figures: [511,56,186,511,56,186], name: "Plus/Minus", book: "U2 R2 L2 U2 R2 L2" },
  { look: "DDDUUUDDDLLLRRRLLLFFFFFFFFFUUUDDDUUURRRLLLRRRBBBBBBBBB", order: 4, moves: 6, alg: "U2 R2 D2 U2 R2 U2", sliceMoves: 5, sliceAlg: "U2 R2 E2 L2 U2", wrong: 24, blank: 2, designs: 1, variants: [], figures: [56,511,56,56,511,56], name: "Lines", book: "R2 U2 R2 U2 R2 U2 L2 D2 L2 D2 L2 D2 L2 R2" },
  { look: "DDDUUUDDDLLLRRRLLLFFFBFBFFFUUUDDDUUURRRLLLRRRBBBFBFBBB", order: 4, moves: 6, alg: "D U L2 R2 D U", sliceMoves: 5, sliceAlg: "D U M2 U D", wrong: 28, blank: 0, designs: 1, variants: [], figures: [56,56,381,56,56,381] },
  { look: "DDDDUDDDDLLLRRRLLLFFFFFFFFFUUUUDUUUURRRLLLRRRBBBBBBBBB", order: 4, moves: 6, alg: "D U L2 R2 D' U'", sliceMoves: 5, sliceAlg: "D U M2 U' D'", wrong: 28, blank: 2, designs: 1, variants: [], figures: [56,511,16,56,511,16] },
  { look: "BDFFUBBDFLLLLRLLLLDFUDFUDFUFUBBDFFUBRRRRLRRRRDBUDBUDBU", order: 4, moves: 6, alg: "D U R2 B2 F2 L2", sliceMoves: 5, sliceAlg: "D U R2 S2 R2", wrong: 44, blank: 0, designs: 2, variants: ["D' U' R2 B2 F2 L2","R2 B2 F2 L2 D U","R2 B2 F2 L2 D' U'"], figures: [16,16,56,16,16,56] },
  { look: "FDBBUFFDBRRRLRLRRRDBUDFUDBUBUFFDBBUFLLLRLRLLLDFUDBUDFU", order: 4, moves: 6, alg: "D U R2 B2 F2 R2", sliceMoves: 5, sliceAlg: "U2 R2 S2 L2 E", wrong: 36, blank: 0, designs: 2, variants: ["D' U' R2 B2 F2 R2","R2 B2 F2 R2 D U","R2 B2 F2 R2 D' U'"], figures: [381,16,16,381,16,16] },
  { look: "BUFBUFBUFLLLRRRLLLDFUDFUDFUFDBFDBFDBRRRLLLRRRDBUDBUDBU", order: 4, moves: 6, alg: "D U R2 D2 U2 R2", sliceMoves: 5, sliceAlg: "U2 R2 E2 L2 E'", wrong: 36, blank: 0, designs: 2, variants: ["D' U' R2 D2 U2 R2","R2 D2 U2 R2 D U","R2 D2 U2 R2 D' U'"], figures: [56,56,56,56,56,56] },
  { look: "BDBFUFBDBRLRLRLRLRUBUDFDUBUFUFBDBFUFLRLRLRLRLDFDUBUDFD", order: 4, moves: 6, alg: "D U' L2 R2 B2 F2", sliceMoves: 3, sliceAlg: "M2 S2 E", wrong: 40, blank: 0, designs: 1, variants: [], figures: [341,16,16,341,16,16] },
  { look: "DDDDUDDDDLLLRRRLLLFFFBFBFFFUUUUDUUUURRRLLLRRRBBBFBFBBB", order: 4, moves: 6, alg: "D U' L2 R2 D U'", sliceMoves: 3, sliceAlg: "M S2 M'", wrong: 32, blank: 0, designs: 1, variants: [], figures: [56,381,16,56,381,16] },
  { look: "DDDUUUDDDLRLRRRLRLFFFBFBFFFUUUDDDUUURLRLLLRLRBBBFBFBBB", order: 4, moves: 6, alg: "D U' L2 R2 D' U", sliceMoves: 3, sliceAlg: "M S2 M", wrong: 24, blank: 0, designs: 1, variants: [], figures: [56,186,381,56,186,381] },
  { look: "FDUDUBFDURLRLRLRLRDBFBFUDBFBUDUDFBUDLRLRLRLRLBFUDBFBFU", order: 4, moves: 6, alg: "D U2 L2 R2 B2 F2", sliceMoves: 4, sliceAlg: "U' M2 E2 S2", wrong: 32, blank: 0, designs: 2, variants: ["D2 U' L2 R2 B2 F2","L2 R2 B2 F2 D U2","L2 R2 B2 F2 D2 U'"], figures: [341,21,21,341,21,21] },
  { look: "BBBBUFFFFLRLURDLRLUUULFRDDDFFFFDBBBBRLRULDRLRUUURBLDDD", order: 4, moves: 6, alg: "L R B F D U", sliceMoves: 6, sliceAlg: "L R B F D U", wrong: 44, blank: 0, designs: 1, variants: ["L' R' B' F' D' U'"], figures: [16,16,56,16,16,56] },
  { look: "BBBBUFFFFRRRDRURRRDDDRFLUUUFFFFDBBBBLLLDLULLLDDDLBRUUU", order: 4, moves: 6, alg: "L R B F D' U'", sliceMoves: 6, sliceAlg: "L R B F D' U'", wrong: 36, blank: 0, designs: 2, variants: ["L R B' F' D' U'","L' R' B F D U","L' R' B' F' D U"], figures: [16,16,381,16,16,381] },
  { look: "DRDUUUDLDBFFBRFBBFRULRFLRDLURUDDDULUFBBFLBFFBLURLBRLDR", order: 4, moves: 6, alg: "L R B' F' D U", sliceMoves: 6, sliceAlg: "L R B' F' D U", wrong: 44, blank: 0, designs: 1, variants: ["L' R' B F D' U'"], figures: [16,16,56,16,16,56] },
  { look: "FDBBUFFDBRRRRRRRRRDBUDFUDBUBUFFDBBUFLLLLLLLLLDFUDBUDFU", order: 4, moves: 6, alg: "L2 R2 D U B2 F2", sliceMoves: 4, sliceAlg: "M2 U D S2", wrong: 32, blank: 2, designs: 1, variants: ["L2 R2 D' U' B2 F2"], figures: [511,16,16,511,16,16] },
  { look: "BUFBUFBUFRLRLRLRLRUFDDFUUFDFDBFDBFDBLRLRLRLRLUBDDBUUBD", order: 4, moves: 6, alg: "L2 R2 D U L2 R2", sliceMoves: 4, sliceAlg: "M2 U D M2", wrong: 32, blank: 0, designs: 1, variants: ["L2 R2 D' U' L2 R2"], figures: [341,56,56,341,56,56] },
  { look: "BDBBUBBDBRRRRRRRRRUBUUFUUBUFUFFDFFUFLLLLLLLLLDFDDBDDFD", order: 4, moves: 6, alg: "L2 R2 D U' B2 F2", sliceMoves: 3, sliceAlg: "M2 E' M2", wrong: 32, blank: 2, designs: 1, variants: [], figures: [511,16,16,511,16,16] },
  { look: "BUBFUFBUBRLRLRLRLRUFUDFDUFUFDFBDBFDFLRLRLRLRLDBDUBUDBD", order: 4, moves: 6, alg: "L2 R2 D U' L2 R2", sliceMoves: 3, sliceAlg: "M2 E' S2", wrong: 32, blank: 0, designs: 1, variants: [], figures: [341,56,56,341,56,56] },
  { look: "BDBDUUBDBRLRLRLRLRUBUBFFUBUFUFUDDFUFLRLRLRLRLDFDBBFDFD", order: 4, moves: 6, alg: "U L2 R2 B2 F2 D'", sliceMoves: 4, sliceAlg: "U M2 S2 D'", wrong: 36, blank: 0, designs: 1, variants: ["U' L2 R2 B2 F2 D"], figures: [341,18,18,341,18,18] },
  { look: "FDUUUFFDURLRLRLRLRDBFFFDDBFBUDDDBBUDLRLRLRLRLBFUUBBBFU", order: 4, moves: 6, alg: "U L2 R2 B2 F2 D2", sliceMoves: 4, sliceAlg: "U M2 S2 D2", wrong: 28, blank: 0, designs: 2, variants: ["U' L2 R2 B2 F2 D2","U2 L2 R2 B2 F2 D","U2 L2 R2 B2 F2 D'"], figures: [341,113,113,341,113,113] },
  { look: "DDUFUFDDURLRLRLRLRBBFDFDBBFUUDBDBUUDLRLRLRLRLBFFUBUBFF", order: 4, moves: 6, alg: "U L2 R2 B2 F2 U", sliceMoves: 4, sliceAlg: "U M2 S2 U", wrong: 32, blank: 0, designs: 1, variants: ["U' L2 R2 B2 F2 U'"], figures: [341,21,21,341,21,21] },
  { look: "BDDDUBBDDRLRLRLRLRUBBBFUUBBFUUUDFFUULRLRLRLRLFFDDBFFFD", order: 4, moves: 6, alg: "U L2 R2 B2 F2 U2", sliceMoves: 4, sliceAlg: "U M2 S2 U2", wrong: 40, blank: 0, designs: 2, variants: ["U' L2 R2 B2 F2 U2","U2 L2 R2 B2 F2 U","U2 L2 R2 B2 F2 U'"], figures: [341,16,16,341,16,16] },
  { look: "FDBBUUFDBRLRRRRRLRDBUFFDDBUBUFFDDBUFLLLRLRLLLDFUUBBDFU", order: 4, moves: 6, alg: "U R2 B2 F2 R2 D", sliceMoves: 5, sliceAlg: "U R2 S2 L2 U", wrong: 32, blank: 0, designs: 1, variants: ["U' R2 B2 F2 R2 D'"], figures: [381,18,18,381,18,18] },
  { look: "DDDFUUDDDRRRLRLRRRBBBFFUBBBUUUBDDUUULRLLLLLRLFFFDBBFFF", order: 4, moves: 6, alg: "U R2 B2 F2 R2 U'", sliceMoves: 5, sliceAlg: "U R2 S2 L2 D'", wrong: 32, blank: 0, designs: 1, variants: ["U' R2 B2 F2 R2 U"], figures: [381,18,18,381,18,18] },
  { look: "FDBFUBFDBRRRRRRRRRDFUDFUDFUBUFBDFBUFLLLLLLLLLDBUDBUDBU", order: 4, moves: 6, alg: "U R2 D2 U2 L2 D", sliceMoves: 5, sliceAlg: "U R2 E2 R2 D", wrong: 28, blank: 2, designs: 1, variants: ["U' R2 D2 U2 L2 D'"], figures: [511,56,16,511,56,16] },
  { look: "DDDUUUDDDRFRRRRLLLBBBFFFFRFUDUUDUUDULBLLLLRRRFFFBBBBLB", order: 4, moves: 6, alg: "U R2 D2 U2 R2 D", sliceMoves: 5, sliceAlg: "U R2 E2 L2 D", wrong: 28, blank: 0, designs: 1, variants: ["U' R2 D2 U2 R2 D'"], figures: [56,61,61,56,61,61] },
  { look: "BUBBUDBUBLRLLRLLRLDFDBFDDFDFDFFDUFDFRRRLLLRRRUBUUBFUBU", order: 4, moves: 6, alg: "U R2 D2 U2 R2 U'", sliceMoves: 5, sliceAlg: "U R2 E2 L2 U'", wrong: 36, blank: 0, designs: 1, variants: ["U' R2 D2 U2 R2 U"], figures: [56,56,56,56,56,56] },
  { look: "UDUDUDUDURLRLRLRLRFBFFFFFBFDUDUDUDUDLRLRLRLRLBFBBBBBFB", order: 4, moves: 6, alg: "U2 L2 R2 U2 B2 F2", sliceMoves: 4, sliceAlg: "U2 M2 D2 S2", wrong: 20, blank: 0, designs: 1, variants: [], figures: [341,341,381,341,341,381] },
  { look: "DDDDUDDDDLLLRRRLLLFBFBFBFBFUUUUDUUUURRRLLLRRRBFBFBFBFB", order: 4, moves: 6, alg: "U2 R2 B2 F2 L2 U2", sliceMoves: 4, sliceAlg: "U2 M2 U2 S2", wrong: 36, blank: 0, designs: 1, variants: [], figures: [16,341,56,16,341,56] },
  { look: "UDUDUDUDURLRRRRRLRFFFBFBFFFDUDUDUDUDLRLLLLLRLBBBFBFBBB", order: 4, moves: 6, alg: "U2 R2 B2 F2 R2 D2", sliceMoves: 5, sliceAlg: "U2 R2 S2 L2 U2", wrong: 16, blank: 0, designs: 1, variants: [], figures: [381,341,381,381,341,381] },
  { look: "DDDDUDDDDLLLRRRLLLFBFFFFFBFUUUUDUUUURRRLLLRRRBFBBBBBFB", order: 4, moves: 6, alg: "U2 R2 B2 F2 R2 U2", sliceMoves: 5, sliceAlg: "U2 R2 S2 L2 D2", wrong: 32, blank: 0, designs: 1, variants: [], figures: [381,56,16,381,56,16] },
  { look: "UDUUUUUDURRRRRRRRRFFFFFFFFFDUDDDDDUDLLLLLLLLLBBBBBBBBB", order: 4, moves: 6, alg: "U2 R2 D2 U2 L2 D2", sliceMoves: 4, sliceAlg: "U2 M2 U2 M2", wrong: 4, blank: 4, designs: 1, variants: [], figures: [511,511,381,511,511,381] },
  { look: "FDBBUFFDBRLRLRLRLRDBUDFUDBUBUFFDBBUFLRLRLRLRLDFUDBUDFU", order: 4, moves: 7, alg: "D U' L2 R2 D2 B2 F2", sliceMoves: 4, sliceAlg: "M2 D2 S2 E", wrong: 40, blank: 0, designs: 1, variants: ["D U' L2 R2 U2 B2 F2"], figures: [341,16,16,341,16,16] },
  { look: "BUFBUFBUFRRRRRRRRRUFDDFUUFDFDBFDBFDBLLLLLLLLLUBDDBUUBD", order: 4, moves: 7, alg: "D U' L2 R2 D2 L2 R2", sliceMoves: 4, sliceAlg: "M2 D2 M2 E", wrong: 24, blank: 2, designs: 1, variants: ["D U' L2 R2 U2 L2 R2"], figures: [511,56,56,511,56,56] },
  { look: "BUUFUDBUURLRLRLRLRUFFDFBUFFFDDBDUFDDLRLRLRLRLBBDFBUBBD", order: 4, moves: 7, alg: "L2 R2 D U' L2 R2 D", sliceMoves: 4, sliceAlg: "M2 E' S2 U", wrong: 24, blank: 0, designs: 2, variants: ["L2 R2 D U' L2 R2 U'","U L2 R2 D' U L2 R2","U' L2 R2 D U' L2 R2"], figures: [341,61,61,341,61,61] },
  { look: "BUDFUUBUDRLRLRLRLRUFBDFFUFBFDUBDDFDULRLRLRLRLFBDBBUFBD", order: 4, moves: 7, alg: "L2 R2 D U' L2 R2 D'", sliceMoves: 4, sliceAlg: "M2 E' S2 U'", wrong: 28, blank: 0, designs: 2, variants: ["L2 R2 D U' L2 R2 U","U L2 R2 D U' L2 R2","U' L2 R2 D' U L2 R2"], figures: [341,58,58,341,58,58] },
  { look: "BDUBUUBDURRRRRRRRRUBFUFFUBFFUDFDDFUDLLLLLLLLLBFDBBDBFD", order: 4, moves: 7, alg: "U L2 R2 D U' B2 F2", sliceMoves: 4, sliceAlg: "U M2 E M2", wrong: 20, blank: 2, designs: 1, variants: ["U' L2 R2 D' U B2 F2"], figures: [511,23,23,511,23,23] },
  { look: "DDBDUBDDBRRRRRRRRRBBUBFUBBUUUFUDFUUFLLLLLLLLLDFFDBFDFF", order: 4, moves: 7, alg: "U L2 R2 D' U B2 F2", sliceMoves: 4, sliceAlg: "U M2 E' M2", wrong: 32, blank: 2, designs: 1, variants: ["U' L2 R2 D U' B2 F2"], figures: [511,16,16,511,16,16] },
  { look: "BDFDUUBDFRLRLRLRLRUBDFFBUBDFUBUDDFUBLRLRLRLRLUFDFBBUFD", order: 4, moves: 7, alg: "U L2 R2 D2 B2 F2 D'", sliceMoves: 5, sliceAlg: "U M2 U2 S2 D'", wrong: 36, blank: 0, designs: 1, variants: ["U L2 R2 U2 B2 F2 D'"], figures: [341,18,18,341,18,18] },
  { look: "DDDBUBDDDRLRLRLRLRBBBDFDBBBUUUFDFUUULRLRLRLRLFFFUBUFFF", order: 4, moves: 7, alg: "U L2 R2 D2 B2 F2 U", sliceMoves: 5, sliceAlg: "U M2 U2 S2 U", wrong: 40, blank: 0, designs: 1, variants: [], figures: [341,16,16,341,16,16] },
  { look: "FUBBUBFUBRRRRRRRRRDFUDFDDFUBDFFDFBDFLLLLLLLLLDBUUBUDBU", order: 4, moves: 7, alg: "U L2 R2 D2 L2 R2 D'", sliceMoves: 5, sliceAlg: "U M2 U2 M2 D'", wrong: 24, blank: 2, designs: 1, variants: ["U L2 R2 U2 L2 R2 D'"], figures: [511,56,56,511,56,56] },
  { look: "UDUUUUUUURRRLRRRRRFFFFFFFFFDDDDDDDUDLLLLLRLLLBBBBBBBBB", order: 4, moves: 7, alg: "U L2 R2 D2 L2 R2 U", sliceMoves: 5, sliceAlg: "U M2 U2 M2 U", wrong: 4, blank: 2, designs: 1, variants: [], figures: [511,383,383,511,383,383] },
  { look: "UDUBUBUDURLRLRLRLRFBFDFDFBFDUDFDFDUDLRLRLRLRLBFBUBUBFB", order: 4, moves: 7, alg: "U L2 R2 U2 B2 F2 U", sliceMoves: 5, sliceAlg: "U M2 D2 S2 U", wrong: 24, blank: 0, designs: 1, variants: [], figures: [341,341,341,341,341,341] },
  { look: "DDDUUUDUDLRLLRRLRLFFFFFFFFFUDUDDDUUURLRLLRRLRBBBBBBBBB", order: 4, moves: 7, alg: "U L2 R2 U2 L2 R2 U", sliceMoves: 5, sliceAlg: "U M2 D2 M2 U", wrong: 20, blank: 2, designs: 1, variants: [], figures: [511,58,58,511,58,58] },
  { look: "BDFDUBBDFRRRLRLRRRUBDDFBUBDFUBUDFFUBLRLLLLLRLUFDFBUUFD", order: 4, moves: 7, alg: "U R2 B2 F2 R2 D' U2", sliceMoves: 6, sliceAlg: "U R2 S2 L2 U' D2", wrong: 36, blank: 0, designs: 1, variants: ["U' R2 B2 F2 R2 D U2"], figures: [381,16,16,381,16,16] },
  { look: "UDUBUDUDURRRLRLRRRFBFBFDFBFDUDFDUDUDLRLLLLLRLBFBUBFBFB", order: 4, moves: 7, alg: "U R2 B2 F2 R2 D2 U", sliceMoves: 6, sliceAlg: "U R2 S2 L2 U2 D", wrong: 20, blank: 0, designs: 1, variants: ["U' R2 B2 F2 R2 D2 U'"], figures: [381,341,341,381,341,341] },
  { look: "DDDUUUDDDLBLRRRRRRFFFFFFBLBUDUUDUUDURFRLLLLLLBBBBBBFRF", order: 4, moves: 7, alg: "U R2 D2 U2 R2 D' U2", sliceMoves: 6, sliceAlg: "U R2 E2 L2 D' U2", wrong: 24, blank: 0, designs: 1, variants: ["U' R2 D2 U2 R2 D U2"], figures: [56,63,63,56,63,63] },
  { look: "BUBUUBBUBLLLRRRLLLDFDDFFDFDFDFDDFFDFRLRRLRRLRUBUBBUUBU", order: 4, moves: 7, alg: "U R2 D2 U2 R2 D2 U", sliceMoves: 6, sliceAlg: "U R2 E2 L2 D2 U", wrong: 32, blank: 0, designs: 1, variants: ["U' R2 D2 U2 R2 D2 U'"], figures: [56,58,58,56,58,58] },
  { look: "DDBUUFDDBRRRRRRRRRBBUFFDBBUUUFDDBUUFLLLLLLLLLDFFUBBDFF", order: 4, moves: 7, alg: "U R2 F2 L2 R2 F2 L2", sliceMoves: 6, sliceAlg: "U R2 F2 M2 B2 L2", wrong: 28, blank: 2, designs: 1, variants: ["U' R2 F2 L2 R2 F2 L2"], figures: [511,18,18,511,18,18] },
  { look: "DDDDUDDDDLLLRRRRRRFFFFFFBBBUUUUDUUUURRRLLLLLLBBBBBBFFF", order: 4, moves: 7, alg: "U2 L R B2 F2 L' R'", sliceMoves: 6, sliceAlg: "U2 L R S2 R' L'", wrong: 28, blank: 0, designs: 1, variants: [], figures: [16,63,63,16,63,63] },
  { look: "BDBBUBBDBRLRLRLRLRUBUUFUUBUFUFFDFFUFLRLRLRLRLDFDDBDDFD", order: 4, moves: 7, alg: "U2 L2 R2 B2 F2 D U", sliceMoves: 5, sliceAlg: "U2 M2 S2 D U", wrong: 40, blank: 0, designs: 1, variants: [], figures: [341,16,16,341,16,16] },
  { look: "DDUUUDDDURRRRRRRRRBBFFFBBBFUUDDDUUUDLLLLLLLLLBFFFBBBFF", order: 4, moves: 7, alg: "U2 R2 F2 L2 R2 F2 L2", sliceMoves: 6, sliceAlg: "U2 R2 F2 M2 B2 L2", wrong: 20, blank: 2, designs: 1, variants: [], figures: [511,113,113,511,113,113] },
  { look: "BBBUUUFFFRRRRRRRRRDDDFFFUUUFFFDDDBBBLLLLLLLLLDDDBBBUUU", order: 4, moves: null, alg: null, sliceMoves: null, sliceAlg: null, wrong: 24, blank: 2, designs: 1, variants: [], figures: [511,56,56,511,56,56], name: "Vertical Stripes", book: "F U F R L2 B D' R D2 L D' B R2 L F U F" },
  { look: "DDUUUUDDURRRRRRRRRBBFFFFBBFUUDDDDUUDLLLLLLLLLBFFBBBBFF", order: 4, moves: null, alg: null, sliceMoves: null, sliceAlg: null, wrong: 16, blank: 2, designs: 1, variants: [], figures: [511,121,121,511,121,121], name: "40 (4T)", book: "F2 D2 F' L2 D2 U2 R2 B' U2 F2" },
  { look: "FUBBUFFUBRLRRRRRLRDFUDFUDFUBDFFDBBDFLRLLLLLRLDBUDBUDBU", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "M E2 M D U", wrong: 28, blank: 0, designs: 2, variants: [], figures: [381,56,56,381,56,56] },
  { look: "DDDDUDDDDLRLRRRLRLFFFBFBFFFUUUUDUUUURLRLLLRLRBBBFBFBBB", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "M F2 E2 F2 M", wrong: 28, blank: 0, designs: 1, variants: [], figures: [381,16,186,381,16,186] },
  { look: "BDFFUBBDFLRLRRRLRLDFUUFDDFUFUBBDFFUBRLRLLLRLRDBUUBDDBU", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "M S2 M U D", wrong: 36, blank: 0, designs: 2, variants: [], figures: [186,16,56,186,16,56] },
  { look: "FDBBUFFDBRLRRRRRLRDBUDFUDBUBUFFDBBUFLRLLLLLRLDFUDBUDFU", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "M S2 M' D U", wrong: 36, blank: 0, designs: 2, variants: [], figures: [381,16,16,381,16,16] },
  { look: "DUDUUUUDURRLLRRRRLFBFBFBFBFDUDDDDUDURLLLLRRLLBFBFBFBFB", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "M S2 M' E2 R2", wrong: 20, blank: 0, designs: 2, variants: [], figures: [189,341,189,189,341,189] },
  { look: "DDDFUBDDDLLLRRRLLLFFFDFUFFFUUUBDFUUURRRLLLRRRBBBDBUBBB", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "M2 D M2 S2 D'", wrong: 32, blank: 0, designs: 2, variants: [], figures: [56,16,381,56,16,381] },
  { look: "BDFBUFBDFLRLLRLLRLDFUUFDDFUFUBFDBFUBRLRRLRRLRDBUUBDDBU", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "M2 D2 M2 E S2", wrong: 40, blank: 0, designs: 2, variants: [], figures: [56,56,16,56,56,16] },
  { look: "BDFFUBBDFLLLRRRLLLDFUDFUDFUFUBBDFFUBRRRLLLRRRDBUDBUDBU", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "M2 D2 M2 S2 E", wrong: 40, blank: 0, designs: 2, variants: [], figures: [56,16,56,56,16,56] },
  { look: "DUDUUUUDURRLLRRRRLFFFFFFFFFDUDDDDUDURLLLLRRLLBBBBBBBBB", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "M2 E2 F2 M2 E2", wrong: 12, blank: 2, designs: 1, variants: [], figures: [189,189,511,189,189,511] },
  { look: "BUUUUBBUURRRRRRRRRUFFFFUUFFFDDDDFFDDLLLLLLLLLBBDDBBBBD", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "M2 S2 U M2 S2", wrong: 12, blank: 2, designs: 1, variants: [], figures: [511,189,189,511,189,189] },
  { look: "FUBFUUFUBRLRRRRRLRDFUFFUDFUBDFBDDBDFLLLRLRLLLDBUDBBDBU", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U M E2 M D", wrong: 24, blank: 0, designs: 1, variants: [], figures: [381,58,58,381,58,58] },
  { look: "DDDUUUDRDLRLLRULRLFBFFFFFBFULUDDDUUURLRDLRRLRBBBFBFBBB", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U M E2 M U'", wrong: 28, blank: 0, designs: 1, variants: [], figures: [381,56,56,381,56,56] },
  { look: "BUFBUFBUFLLLLRLLLLDBUDFUDBUFDBFDBFDBRRRRLRRRRDFUDBUDFU", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U M E2 M' D", wrong: 44, blank: 0, designs: 1, variants: [], figures: [16,56,16,16,56,16] },
  { look: "BDFUUUBDFLRLRRRLRLDFUBFBDFUFUBDDDFUBRLRLLLRLRDBUFBFDBU", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U M S2 M D", wrong: 32, blank: 0, designs: 1, variants: [], figures: [186,56,56,186,56,56] },
  { look: "DDDBUFDDDLRLRRRLRLFFFDFUFFFUUUFDBUUURLRLLLRLRBBBDBUBBB", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U M S2 M U'", wrong: 28, blank: 0, designs: 1, variants: [], figures: [186,16,381,186,16,381] },
  { look: "FDBFUUFDBRLRRRRRLRDBUFFUDBUBUFBDDBUFLLLRLRLLLDFUDBBDFU", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U M S2 M' D", wrong: 32, blank: 0, designs: 1, variants: [], figures: [381,18,18,381,18,18] },
  { look: "DDDDUBDDDRLRRRRRLRBBBDFBBBBUUUUDFUUULLLRLRLLLFFFFBUFFF", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U M S2 M' U'", wrong: 36, blank: 0, designs: 1, variants: [], figures: [381,16,16,381,16,16] },
  { look: "DDDDUDUUURLLRRLRLLFFFFFFFFFDDDUDUUUURRLRLLRRLBBBBBBBBB", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U M2 E' M2 D", wrong: 20, blank: 2, designs: 1, variants: [], figures: [511,23,23,511,23,23] },
  { look: "DLDUUUULURRLURURRLFBFBFBFBFDRDDDDURURLLDLDRLLBFBFBFBFB", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U M2 E' S2 D", wrong: 24, blank: 0, designs: 1, variants: [], figures: [341,61,61,341,61,61] },
  { look: "FUUUUFFUURLRLRLRLRDFFFFDDFFBDDDDBBDDLRLRLRLRLBBUUBBBBU", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U M2 E' S2 D2", wrong: 20, blank: 0, designs: 2, variants: [], figures: [341,189,189,341,189,189] },
  { look: "BUBDUUBUBRLRLRLRLRUFUBFFUFUFDFUDDFDFLRLRLRLRLDBDBBFDBD", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U M2 E' S2 U'", wrong: 28, blank: 0, designs: 1, variants: [], figures: [341,58,58,341,58,58] },
  { look: "BUDDUBBUDRLRLRLRLRUFBBFUUFBFDUUDFFDULRLRLRLRLFBDDBFFBD", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U M2 E' S2 U2", wrong: 32, blank: 0, designs: 2, variants: [], figures: [341,56,56,341,56,56] },
  { look: "BDFUUUBDFLRLLRLLRLDFUFFFDFUFUBDDDFUBRLRRLRRLRDBUBBBDBU", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U M2 S2 D M2", wrong: 32, blank: 0, designs: 1, variants: [], figures: [56,56,186,56,56,186] },
  { look: "DDDUUUDDDLRLLRLLRLFBFFFFFBFUUUDDDUUURLRRLRRLRBFBBBBBFB", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U2 M E2 M U2", wrong: 28, blank: 0, designs: 1, variants: [], figures: [381,56,56,381,56,56] },
  { look: "DDDUUUDDDRLRRRRRLRBFBFFFBFBUUUDDDUUULRLLLLLRLFBFBBBFBF", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U2 M S2 M D2", wrong: 24, blank: 0, designs: 1, variants: [], figures: [186,381,56,186,381,56] },
  { look: "DDDDUDDDDLRLRRRLRLFFFFFFFFFUUUUDUUUURLRLLLRLRBBBBBBBBB", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U2 M S2 M U2", wrong: 24, blank: 2, designs: 1, variants: [], figures: [186,16,511,186,16,511] },
  { look: "UDUUUUUDURLRRRRRLRFBFFFFFBFDUDDDDDUDLRLLLLLRLBFBBBBBFB", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U2 M S2 M' D2", wrong: 12, blank: 0, designs: 1, variants: [], figures: [381,381,381,381,381,381] },
  { look: "DDDDUDDDDLLLLRLLLLFBFFFFFBFUUUUDUUUURRRRLRRRRBFBBBBBFB", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U2 M S2 M' U2", wrong: 36, blank: 0, designs: 1, variants: [], figures: [381,16,16,381,16,16] },
  { look: "DDDUUUDDDRLRLRLRLRBFBFFFBFBUUUDDDUUULRLRLRLRLFBFBBBFBF", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U2 M2 D2 M2 S2", wrong: 28, blank: 0, designs: 1, variants: [], figures: [56,341,186,56,341,186] },
  { look: "BUBBUBBUBRLRLRLRLRUFUUFUUFUFDFFDFFDFLRLRLRLRLDBDDBDDBD", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U2 M2 E' S2 U2", wrong: 32, blank: 0, designs: 1, variants: [], figures: [341,56,56,341,56,56] },
  { look: "DDDUUUDDDRRRLRLRRRBFBFFFBFBUUUDDDUUULLLRLRLLLFBFBBBFBF", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U2 M2 S2 D2 M2", wrong: 24, blank: 0, designs: 1, variants: [], figures: [56,381,186,56,381,186] },
  { look: "DDDDUDDDDLRLLRLLRLFFFBFBFFFUUUUDUUUURLRRLRRLRBBBFBFBBB", order: 4, moves: null, alg: null, sliceMoves: 5, sliceAlg: "U2 M2 S2 U2 M2", wrong: 32, blank: 0, designs: 1, variants: [], figures: [56,16,381,56,16,381] },
  { look: "BLFBUFBRFLLLDRULLLDUUBFBDDUFLBFDBFRBRRRDLURRRDUUFBFDDU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "D U R E2 S2 R'", wrong: 48, blank: 0, designs: 2, variants: [], figures: [16,16,16,16,16,16] },
  { look: "BRFBUFBLFLLLURDLLLDDUBFBDUUFRBFDBFLBRRRULDRRRDDUFBFDUU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "D U R' E2 S2 R", wrong: 48, blank: 0, designs: 2, variants: [], figures: [16,16,16,16,16,16] },
  { look: "BDFFUBBDFRRRLRLRRRUFDUFDUFDFUBBDFFUBLLLRLRLLLUBDUBDUBD", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "D U R2 E2 S2 L2", wrong: 32, blank: 0, designs: 2, variants: [], figures: [381,16,56,381,16,56] },
  { look: "FDBBUFFDBRRRLRLRRRDFUUFDDFUBUFFDBBUFLLLRLRLLLDBUUBDDBU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "E B2 E2 M2 F2 D2", wrong: 32, blank: 0, designs: 2, variants: [], figures: [381,16,56,381,16,56] },
  { look: "BUBBUBBUBLLLLRLLLLDFDDFDDFDFDFFDFFDFRRRRLRRRRUBUUBUUBU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "L R S2 R' L' E'", wrong: 40, blank: 0, designs: 1, variants: [], figures: [16,56,56,16,56,56] },
  { look: "FDBBUDFDBRRRLRLRRRDBUBFDDBUBUFFDUBUFLRLLLLLRLDFUUBFDFU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "M S2 M D M2 U", wrong: 36, blank: 0, designs: 2, variants: [], figures: [381,16,16,381,16,16] },
  { look: "BUFFUUBUFRRRLRLRRRUFDFFUUFDFDBBDDFDBLRLLLLLRLUBDDBBUBD", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "M S2 M D S2 U", wrong: 24, blank: 0, designs: 2, variants: [], figures: [381,58,58,381,58,58] },
  { look: "DDDBUFDDDRRRLRLRRRBBBDFUBBBUUUFDBUUULLLRLRLLLFFFDBUFFF", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "M2 D M S2 M D'", wrong: 36, blank: 0, designs: 2, variants: [], figures: [381,16,16,381,16,16] },
  { look: "DDDUUUDDDLBLRRRLFLFRFBFBFLFUUUDDDUUURFRLLLRBRBLBFBFBRB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "M2 D M2 E2 S2 D'", wrong: 32, blank: 0, designs: 2, variants: [], figures: [56,341,56,56,341,56] },
  { look: "DDUBUBDDURRRRRRRRRBBFUFUBBFUUDFDFUUDLLLLLLLLLBFFDBDBFF", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "M2 D M2 S2 D M2", wrong: 24, blank: 2, designs: 1, variants: [], figures: [511,21,21,511,21,21] },
  { look: "DDDBUFDDDRRRRRRRRRBBBDFUBBBUUUFDBUUULLLLLLLLLFFFDBUFFF", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "M2 D M2 S2 D' M2", wrong: 32, blank: 2, designs: 1, variants: [], figures: [511,16,16,511,16,16] },
  { look: "UDUDUDUDURBRRRRRFRFLFFFFFRFDUDUDUDUDLFLLLLLBLBRBBBBBLB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "M2 D M2 S2 D' S2", wrong: 16, blank: 0, designs: 1, variants: [], figures: [341,381,381,341,381,381] },
  { look: "UDUUUUUDURFRRRRRBRFRFFFFFLFDUDDDDDUDLBLLLLLFLBLBBBBBRB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "M2 D S' M2 S' D'", wrong: 12, blank: 0, designs: 2, variants: [], figures: [381,381,381,381,381,381] },
  { look: "DDDUUUUUULRRLRRLRRBFBFFFBFBDDDDDDUUULLRLLRLLRFBFBBBFBF", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "M2 D2 B2 M2 E2 F2", wrong: 20, blank: 0, designs: 2, variants: [], figures: [186,63,63,186,63,63] },
  { look: "BDUUUBBDURRRRRRRRRUBFFFUUBFFUDDDFFUDLLLLLLLLLBFDDBBBFD", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "M2 E' S2 D S2 M2", wrong: 20, blank: 2, designs: 1, variants: [], figures: [511,113,113,511,113,113] },
  { look: "BDDDUBBDDRRRRRRRRRUBBBFUUBBFUUUDFFUULLLLLLLLLFFDDBFFFD", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "M2 E' S2 D' S2 M2", wrong: 32, blank: 2, designs: 1, variants: [], figures: [511,16,16,511,16,16] },
  { look: "DRDUUURDRDRLLRDDRLFFFFFFFFFLULDDDULURLUULRRLUBBBBBBBBB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "M2 E2 S2 U M2 S2", wrong: 24, blank: 2, designs: 1, variants: [], figures: [511,56,56,511,56,56] },
  { look: "FDBFUBFDBRLRLRLRLRDFUUFDDFUBUFBDFBUFLRLRLRLRLDBUUBDDBU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "R2 E2 L2 D U M2", wrong: 36, blank: 0, designs: 1, variants: [], figures: [341,56,16,341,56,16] },
  { look: "BDFFUBBDFRRRRRRRRRUFDUFDUFDFUBBDFFUBLLLLLLLLLUBDUBDUBD", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "R2 E2 L2 D U S2", wrong: 28, blank: 2, designs: 2, variants: [], figures: [511,16,56,511,16,56] },
  { look: "FDBBUFFDBRLRLRLRLRDFUUFDDFUBUFFDBBUFLRLRLRLRLDBUUBDDBU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "R2 E2 L2 E S2 D2", wrong: 36, blank: 0, designs: 2, variants: [], figures: [341,56,16,341,56,16] },
  { look: "FDBBUFFDBRLRLRLRLRDFUDFUDFUBUFFDBBUFLRLRLRLRLDBUDBUDBU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "R2 E2 L2 U2 S2 E", wrong: 36, blank: 0, designs: 1, variants: [], figures: [341,16,56,341,16,56] },
  { look: "BDFBUFBDFLLLRRRLLLDBUUFDDBUFUBFDBFUBRRRLLLRRRDFUUBDDFU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "R2 E2 R2 E M2 D2", wrong: 44, blank: 0, designs: 2, variants: [], figures: [56,16,16,56,16,16] },
  { look: "BDBFUFBDBRRRRRRRRRUBUDFDUBUFUFBDBFUFLLLLLLLLLDFDUBUDFD", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "R2 F2 M2 B2 L2 E'", wrong: 32, blank: 2, designs: 1, variants: [], figures: [511,16,16,511,16,16] },
  { look: "BDBBUBBDBLLLLRLLLLDBDDFDDBDFUFFDFFUFRRRRLRRRRUFUUBUUFU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "R2 S E2 S' R2 E'", wrong: 48, blank: 0, designs: 1, variants: [], figures: [16,16,16,16,16,16] },
  { look: "BDFFUBBDFLLLLRLLLLDFUUFDDFUFUBBDFFUBRRRRLRRRRDBUUBDDBU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "R2 S2 L2 D2 M2 E", wrong: 44, blank: 0, designs: 1, variants: [], figures: [16,16,56,16,16,56] },
  { look: "FUBBUFFUBRLRRRRRLRDFUUFDDFUBDFFDBBDFLRLLLLLRLDBUUBDDBU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "R2 S2 R2 E' M2 D2", wrong: 28, blank: 0, designs: 2, variants: [], figures: [381,56,56,381,56,56] },
  { look: "DDUDUDUDDBRFLRLBRFLFLFFFRFRUUDUDUDUUFLBRLRFLBRBRBBBLBL", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "R2 U M2 S2 D L2", wrong: 32, blank: 0, designs: 1, variants: [], figures: [84,56,186,84,56,186] },
  { look: "BDBUUUFDFLRRLRLRRLDBUFFFDBUFUFDDDBUBRLLRLRLLRDFUBBBDFU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "R2 U M2 S2 D R2", wrong: 32, blank: 0, designs: 1, variants: [], figures: [214,56,56,214,56,56] },
  { look: "FDBDUDFDBRRRLRLRRRDBUFFFDBUBUFUDUBUFLLLRLRLLLDFUBBBDFU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M S2 M D M2", wrong: 32, blank: 0, designs: 1, variants: [], figures: [381,56,16,381,56,16] },
  { look: "BUFDUDBUFRLRRRRRLRUFDFFFUFDFDBUDUFDBLRLLLLLRLUBDBBBUBD", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M S2 M D S2", wrong: 24, blank: 0, designs: 1, variants: [], figures: [381,186,56,381,186,56] },
  { look: "BUFBUDBUFRLRRRRRLRUFDBFDUFDFDBFDUFDBLLLRLRLLLUBDUBFUBD", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M S2 M S2 D", wrong: 28, blank: 0, designs: 1, variants: [], figures: [381,56,56,381,56,56] },
  { look: "UDUUUUUDURRRRRRRFRFRFFFFFFFDDDUDUDDDLLLLLLLBLBLBBBBBBB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M S2 M S2 U'", wrong: 8, blank: 0, designs: 1, variants: [], figures: [381,383,383,381,383,383] },
  { look: "DRDUUUDLDRLRDRURLRBFBFFFBFBURUDDDULULRLDLULRLFBFBBBFBF", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M S2 M U D2", wrong: 28, blank: 0, designs: 1, variants: [], figures: [186,341,56,186,341,56] },
  { look: "BUFUUUBUFLRLRRRLRLDBUBFBDBUFDBDDDFDBRLRLLLRLRDFUFBFDFU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M S2 M U2 D'", wrong: 32, blank: 0, designs: 1, variants: [], figures: [186,16,186,186,16,186] },
  { look: "BDFBUDBDFRLRRRRRLRUBDBFDUBDFUBFDUFUBLLLRLRLLLUFDUBFUFD", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M S2 M' D' U2", wrong: 36, blank: 0, designs: 1, variants: [], figures: [381,16,16,381,16,16] },
  { look: "UDUBUUUDURRRLRLRRRFBFFFDFBFDUDFDDDUDLRLLLLLRLBFBUBBBFB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M S2 M' D2 U", wrong: 16, blank: 0, designs: 1, variants: [], figures: [381,343,343,381,343,343] },
  { look: "DDDUUUDDDLBLRRRLFLFLFBFBFRFUUUDDDUUURFRLLLRBRBRBFBFBLB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 E S2 D' S2", wrong: 32, blank: 0, designs: 2, variants: [], figures: [56,56,341,56,56,341] },
  { look: "BUFUUUBUFLRLLRLLRLDBUFFFDBUFDBDDDFDBRLRRLRRLRDFUBBBDFU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 E S2 U S2", wrong: 32, blank: 0, designs: 1, variants: [], figures: [56,186,56,56,186,56] },
  { look: "DDDBUFDDDLLLRRRLLLFFFDFUFFFUUUFDBUUURRRLLLRRRBBBDBUBBB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 E' S2 D' S2", wrong: 32, blank: 0, designs: 2, variants: [], figures: [56,381,16,56,381,16] },
  { look: "BDFDUDBDFLLLRRRLLLDFUBFBDFUFUBUDUFUBRRRLLLRRRDBUFBFDBU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 E' S2 U S2", wrong: 40, blank: 0, designs: 1, variants: [], figures: [56,56,16,56,56,16] },
  { look: "BUFDUDBUFLLLRRRLLLDBUBFBDBUFDBUDUFDBRRRLLLRRRDFUFBFDFU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 E2 S2 D M2", wrong: 40, blank: 0, designs: 1, variants: [], figures: [56,16,56,56,16,56] },
  { look: "BDFUUUBDFLRLLRLLRLDFUBFBDFUFUBDDDFUBRLRRLRRLRDBUFBFDBU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 S2 D' M2 D2", wrong: 36, blank: 0, designs: 1, variants: [], figures: [56,56,56,56,56,56] },
  { look: "BUBDUUBUBRRRRRRRRRUFUBFFUFUFDFUDDFDFLLLLLLLLLDBDBBFDBD", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 S2 D' M2 S2", wrong: 20, blank: 2, designs: 1, variants: [], figures: [511,58,58,511,58,58] },
  { look: "BUFUUUBUFLLLRRRLLLDBUBFBDBUFDBDDDFDBRRRLLLRRRDFUFBFDFU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 S2 D' M2 U2", wrong: 36, blank: 0, designs: 1, variants: [], figures: [56,16,186,56,16,186] },
  { look: "BUDFUUBUDRRRRRRRRRUFBDFFUFBFDUBDDFDULLLLLLLLLFBDBBUFBD", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 S2 D2 M2 S2", wrong: 20, blank: 2, designs: 1, variants: [], figures: [511,58,58,511,58,58] },
  { look: "DRDUUUURURRLDRDRRLFFFFFFFFFDLDDDDULURLLULURLLBBBBBBBBB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 S2 U M2 S2", wrong: 16, blank: 2, designs: 1, variants: [], figures: [511,61,61,511,61,61] },
  { look: "FUUBUDFUURRRRRRRRRDFFUFBDFFBDDFDUBDDLLLLLLLLLBBUFBDBBU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 S2 U2 M2 S2", wrong: 16, blank: 2, designs: 1, variants: [], figures: [511,61,61,511,61,61] },
  { look: "DLDUUUDLDLRLDRDLRLFBFBFBFBFURUDDDURURLRULURLRBFBFBFBFB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 U D M2 D", wrong: 32, blank: 0, designs: 1, variants: [], figures: [341,56,56,341,56,56] },
  { look: "BUFDUUBUFRLRLRLRLRUFDFFBUFDFDBUDDFDBLRLRLRLRLUBDFBBUBD", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 U D M2 U'", wrong: 28, blank: 0, designs: 1, variants: [], figures: [341,58,58,341,58,58] },
  { look: "UDUDUDUUURLRLRRRLRFFFFFFFFFDDDUDUDUDLRLLLRLRLBBBBBBBBB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 U D S2 D", wrong: 12, blank: 2, designs: 1, variants: [], figures: [511,343,343,511,343,343] },
  { look: "FDBBUBFDBRRRRRRRRRDBUDFDDBUBUFFDFBUFLLLLLLLLLDFUUBUDFU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 U D S2 U'", wrong: 32, blank: 2, designs: 1, variants: [], figures: [511,16,16,511,16,16] },
  { look: "UDUDUDUDURBRRRRRBRFLFFFFFLFDUDUDUDUDLFLLLLLFLBRBBBBBRB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 U' D' M2 D", wrong: 16, blank: 0, designs: 1, variants: [], figures: [341,381,381,341,381,381] },
  { look: "DDDDUDDUDLLLLRRLLLFFFFFFFFFUDUUDUUUURRRLLRRRRBBBBBBBBB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 U' D' S2 D", wrong: 28, blank: 2, designs: 1, variants: [], figures: [511,18,18,511,18,18] },
  { look: "DDDFUUDDDRLRRRRRLRBBBFFUBBBUUUBDDUUULLLRLRLLLFFFDBBFFF", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 U' M S2 M", wrong: 32, blank: 0, designs: 1, variants: [], figures: [381,18,18,381,18,18] },
  { look: "UDUUUUUDURBRRRRRLRFBFFFFFLFDDDUDUDDDLFLLLLLRLBFBBBBBRB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U M2 U' S' M2 S'", wrong: 12, blank: 0, designs: 1, variants: [], figures: [381,381,381,381,381,381] },
  { look: "UDUBUFUDURLRLRLRLRFFFUFDFFFDUDFDBDUDLRLRLRLRLBBBUBDBBB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U R2 E2 L2 S2 D'", wrong: 20, blank: 0, designs: 1, variants: [], figures: [341,341,381,341,341,381] },
  { look: "BDFDUDBDFRLRLRLRLRUFDBFBUFDFUBUDUFUBLRLRLRLRLUBDFBFUBD", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U R2 E2 L2 S2 U", wrong: 36, blank: 0, designs: 1, variants: [], figures: [341,16,56,341,16,56] },
  { look: "BDBBUDBDBLRLLRLLRLDBDBFDDBDFUFFDUFUFRRRLLLRRRUFUUBFUFU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U R2 E2 R2 S2 D'", wrong: 44, blank: 0, designs: 1, variants: [], figures: [56,16,16,56,16,16] },
  { look: "DDDDUDURULLRLRULLRBFBBFBBFBDLDUDUUUULRRDLRLRRFFFBBBFFF", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U R2 E2 R2 S2 U", wrong: 36, blank: 0, designs: 1, variants: [], figures: [56,21,21,56,21,21] },
  { look: "BDBBUFBDBLLLLRLLLLDBDUFDDBDFUFFDBFUFRRRRLRRRRUFUUBDUFU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U R2 E2 S2 R2 D'", wrong: 48, blank: 0, designs: 1, variants: [], figures: [16,16,16,16,16,16] },
  { look: "DDDDUDDDDLLLLRLRLRFBFBFBBBBUUUUDUUUURRRRLRLRLBFBFBFFFF", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U R2 E2 S2 R2 U", wrong: 40, blank: 0, designs: 1, variants: [], figures: [16,21,21,16,21,21] },
  { look: "DDDUUUDDDLRLRRRLRLFBFFFFFBFUUUDDDUUURLRLLLRLRBFBBBBBFB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 M S2 M D2 S2", wrong: 24, blank: 0, designs: 1, variants: [], figures: [381,186,56,381,186,56] },
  { look: "UDUUUUUDURLRRRRRLRFFFFFFFFFDUDDDDDUDLRLLLLLRLBBBBBBBBB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 M S2 M U2 S2", wrong: 8, blank: 2, designs: 1, variants: [], figures: [381,381,511,381,381,511] },
  { look: "BUDUUFBUDRRRRRRRRRUFBFFDUFBFDUDDBFDULLLLLLLLLFBDUBBFBD", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 M2 S2 D M2 S2", wrong: 20, blank: 2, designs: 1, variants: [], figures: [511,58,58,511,58,58] },
  { look: "DDDDUDDDDLRLLRLRLRFBFBFBBFBUUUUDUUUURLRRLRLRLBFBFBFFBF", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 M2 S2 D2 L2 E2", wrong: 36, blank: 0, designs: 1, variants: [], figures: [113,16,113,113,16,113] },
  { look: "FUUDUBFUURRRRRRRRRDFFBFUDFFBDDUDFBDDLLLLLLLLLBBUDBFBBU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 M2 S2 U M2 S2", wrong: 16, blank: 2, designs: 1, variants: [], figures: [511,61,61,511,61,61] },
  { look: "UDUDUDUDURLRRRRRLRFFFFFFFFFDUDUDUDUDLRLLLLLRLBBBBBBBBB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 M2 U D M2 E", wrong: 12, blank: 2, designs: 1, variants: [], figures: [341,381,511,341,381,511] },
  { look: "DDDUUUDDDLRLRRRLRLFBFBFBFBFUUUDDDUUURLRLLLRLRBFBFBFBFB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 M2 U D M2 E'", wrong: 28, blank: 0, designs: 1, variants: [], figures: [341,186,56,341,186,56] },
  { look: "UDUDUDUDURRRLRLRRRFFFFFFFFFDUDUDUDUDLLLRLRLLLBBBBBBBBB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 R2 E2 L2 S2 D2", wrong: 12, blank: 2, designs: 1, variants: [], figures: [341,381,511,341,381,511] },
  { look: "DDDDUDDDDLRLLRLLRLFBFBFBFBFUUUUDUUUURLRRLRRLRBFBFBFBFB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 R2 E2 L2 S2 U2", wrong: 36, blank: 0, designs: 1, variants: [], figures: [341,16,56,341,16,56] },
  { look: "DDDUUUDDDLLLRRRLLLFBFBFBFBFUUUDDDUUURRRLLLRRRBFBFBFBFB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 R2 E2 L2 U2 S2", wrong: 32, blank: 0, designs: 1, variants: [], figures: [341,56,56,341,56,56] },
  { look: "DDDDUDDDDLRLLRLLRLFBFFFFFBFUUUUDUUUURLRRLRRLRBFBBBBBFB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 R2 E2 R2 S2 D2", wrong: 32, blank: 0, designs: 1, variants: [], figures: [56,16,381,56,16,381] },
  { look: "DDDUUUDDDLLLRRRLLLFBFFFFFBFUUUDDDUUURRRLLLRRRBFBBBBBFB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 R2 E2 S2 L2 U2", wrong: 28, blank: 0, designs: 1, variants: [], figures: [381,56,56,381,56,56] },
  { look: "BDFBUFBDFLLLLRLLLLDBUUFDDBUFUBFDBFUBRRRRLRRRRDFUUBDDFU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 R2 E2 S2 R2 E", wrong: 48, blank: 0, designs: 1, variants: [], figures: [16,16,16,16,16,16] },
  { look: "DDDDUDDDDLLLLRLRRRFFFBFBBBBUUUUDUUUURRRRLRLLLBBBFBFFFF", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 R2 S E2 S' R2", wrong: 36, blank: 0, designs: 1, variants: [], figures: [16,23,23,16,23,23] },
  { look: "BDFBUFBDFLRLRRRLRLDFUUFDDFUFUBFDBFUBRLRLLLRLRDBUUBDDBU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 R2 S2 L2 E S2", wrong: 36, blank: 0, designs: 1, variants: [], figures: [186,16,56,186,16,56] },
  { look: "BDFFUBBDFLRLRRRLRLDFUDFUDFUFUBBDFFUBRLRLLLRLRDBUDBUDBU", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 R2 S2 L2 S2 E", wrong: 36, blank: 0, designs: 1, variants: [], figures: [186,56,16,186,56,16] },
  { look: "DUDUUUDUDLRLRRRLRLFBFFFFFBFUDUDDDUDURLRLLLRLRBFBBBBBFB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 R2 S2 L2 S2 U2", wrong: 20, blank: 0, designs: 1, variants: [], figures: [186,186,381,186,186,381] },
  { look: "DDDDUDDDDLRLRRRLRLFBFBFBFBFUUUUDUUUURLRLLLRLRBFBFBFBFB", order: 4, moves: null, alg: null, sliceMoves: 6, sliceAlg: "U2 R2 S2 L2 U2 M2", wrong: 32, blank: 0, designs: 1, variants: [], figures: [16,341,186,16,341,186] },
  { look: "BBBBUBBBBDDDDRDDDDRRRRFRRRRFFFFDFFFFUUUULUUUULLLLBLLLL", order: 3, moves: null, alg: null, sliceMoves: 4, sliceAlg: "M S' M' S", wrong: 48, blank: 0, designs: 1, variants: [], figures: [16,16,16,16,16,16], name: "Six Spots", book: "U D' R L' F B' U D'" },
].map(Object.freeze));

export const SET_PATTERNS = Object.freeze([
  { id: "plus-every-face", name: "a plus on every face", free: "all eight corners", size: 44089920, n: 6, of: 10, meanMoves: 10.8, meanSolve: 19.3, parts: ["crossEdges","midEdges","topEdges"] },
  { id: "x-every-face", name: "an X on every face", free: "all twelve edges", size: 490497638400, n: 10, of: 10, meanMoves: 8.9, meanSolve: 19.4, parts: ["dCorners","uCorners"] },
].map(Object.freeze));
