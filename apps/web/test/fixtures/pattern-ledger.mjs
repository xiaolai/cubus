// The pattern ledger. GENERATED — do not hand-edit.
//
//   regenerate: node apps/web/bench/pattern-ledger.mjs 7 --emit
//   re-verify:  node --test apps/web/test/pattern-ledger.test.mjs
//
// Every picture within 7 moves of solved that is fixed by at least 4 of the 24
// whole-cube rotations AND leaves every piece turned the right way up — which is what "pretty" means
// once it is made mechanical, and is the property a checkerboard, a ring of dots and a cube-in-a-cube
// all share. The search was exhaustive for that radius, so an entry's `moves` is a proved minimum
// over the whole radius and not a best effort.
//
// TWO CUTS, AND BOTH ARE PART OF THE CLAIM.
//
// ORDER. Pictures fixed by exactly two of the 24 are found and COUNTED and not kept — at depth
// 7 there are over a hundred thousand such maneuvers, and a ledger of them is a database rather
// than a list. So this file is complete for order 4 and above, and says nothing about
// order 2. The first version of this header said "more than one", which claimed a completeness it does
// not have.
//
// TWIST. 72 of the 213 pictures above the order cut cannot be
// reached inside the radius without leaving a corner twisted or an edge flipped, and are cut too
// (owner's call, 2026-09-12). A permuted piece reads as design, because the whole piece moved; a
// twisted corner shows ONE sticker of the wrong colour inside an otherwise clean block, and a child
// cannot tell that from a misscramble.
//
// `moves` is the proved minimum among UNTWISTED routes, which could in principle be longer than the
// proved minimum over all routes. Measured: for every picture kept here it is not — the shortest route to a
// picture that can be reached straight at all is already a straight one.
//
// The cut is on ROUTES and not on pictures, which is the opposite of how it was first written. Twist is
// measured against the cube's own CENTRES, the only frame a child has, while `canonicalLook` renames
// colours as it rotates — so two maneuvers can reach one look and disagree about whether a piece is
// twisted. Of 720 picture-and-view pairs, 192 read differently about orientation under that renaming.
// An assertion in the generator caught the wrong version on its first run; the notes there say why.
//
// `look` is the canonical facelet string: the smallest of the picture's 24 views, so two cubes that
// are the same picture held differently are one entry. `order` is how many views leave it unchanged.
// `alg` is one shortest maneuver to it, and there are usually others.
//
// The solved cube is deliberately absent. It is order 24 at zero moves and it is what patterns are
// measured FROM, not one of them.
//
// SET patterns are not in here and cannot be: they are defined by what they leave free rather than by
// a cube, so no walk reaches them. They live in `SET_PATTERNS` below, with their sizes derived.

export const LEDGER_DEPTH = 7;

export const STATE_PATTERNS = Object.freeze([
  { look: "UDUDUDUDURLRLRLRLRFBFBFBFBFDUDUDUDUDLRLRLRLRLBFBFBFBFB", order: 24, moves: 6, alg: "D2 U2 L2 R2 B2 F2", wrong: 24, blank: 0, designs: 1, variants: [], figures: [341,341,341,341,341,341], name: "The Checkerboard" },
  { look: "BUFBUFBUFRRRRRRRRRUFDUFDUFDFDBFDBFDBLLLLLLLLLUBDUBDUBD", order: 8, moves: 2, alg: "D U", wrong: 24, blank: 2, designs: 1, variants: ["D' U'"], figures: [511,56,56,511,56,56] },
  { look: "DDDUUUDDDLRLLRLLRLFFFFFFFFFUUUDDDUUURLRRLRRLRBBBBBBBBB", order: 8, moves: 2, alg: "D2 U2", wrong: 24, blank: 2, designs: 1, variants: [], figures: [511,56,56,511,56,56] },
  { look: "DDDUUUDDDRLRLRLRLRBBBFFFBBBUUUDDDUUULRLRLRLRLFFFBBBFFF", order: 8, moves: 4, alg: "D2 U2 L2 R2", wrong: 32, blank: 0, designs: 1, variants: [], figures: [56,56,341,56,56,341] },
  { look: "DDDDUDDDDLLLLRLLLLFBFBFBFBFUUUUDUUUURRRRLRRRRBFBFBFBFB", order: 8, moves: 6, alg: "U2 L2 R2 B2 F2 U2", wrong: 40, blank: 0, designs: 1, variants: [], figures: [341,16,16,341,16,16] },
  { look: "DDDFUBDDDRLRLRLRLRBBBDFUBBBUUUBDFUUULRLRLRLRLFFFDBUFFF", order: 8, moves: 6, alg: "U L2 R2 B2 F2 U'", wrong: 40, blank: 0, designs: 1, variants: ["U' L2 R2 B2 F2 U"], figures: [341,16,16,341,16,16] },
  { look: "DDDUUUDDDRRRRRRRRRBBBFFFBBBUUUDDDUUULLLLLLLLLFFFBBBFFF", order: 8, moves: 6, alg: "U2 R2 D2 U2 R2 D2", wrong: 24, blank: 2, designs: 1, variants: [], figures: [56,56,511,56,56,511] },
  { look: "FDBFUBFDBRLRLRLRLRDBUDFUDBUBUFBDFBUFLRLRLRLRLDFUDBUDFU", order: 8, moves: 6, alg: "D U L2 R2 B2 F2", wrong: 40, blank: 0, designs: 2, variants: ["D' U' L2 R2 B2 F2","L2 R2 B2 F2 D U","L2 R2 B2 F2 D' U'"], figures: [341,16,16,341,16,16] },
  { look: "FDBUUUFDBRLRLRLRLRDBUFFFDBUBUFDDDBUFLRLRLRLRLDFUBBBDFU", order: 8, moves: 6, alg: "U L2 R2 B2 F2 D", wrong: 32, blank: 0, designs: 1, variants: ["U' L2 R2 B2 F2 D'"], figures: [341,56,56,341,56,56] },
  { look: "UDUDUDUDURRRLRLRRRFFFBFBFFFDUDUDUDUDLLLRLRLLLBBBFBFBBB", order: 8, moves: 6, alg: "U2 L2 R2 B2 F2 D2", wrong: 16, blank: 0, designs: 1, variants: [], figures: [341,381,381,341,381,381] },
  { look: "BDFBUFBDFRRRRRRRRRUBDUFDUBDFUBFDBFUBLLLLLLLLLUFDUBDUFD", order: 8, moves: 7, alg: "U2 L2 R2 D U' B2 F2", wrong: 32, blank: 2, designs: 1, variants: ["U2 L2 R2 D' U B2 F2"], figures: [511,16,16,511,16,16] },
  { look: "BDFDUDBDFRLRLRLRLRUBDBFBUBDFUBUDUFUBLRLRLRLRLUFDFBFUFD", order: 8, moves: 7, alg: "U L2 R2 B2 F2 D' U2", wrong: 40, blank: 0, designs: 1, variants: ["U' L2 R2 B2 F2 D U2"], figures: [341,16,16,341,16,16] },
  { look: "BUFFUBBUFRLRLRLRLRUFDDFUUFDFDBBDFFDBLRLRLRLRLUBDDBUUBD", order: 8, moves: 7, alg: "L2 R2 D U' L2 R2 D2", wrong: 32, blank: 0, designs: 2, variants: ["L2 R2 D U' L2 R2 U2","U2 L2 R2 D U' L2 R2","U2 L2 R2 D' U L2 R2"], figures: [341,56,56,341,56,56] },
  { look: "UDUBUFUDURLRLRLRLRFBFUFDFBFDUDFDBDUDLRLRLRLRLBFBUBDBFB", order: 8, moves: 7, alg: "U L2 R2 B2 F2 D2 U", wrong: 24, blank: 0, designs: 1, variants: ["U' L2 R2 B2 F2 D2 U'"], figures: [341,341,341,341,341,341] },
  { look: "BUUBUUBUURRRRRRRRRUFFUFFUFFFDDFDDFDDLLLLLLLLLBBDBBDBBD", order: 4, moves: 1, alg: "U", wrong: 12, blank: 2, designs: 1, variants: ["U'"], figures: [511,63,63,511,63,63] },
  { look: "DDDUUUUUURRLRRLRRLFFFFFFFFFDDDDDDUUURLLRLLRLLBBBBBBBBB", order: 4, moves: 1, alg: "U2", wrong: 12, blank: 2, designs: 1, variants: [], figures: [511,63,63,511,63,63] },
  { look: "BUBBUBBUBRRRRRRRRRUFUUFUUFUFDFFDFFDFLLLLLLLLLDBDDBDDBD", order: 4, moves: 2, alg: "D U'", wrong: 24, blank: 2, designs: 1, variants: [], figures: [511,56,56,511,56,56] },
  { look: "BUDBUDBUDRRRRRRRRRUFBUFBUFBFDUFDUFDULLLLLLLLLFBDFBDFBD", order: 4, moves: 2, alg: "D U2", wrong: 24, blank: 2, designs: 1, variants: ["D2 U'"], figures: [511,56,56,511,56,56] },
  { look: "BDFBUFBDFLRLLRLLRLDFUDFUDFUFUBFDBFUBRLRRLRRLRDBUDBUDBU", order: 4, moves: 4, alg: "D U L2 R2", wrong: 40, blank: 0, designs: 2, variants: ["D' U' L2 R2","L2 R2 D U","L2 R2 D' U'"], figures: [56,56,16,56,56,16] },
  { look: "DDDDUDDDDLRLLRLLRLFFFFFFFFFUUUUDUUUURLRRLRRLRBBBBBBBBB", order: 4, moves: 4, alg: "U2 L2 R2 D2", wrong: 28, blank: 2, designs: 1, variants: [], figures: [56,511,16,56,511,16] },
  { look: "DDDUUUDDDRLRRRRRLRBBBFFFBBBUUUDDDUUULRLLLLLRLFFFBBBFFF", order: 4, moves: 4, alg: "U2 L2 R2 U2", wrong: 28, blank: 0, designs: 1, variants: [], figures: [56,56,381,56,56,381] },
  { look: "BDFFUBBDFLRLLRLLRLDFUDFUDFUFUBBDFFUBRLRRLRRLRDBUDBUDBU", order: 4, moves: 5, alg: "D U' L2 R2 D2", wrong: 40, blank: 0, designs: 2, variants: ["D U' L2 R2 U2","U2 L2 R2 D U'","U2 L2 R2 D' U"], figures: [56,56,16,56,56,16] },
  { look: "DDBUUFDDBRLRLRLRLRBBUFFDBBUUUFDDBUUFLRLRLRLRLDFFUBBDFF", order: 4, moves: 5, alg: "L2 R2 B2 F2 U", wrong: 36, blank: 0, designs: 2, variants: ["L2 R2 B2 F2 U'","U L2 R2 B2 F2","U' L2 R2 B2 F2"], figures: [341,18,18,341,18,18] },
  { look: "DDUUUDDDURLRLRLRLRBBFFFBBBFUUDDDUUUDLRLRLRLRLBFFFBBBFF", order: 4, moves: 5, alg: "D2 U2 L2 R2 F2", wrong: 28, blank: 0, designs: 2, variants: ["U2 L2 R2 B2 F2"], figures: [113,113,341,113,113,341] },
  { look: "BDBBUBBDBRRRRRRRRRUBUUFUUBUFUFFDFFUFLLLLLLLLLDFDDBDDFD", order: 4, moves: 6, alg: "L2 R2 D U' B2 F2", wrong: 32, blank: 2, designs: 1, variants: [], figures: [511,16,16,511,16,16] },
  { look: "BDBDUUBDBRLRLRLRLRUBUBFFUBUFUFUDDFUFLRLRLRLRLDFDBBFDFD", order: 4, moves: 6, alg: "U L2 R2 B2 F2 D'", wrong: 36, blank: 0, designs: 1, variants: ["U' L2 R2 B2 F2 D"], figures: [341,18,18,341,18,18] },
  { look: "BDBFUFBDBRLRLRLRLRUBUDFDUBUFUFBDBFUFLRLRLRLRLDFDUBUDFD", order: 4, moves: 6, alg: "D U' L2 R2 B2 F2", wrong: 40, blank: 0, designs: 1, variants: [], figures: [341,16,16,341,16,16] },
  { look: "BDDDUBBDDRLRLRLRLRUBBBFUUBBFUUUDFFUULRLRLRLRLFFDDBFFFD", order: 4, moves: 6, alg: "U L2 R2 B2 F2 U2", wrong: 40, blank: 0, designs: 2, variants: ["U' L2 R2 B2 F2 U2","U2 L2 R2 B2 F2 U","U2 L2 R2 B2 F2 U'"], figures: [341,16,16,341,16,16] },
  { look: "BDFFUBBDFLLLLRLLLLDFUDFUDFUFUBBDFFUBRRRRLRRRRDBUDBUDBU", order: 4, moves: 6, alg: "D U R2 B2 F2 L2", wrong: 44, blank: 0, designs: 2, variants: ["D' U' R2 B2 F2 L2","R2 B2 F2 L2 D U","R2 B2 F2 L2 D' U'"], figures: [16,16,56,16,16,56] },
  { look: "BUBBUDBUBLRLLRLLRLDFDBFDDFDFDFFDUFDFRRRLLLRRRUBUUBFUBU", order: 4, moves: 6, alg: "U R2 D2 U2 R2 U'", wrong: 36, blank: 0, designs: 1, variants: ["U' R2 D2 U2 R2 U"], figures: [56,56,56,56,56,56] },
  { look: "BUBFUFBUBRLRLRLRLRUFUDFDUFUFDFBDBFDFLRLRLRLRLDBDUBUDBD", order: 4, moves: 6, alg: "L2 R2 D U' L2 R2", wrong: 32, blank: 0, designs: 1, variants: [], figures: [341,56,56,341,56,56] },
  { look: "BUFBUFBUFLLLRRRLLLDFUDFUDFUFDBFDBFDBRRRLLLRRRDBUDBUDBU", order: 4, moves: 6, alg: "D U R2 D2 U2 R2", wrong: 36, blank: 0, designs: 2, variants: ["D' U' R2 D2 U2 R2","R2 D2 U2 R2 D U","R2 D2 U2 R2 D' U'"], figures: [56,56,56,56,56,56] },
  { look: "BUFBUFBUFRLRLRLRLRUFDDFUUFDFDBFDBFDBLRLRLRLRLUBDDBUUBD", order: 4, moves: 6, alg: "L2 R2 D U L2 R2", wrong: 32, blank: 0, designs: 1, variants: ["L2 R2 D' U' L2 R2"], figures: [341,56,56,341,56,56] },
  { look: "DDDDUDDDDLLLRRRLLLFBFBFBFBFUUUUDUUUURRRLLLRRRBFBFBFBFB", order: 4, moves: 6, alg: "U2 R2 B2 F2 L2 U2", wrong: 36, blank: 0, designs: 1, variants: [], figures: [16,341,56,16,341,56] },
  { look: "DDDDUDDDDLLLRRRLLLFBFFFFFBFUUUUDUUUURRRLLLRRRBFBBBBBFB", order: 4, moves: 6, alg: "U2 R2 B2 F2 R2 U2", wrong: 32, blank: 0, designs: 1, variants: [], figures: [381,56,16,381,56,16] },
  { look: "DDDDUDDDDLLLRRRLLLFFFBFBFFFUUUUDUUUURRRLLLRRRBBBFBFBBB", order: 4, moves: 6, alg: "D U' L2 R2 D U'", wrong: 32, blank: 0, designs: 1, variants: [], figures: [56,381,16,56,381,16] },
  { look: "DDDDUDDDDLLLRRRLLLFFFFFFFFFUUUUDUUUURRRLLLRRRBBBBBBBBB", order: 4, moves: 6, alg: "D U L2 R2 D' U'", wrong: 28, blank: 2, designs: 1, variants: [], figures: [56,511,16,56,511,16] },
  { look: "DDDFUUDDDRRRLRLRRRBBBFFUBBBUUUBDDUUULRLLLLLRLFFFDBBFFF", order: 4, moves: 6, alg: "U R2 B2 F2 R2 U'", wrong: 32, blank: 0, designs: 1, variants: ["U' R2 B2 F2 R2 U"], figures: [381,18,18,381,18,18] },
  { look: "DDDUUUDDDLLLRRRLLLFFFBFBFFFUUUDDDUUURRRLLLRRRBBBFBFBBB", order: 4, moves: 6, alg: "D U L2 R2 D U", wrong: 28, blank: 0, designs: 1, variants: [], figures: [56,56,381,56,56,381] },
  { look: "DDDUUUDDDLLLRRRLLLFFFFFFFFFUUUDDDUUURRRLLLRRRBBBBBBBBB", order: 4, moves: 6, alg: "U2 R2 D2 U2 R2 U2", wrong: 24, blank: 2, designs: 1, variants: [], figures: [56,511,56,56,511,56], name: "Lines" },
  { look: "DDDUUUDDDLRLRRRLRLFFFBFBFFFUUUDDDUUURLRLLLRLRBBBFBFBBB", order: 4, moves: 6, alg: "D U' L2 R2 D' U", wrong: 24, blank: 0, designs: 1, variants: [], figures: [56,186,381,56,186,381] },
  { look: "DDDUUUDDDLRLRRRLRLFFFFFFFFFUUUDDDUUURLRLLLRLRBBBBBBBBB", order: 4, moves: 6, alg: "U2 L2 R2 U2 L2 R2", wrong: 20, blank: 2, designs: 1, variants: [], figures: [511,56,186,511,56,186], name: "Plus/Minus" },
  { look: "DDDUUUDDDRFRRRRLLLBBBFFFFRFUDUUDUUDULBLLLLRRRFFFBBBBLB", order: 4, moves: 6, alg: "U R2 D2 U2 R2 D", wrong: 28, blank: 0, designs: 1, variants: ["U' R2 D2 U2 R2 D'"], figures: [56,61,61,56,61,61] },
  { look: "DDUFUFDDURLRLRLRLRBBFDFDBBFUUDBDBUUDLRLRLRLRLBFFUBUBFF", order: 4, moves: 6, alg: "U L2 R2 B2 F2 U", wrong: 32, blank: 0, designs: 1, variants: ["U' L2 R2 B2 F2 U'"], figures: [341,21,21,341,21,21] },
  { look: "FDBBUFFDBRRRLRLRRRDBUDFUDBUBUFFDBBUFLLLRLRLLLDFUDBUDFU", order: 4, moves: 6, alg: "D U R2 B2 F2 R2", wrong: 36, blank: 0, designs: 2, variants: ["D' U' R2 B2 F2 R2","R2 B2 F2 R2 D U","R2 B2 F2 R2 D' U'"], figures: [381,16,16,381,16,16] },
  { look: "FDBBUFFDBRRRRRRRRRDBUDFUDBUBUFFDBBUFLLLLLLLLLDFUDBUDFU", order: 4, moves: 6, alg: "L2 R2 D U B2 F2", wrong: 32, blank: 2, designs: 1, variants: ["L2 R2 D' U' B2 F2"], figures: [511,16,16,511,16,16] },
  { look: "FDBBUUFDBRLRRRRRLRDBUFFDDBUBUFFDDBUFLLLRLRLLLDFUUBBDFU", order: 4, moves: 6, alg: "U R2 B2 F2 R2 D", wrong: 32, blank: 0, designs: 1, variants: ["U' R2 B2 F2 R2 D'"], figures: [381,18,18,381,18,18] },
  { look: "FDBFUBFDBRRRRRRRRRDFUDFUDFUBUFBDFBUFLLLLLLLLLDBUDBUDBU", order: 4, moves: 6, alg: "U R2 D2 U2 L2 D", wrong: 28, blank: 2, designs: 1, variants: ["U' R2 D2 U2 L2 D'"], figures: [511,56,16,511,56,16] },
  { look: "FDUDUBFDURLRLRLRLRDBFBFUDBFBUDUDFBUDLRLRLRLRLBFUDBFBFU", order: 4, moves: 6, alg: "D U2 L2 R2 B2 F2", wrong: 32, blank: 0, designs: 2, variants: ["D2 U' L2 R2 B2 F2","L2 R2 B2 F2 D U2","L2 R2 B2 F2 D2 U'"], figures: [341,21,21,341,21,21] },
  { look: "FDUUUFFDURLRLRLRLRDBFFFDDBFBUDDDBBUDLRLRLRLRLBFUUBBBFU", order: 4, moves: 6, alg: "U L2 R2 B2 F2 D2", wrong: 28, blank: 0, designs: 2, variants: ["U' L2 R2 B2 F2 D2","U2 L2 R2 B2 F2 D","U2 L2 R2 B2 F2 D'"], figures: [341,113,113,341,113,113] },
  { look: "UDUDUDUDURLRLRLRLRFBFFFFFBFDUDUDUDUDLRLRLRLRLBFBBBBBFB", order: 4, moves: 6, alg: "U2 L2 R2 U2 B2 F2", wrong: 20, blank: 0, designs: 1, variants: [], figures: [341,341,381,341,341,381] },
  { look: "UDUDUDUDURLRRRRRLRFFFBFBFFFDUDUDUDUDLRLLLLLRLBBBFBFBBB", order: 4, moves: 6, alg: "U2 R2 B2 F2 R2 D2", wrong: 16, blank: 0, designs: 1, variants: [], figures: [381,341,381,381,341,381] },
  { look: "UDUUUUUDURRRRRRRRRFFFFFFFFFDUDDDDDUDLLLLLLLLLBBBBBBBBB", order: 4, moves: 6, alg: "U2 R2 D2 U2 L2 D2", wrong: 4, blank: 4, designs: 1, variants: [], figures: [511,511,381,511,511,381] },
  { look: "BDBBUBBDBRLRLRLRLRUBUUFUUBUFUFFDFFUFLRLRLRLRLDFDDBDDFD", order: 4, moves: 7, alg: "U2 L2 R2 B2 F2 D U", wrong: 40, blank: 0, designs: 1, variants: [], figures: [341,16,16,341,16,16] },
  { look: "BDFDUBBDFRRRLRLRRRUBDDFBUBDFUBUDFFUBLRLLLLLRLUFDFBUUFD", order: 4, moves: 7, alg: "U R2 B2 F2 R2 D' U2", wrong: 36, blank: 0, designs: 1, variants: ["U' R2 B2 F2 R2 D U2"], figures: [381,16,16,381,16,16] },
  { look: "BDFDUUBDFRLRLRLRLRUBDFFBUBDFUBUDDFUBLRLRLRLRLUFDFBBUFD", order: 4, moves: 7, alg: "U L2 R2 D2 B2 F2 D'", wrong: 36, blank: 0, designs: 1, variants: ["U L2 R2 U2 B2 F2 D'"], figures: [341,18,18,341,18,18] },
  { look: "BDUBUUBDURRRRRRRRRUBFUFFUBFFUDFDDFUDLLLLLLLLLBFDBBDBFD", order: 4, moves: 7, alg: "U L2 R2 D U' B2 F2", wrong: 20, blank: 2, designs: 1, variants: ["U' L2 R2 D' U B2 F2"], figures: [511,23,23,511,23,23] },
  { look: "BUBUUBBUBLLLRRRLLLDFDDFFDFDFDFDDFFDFRLRRLRRLRUBUBBUUBU", order: 4, moves: 7, alg: "U R2 D2 U2 R2 D2 U", wrong: 32, blank: 0, designs: 1, variants: ["U' R2 D2 U2 R2 D2 U'"], figures: [56,58,58,56,58,58] },
  { look: "BUDFUUBUDRLRLRLRLRUFBDFFUFBFDUBDDFDULRLRLRLRLFBDBBUFBD", order: 4, moves: 7, alg: "L2 R2 D U' L2 R2 D'", wrong: 28, blank: 0, designs: 2, variants: ["L2 R2 D U' L2 R2 U","U L2 R2 D U' L2 R2","U' L2 R2 D' U L2 R2"], figures: [341,58,58,341,58,58] },
  { look: "BUFBUFBUFRRRRRRRRRUFDDFUUFDFDBFDBFDBLLLLLLLLLUBDDBUUBD", order: 4, moves: 7, alg: "D U' L2 R2 D2 L2 R2", wrong: 24, blank: 2, designs: 1, variants: ["D U' L2 R2 U2 L2 R2"], figures: [511,56,56,511,56,56] },
  { look: "BUUFUDBUURLRLRLRLRUFFDFBUFFFDDBDUFDDLRLRLRLRLBBDFBUBBD", order: 4, moves: 7, alg: "L2 R2 D U' L2 R2 D", wrong: 24, blank: 0, designs: 2, variants: ["L2 R2 D U' L2 R2 U'","U L2 R2 D' U L2 R2","U' L2 R2 D U' L2 R2"], figures: [341,61,61,341,61,61] },
  { look: "DDBDUBDDBRRRRRRRRRBBUBFUBBUUUFUDFUUFLLLLLLLLLDFFDBFDFF", order: 4, moves: 7, alg: "U L2 R2 D' U B2 F2", wrong: 32, blank: 2, designs: 1, variants: ["U' L2 R2 D U' B2 F2"], figures: [511,16,16,511,16,16] },
  { look: "DDBUUFDDBRRRRRRRRRBBUFFDBBUUUFDDBUUFLLLLLLLLLDFFUBBDFF", order: 4, moves: 7, alg: "U R2 F2 L2 R2 F2 L2", wrong: 28, blank: 2, designs: 1, variants: ["U' R2 F2 L2 R2 F2 L2"], figures: [511,18,18,511,18,18] },
  { look: "DDDBUBDDDRLRLRLRLRBBBDFDBBBUUUFDFUUULRLRLRLRLFFFUBUFFF", order: 4, moves: 7, alg: "U L2 R2 D2 B2 F2 U", wrong: 40, blank: 0, designs: 1, variants: [], figures: [341,16,16,341,16,16] },
  { look: "DDDDUDDDDLLLRRRRRRFFFFFFBBBUUUUDUUUURRRLLLLLLBBBBBBFFF", order: 4, moves: 7, alg: "U2 L R B2 F2 L' R'", wrong: 28, blank: 0, designs: 1, variants: [], figures: [16,63,63,16,63,63] },
  { look: "DDDUUUDDDLBLRRRRRRFFFFFFBLBUDUUDUUDURFRLLLLLLBBBBBBFRF", order: 4, moves: 7, alg: "U R2 D2 U2 R2 D' U2", wrong: 24, blank: 0, designs: 1, variants: ["U' R2 D2 U2 R2 D U2"], figures: [56,63,63,56,63,63] },
  { look: "DDDUUUDUDLRLLRRLRLFFFFFFFFFUDUDDDUUURLRLLRRLRBBBBBBBBB", order: 4, moves: 7, alg: "U L2 R2 U2 L2 R2 U", wrong: 20, blank: 2, designs: 1, variants: [], figures: [511,58,58,511,58,58] },
  { look: "DDUUUDDDURRRRRRRRRBBFFFBBBFUUDDDUUUDLLLLLLLLLBFFFBBBFF", order: 4, moves: 7, alg: "U2 R2 F2 L2 R2 F2 L2", wrong: 20, blank: 2, designs: 1, variants: [], figures: [511,113,113,511,113,113] },
  { look: "FDBBUFFDBRLRLRLRLRDBUDFUDBUBUFFDBBUFLRLRLRLRLDFUDBUDFU", order: 4, moves: 7, alg: "D U' L2 R2 D2 B2 F2", wrong: 40, blank: 0, designs: 1, variants: ["D U' L2 R2 U2 B2 F2"], figures: [341,16,16,341,16,16] },
  { look: "FUBBUBFUBRRRRRRRRRDFUDFDDFUBDFFDFBDFLLLLLLLLLDBUUBUDBU", order: 4, moves: 7, alg: "U L2 R2 D2 L2 R2 D'", wrong: 24, blank: 2, designs: 1, variants: ["U L2 R2 U2 L2 R2 D'"], figures: [511,56,56,511,56,56] },
  { look: "UDUBUBUDURLRLRLRLRFBFDFDFBFDUDFDFDUDLRLRLRLRLBFBUBUBFB", order: 4, moves: 7, alg: "U L2 R2 U2 B2 F2 U", wrong: 24, blank: 0, designs: 1, variants: [], figures: [341,341,341,341,341,341] },
  { look: "UDUBUDUDURRRLRLRRRFBFBFDFBFDUDFDUDUDLRLLLLLRLBFBUBFBFB", order: 4, moves: 7, alg: "U R2 B2 F2 R2 D2 U", wrong: 20, blank: 0, designs: 1, variants: ["U' R2 B2 F2 R2 D2 U'"], figures: [381,341,341,381,341,341] },
  { look: "UDUUUUUUURRRLRRRRRFFFFFFFFFDDDDDDDUDLLLLLRLLLBBBBBBBBB", order: 4, moves: 7, alg: "U L2 R2 D2 L2 R2 U", wrong: 4, blank: 2, designs: 1, variants: [], figures: [511,383,383,511,383,383] },
].map(Object.freeze));

export const SET_PATTERNS = Object.freeze([
  { id: "plus-every-face", name: "a plus on every face", free: "all eight corners", size: 44089920, n: 6, of: 10, meanMoves: 10.8, meanSolve: 19.3, parts: ["crossEdges","midEdges","topEdges"] },
  { id: "x-every-face", name: "an X on every face", free: "all twelve edges", size: 490497638400, n: 10, of: 10, meanMoves: 8.9, meanSolve: 19.4, parts: ["dCorners","uCorners"] },
].map(Object.freeze));
