//! What a case table's minimality claim has to SAY, and the checker that refuses anything less.
//!
//! Plan B2 and B3 (dev-docs/method-solver-return-plan.md §9), and both exist because of §7a
//! finding F3 and finding F4.
//!
//! **F3 — one goal's lower bound does not certify an OLL minimum.** An OLL algorithm's goal is a
//! SET: top oriented, first two layers intact, any last-layer permutation. The reduction §4 uses —
//! the optimal algorithm for case `C` is the shortest solution of `g⁻¹C` minimised over the 288
//! goal states `g` — means a claimed length `L` carries the obligation *"for every g, no solution
//! of `g⁻¹C` shorter than L"*. A certificate that exhausted the winning goal's contour and stopped
//! has ruled out shorter solutions TO THAT GOAL and nothing else; a shorter algorithm reaching a
//! different acceptable goal would sail through it. The state `U` is the small example: its
//! exact-solve distance is 1 and its OLL distance is 0.
//!
//! **F4 — `certificate.rs` cannot be reused for this.** Verified at `certificate.rs:60`: every
//! line whose `state=` is not `superflip` is silently skipped, so a file of case records reaches
//! the end of that checker having matched nothing. It does refuse an empty read — "no superflip
//! shard certificates found" — so the failure would be loud; it would just be the wrong question,
//! answered about a file it never looked at. Case records carry their own grammar and their own
//! obligations, and none of that has a shard checker to run through. An earlier revision of the
//! plan called the retrofit free. It is not, and this module is the cost.
//!
//! **F2L is a distance, but not in this cube.** This module's first revision said F2L could not be
//! a distance at all — its constraint is slot-safety, a property of the ALGORITHM on a solved cube
//! — and required an ENUMERATION instead: every shorter algorithm examined, none of them
//! slot-safe. That was wrong, and `f2l.rs` records the argument that replaces it. For a case whose
//! other slots are already home, "slot-safe and places the pair" and "every piece below the top
//! layer is home afterwards" are the same statement, and the second IS a distance — to a single
//! state, in the twelve-piece projection where the top layer does not exist.
//!
//! So F2L's obligation is a distance after all: nothing shorter than `L` reaches the goal. It
//! still does not carry a goal set, because there is exactly one goal and a set of one declared as
//! a set would be ceremony. The shape stays distinct from OLL's and PLL's, and `scope=` still says
//! which space the bound is in — a bound that did not say would be indistinguishable from a claim
//! about the whole cube, which is a different and much larger number.
//!
//! **The bound has two sources, and the record names both.** `floor=` is where the contour ladder
//! started, which is the heuristic's value at the case: an ADMISSIBLE heuristic of `h` is itself a
//! proof that nothing shorter than `h` exists, so those contours were never searched and never
//! needed to be. `bound=`/`nodes=` is the exhausted part above it. When the two meet — `floor` is
//! already `L`, the answer was the first contour tried — `nodes=0` is a COMPLETE lower bound and
//! not a missing one, which is thirteen of the F2L table's 42 rows. A checker that refused every zero
//! would have forced the generator to search contours it had already ruled out, to produce
//! evidence for something it had already proved.
//!
//! ## The grammar
//!
//! Whitespace-separated `key=value` tokens, one claim per line, the same discipline
//! `certificate.rs` uses — a field must appear EXACTLY once, so `result=NO-SOLUTION result=FOUND`
//! cannot pass on its friendlier half and `note=kind=oll` cannot smuggle a kind in.
//!
//! ```text
//! case-goals moveset=<hex> kind=oll goalset=<hex> size=288
//! case-alg   moveset=<hex> kind=oll case=oll:00112233 length=11 alg=R.U.R'.U.R.U2.R'
//! case-lower moveset=<hex> kind=oll case=oll:00112233 goal=17 bound=10 result=NO-SOLUTION
//! case-lower moveset=<hex> kind=f2l case=f2l:0a1b2c3d scope=f2l-projection floor=5 bound=6 nodes=41310 result=NO-SOLUTION
//! ```
//!
//! `alg` is dot-separated so it stays ONE token: a space-separated maneuver would break the
//! "a field is a whole token" rule that the smuggling refusals rest on.
//!
//! ## What the checker is told, and why it has to be told it
//!
//! Three things a certificate log cannot establish about itself, so all three come from the
//! caller (`Expect`):
//!
//! - **which cases must appear.** Counting them is not enough: replacing one case id with another
//!   throughout its records leaves the count right and the case missing, and a table with a case
//!   missing is a lookup that misses. The expected SET is compared, not its size.
//! - **which goal set the bounds are about, and how big it is.** The log declares both, and a log
//!   that declares `size=1` and carries one goal's evidence is internally consistent and proves
//!   almost nothing. `Expect::standard` supplies the values `gen-cases` actually generates
//!   against, and `gen-cases` asserts it produces those — so the two ends of the claim are pinned
//!   to one place rather than agreeing by habit.
//! - **the move set**, which was already checked and is the same kind of fact.
//!
//! ## The trust model, stated
//!
//! The same one `certificate.rs` states: the workers are our machines, their binaries one deployed
//! revision, their output collected over authenticated channels. This checker defends against
//! operational mistakes — a lost goal, a mixed-up log, a stale binary's move set, a partial run
//! pasted as complete. It is not a defence against forged lines, and no line here claims to be a
//! proof of work.

use crate::cases::{self, Kind};
use crate::cubie::MOVE_NAMES;
use crate::f2l;
use std::collections::{BTreeMap, BTreeSet};

/// God's number bounds every length and every contour a case certificate can mention, so anything
/// above it is a corrupt field rather than a surprising result. Fields are parsed against this
/// rather than cast: `bound=264` used to narrow to 8, and `size=4294967295` used to make the
/// missing-goal diagnostic ask for sixteen gigabytes.
const MAX_LENGTH: u64 = 20;

/// What a complete, mutually consistent case-certificate set proves.
#[derive(Debug, PartialEq, Eq)]
pub struct CaseProof {
    pub kind: String,
    /// How many cases carry a complete claim.
    pub cases: usize,
    /// The goal set every lower-bound record was taken against.
    pub goalset: String,
    /// How big that goal set is: 16 for PLL and 1,152 for OLL — the four alignments times the
    /// goals, because the alignment is part of the claim (`gen-cases`) — and 0 for F2L, whose
    /// obligation is not over a goal set at all.
    pub goals: u32,
    /// The table the evidence supports: `(case id, length, dot-separated algorithm)`, in case-id
    /// order. Returned rather than merely counted, because "the certificates check out" and "this
    /// is the table they check out FOR" are different statements — and a regeneration diff is read
    /// against the second. Sorted, so two machines print it identically.
    pub table: Vec<(String, u8, String)>,
}

/// What the caller says the log must be about — the specification a log cannot supply for itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Expect {
    pub kind: String,
    /// Every case id that must appear, and no others.
    pub cases: BTreeSet<String>,
    /// The goal set identity and cardinality the lower bounds must be taken against, or `None` for
    /// F2L, whose projection has exactly one goal and declares no set.
    pub goal_set: Option<(String, u32)>,
}

impl Expect {
    /// The specification for one of the three real kinds, derived from the case machinery rather
    /// than written down beside it.
    pub fn standard(kind: &str) -> Result<Expect, String> {
        let (cases, goal_set) = match kind {
            "oll" => (
                cases::case_ids(Kind::Oll),
                Some((OLL_GOAL_SET.0.to_string(), OLL_GOAL_SET.1)),
            ),
            "pll" => (
                cases::case_ids(Kind::Pll),
                Some((PLL_GOAL_SET.0.to_string(), PLL_GOAL_SET.1)),
            ),
            "f2l" => (f2l::case_ids(), None),
            other => return Err(format!("unknown case kind {other}")),
        };
        Ok(Expect {
            kind: kind.to_string(),
            cases,
            goal_set,
        })
    }
}

/// The goal sets `gen-cases` generates against: the product of the four alignments and the goals.
///
/// Here rather than in the generator so the producer and the checker cannot drift — `gen-cases`
/// asserts the identity and size it computed against these, so a change to either end fails at
/// the other.
pub const OLL_GOAL_SET: (&str, u32) = ("pll288xauf4", 1152);
pub const PLL_GOAL_SET: (&str, u32) = ("auf4xauf4", 16);

/// One case's claim, assembled from its lines.
#[derive(Default)]
struct Claim {
    length: Option<u8>,
    /// The algorithm this case's evidence is about, dot-separated. Carried out in `CaseProof`:
    /// a checker that could not quote what it accepted would make a regeneration diff unreadable.
    alg: Option<String>,
    /// Where the algorithm was declared, so a second one can name the first.
    alg_line: usize,
    /// Goal indices with a NO-SOLUTION record, and the bound each was taken at.
    lower: BTreeMap<u32, (u8, usize)>,
    /// The F2L shape: the exhausted bound, the nodes that exhausting it cost, the line.
    exhausted: Option<(u8, u64, usize)>,
}

/// The three kinds, and the shape of obligation each one carries.
fn is_goal_set_kind(kind: &str) -> bool {
    kind == "oll" || kind == "pll"
}

/// One record's fields, read as whole tokens.
///
/// A field is a whole whitespace token `key=value`, present EXACTLY once. Substring matching would
/// accept `note=kind=oll`; first-match extraction would let `result=NO-SOLUTION result=FOUND` pass
/// on its friendlier half.
struct Fields<'a> {
    line: &'a str,
    lineno: usize,
    record: &'a str,
}

impl Fields<'_> {
    fn optional(&self, key: &str) -> Result<Option<String>, String> {
        let mut hits = self
            .line
            .split_whitespace()
            .filter_map(|w| w.strip_prefix(key).map(str::to_string));
        let first = hits.next();
        if hits.next().is_some() {
            return Err(format!(
                "line {}: {key} appears more than once",
                self.lineno
            ));
        }
        Ok(first)
    }

    fn required(&self, key: &str) -> Result<String, String> {
        self.optional(key)?.ok_or(format!(
            "line {}: {} is missing {key}",
            self.lineno, self.record
        ))
    }

    /// A numeric field, parsed and RANGE-CHECKED rather than cast.
    ///
    /// `as u8` and `as u32` silently reinterpret: `bound=264` became 8, `floor=256` became 0, and
    /// `size=4294967296` became 0. Every one of those is a different claim wearing a plausible
    /// number, which is the failure a certificate exists to make impossible.
    fn number(&self, key: &str, max: u64) -> Result<u64, String> {
        let raw = self.required(key)?;
        let n: u64 = raw
            .parse()
            .map_err(|_| format!("line {}: {key} is not a number", self.lineno))?;
        if n > max {
            return Err(format!(
                "line {}: {key}={n} is above {max}, so it is not a {key} this checker can be about",
                self.lineno
            ));
        }
        Ok(n)
    }
}

/// Is every token of `alg` a face turn this crate knows?
///
/// Counting the separators is not validating the moves: `INVALID.INVALID.INVALID` counted three
/// and passed as a three-move algorithm, `R..U` counted three with an empty segment in the middle,
/// and `length=0` accepted any algorithm at all because the count was skipped entirely.
fn check_alg(alg: &str, length: u64, lineno: usize) -> Result<(), String> {
    if length == 0 {
        if !alg.is_empty() {
            return Err(format!(
                "line {lineno}: length 0 is the skip and carries no algorithm, but this one carries `{alg}`"
            ));
        }
        return Ok(());
    }
    if alg.is_empty() {
        return Err(format!("line {lineno}: length {length} with no algorithm"));
    }
    let moves: Vec<&str> = alg.split('.').collect();
    if moves.len() as u64 != length {
        return Err(format!(
            "line {lineno}: alg has {} moves but length says {length}",
            moves.len()
        ));
    }
    for m in &moves {
        if !MOVE_NAMES.contains(m) {
            return Err(format!(
                "line {lineno}: `{m}` is not a face turn — a case algorithm is HTM face turns only"
            ));
        }
    }
    Ok(())
}

/// A case id is `<kind>:<hex>`, and its kind must be the one being checked — an OLL key read as a
/// PLL key would be a claim about a different case entirely.
fn check_case_id(case: &str, kind: &str, lineno: usize) -> Result<(), String> {
    let Some((prefix, rest)) = case.split_once(':') else {
        return Err(format!("line {lineno}: case {case} is not <kind>:<key>"));
    };
    if prefix != kind {
        return Err(format!(
            "line {lineno}: case {case} is a {prefix} key on a {kind} record"
        ));
    }
    if rest.is_empty() || !rest.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("line {lineno}: case key {rest} is not hex"));
    }
    Ok(())
}

/// Everything the pass over the lines accumulated.
#[derive(Default)]
struct Read {
    /// The declared goal set, and the line that declared it.
    goalset: Option<(String, u32, usize)>,
    claims: BTreeMap<String, Claim>,
    /// Kinds seen that are not the one being checked — remembered so "no records found" can say
    /// what the log held instead.
    foreign_kinds: BTreeSet<String>,
}

/// `case-goals`: the declared goal set, which must be one goal set and not two.
fn read_goals(f: &Fields, kind: &str, state: &mut Read) -> Result<(), String> {
    let set = f.required("goalset=")?;
    let size = f.number("size=", u32::MAX as u64)? as u32;
    if is_goal_set_kind(kind) && size == 0 {
        return Err(format!(
            "line {}: a goal set of nothing certifies nothing",
            f.lineno
        ));
    }
    match &state.goalset {
        Some((prev, prev_size, first_line)) if *prev != set || *prev_size != size => Err(format!(
            "line {}: goal set {set}/{size} disagrees with line {first_line}",
            f.lineno
        )),
        Some(_) => Ok(()),
        None => {
            state.goalset = Some((set, size, f.lineno));
            Ok(())
        }
    }
}

/// `case-alg`: one case's length and the algorithm it is about.
fn read_alg(f: &Fields, kind: &str, state: &mut Read) -> Result<(), String> {
    let case = f.required("case=")?;
    check_case_id(&case, kind, f.lineno)?;
    let length = f.number("length=", MAX_LENGTH)?;
    let alg = f.required("alg=")?;
    check_alg(&alg, length, f.lineno)?;
    let claim = state.claims.entry(case.clone()).or_default();
    if let Some(previous) = claim.length {
        return Err(format!(
            "line {}: case {case} has two algorithms — the first, of length {previous}, is on line {}",
            f.lineno, claim.alg_line
        ));
    }
    claim.length = Some(length as u8);
    claim.alg = Some(alg);
    claim.alg_line = f.lineno;
    Ok(())
}

/// `case-lower` for OLL and PLL: one goal's exhausted contour.
fn read_goal_bound(
    f: &Fields,
    kind: &str,
    case: String,
    bound: u8,
    state: &mut Read,
) -> Result<(), String> {
    if f.optional("scope=")?.is_some() {
        return Err(format!(
            "line {}: scope= is the F2L shape; a {kind} bound is per goal",
            f.lineno
        ));
    }
    let goal = f.number("goal=", u32::MAX as u64)? as u32;
    let claim = state.claims.entry(case.clone()).or_default();
    if let Some((_, prev_line)) = claim.lower.get(&goal) {
        return Err(format!(
            "line {}: case {case} goal {goal} already certified on line {prev_line}",
            f.lineno
        ));
    }
    claim.lower.insert(goal, (bound, f.lineno));
    Ok(())
}

/// `case-lower` for F2L: one exhausted contour in a named projection.
fn read_f2l_bound(f: &Fields, case: String, bound: u8, state: &mut Read) -> Result<(), String> {
    // Missing and wrong are ONE refusal here on purpose: both mean the record does not say which
    // claim it is making, and a bound that could be read as a distance in the WHOLE cube is a much
    // weaker statement wearing the same number.
    if f.optional("scope=")?.as_deref() != Some("f2l-projection") {
        return Err(format!(
            "line {}: an f2l bound must state scope=f2l-projection — the space it is a distance in is the claim",
            f.lineno
        ));
    }
    if f.optional("goal=")?.is_some() {
        return Err(format!(
            "line {}: an f2l bound has no goal index; its projection has exactly one goal",
            f.lineno
        ));
    }
    let nodes = f.number("nodes=", u64::MAX)?;
    let floor = f.number("floor=", MAX_LENGTH)? as u8;
    if floor > bound + 1 {
        return Err(format!(
            "line {}: case {case} claims a floor of {floor} above its own bound of {bound}",
            f.lineno
        ));
    }
    // A zero is allowed in exactly one place: contours were skipped only when the heuristic had
    // already ruled them out. A record that skipped them AND had no floor to justify it is a bound
    // with nothing behind it.
    //
    // A floor of zero is NOT itself a refusal, which it used to be. A heuristic of zero rules
    // nothing out, but the condition below is about whether the contours were ACCOUNTED FOR — and
    // a record with nodes > 0 accounted for them by searching them.
    if nodes == 0 && floor != bound + 1 {
        return Err(format!(
            "line {}: case {case} searched nothing from a floor of {floor}, so contours {floor}..={bound} are unaccounted for",
            f.lineno
        ));
    }
    let claim = state.claims.entry(case.clone()).or_default();
    if let Some((_, _, prev)) = claim.exhausted {
        return Err(format!(
            "line {}: case {case} already exhausted on line {prev}",
            f.lineno
        ));
    }
    claim.exhausted = Some((bound, nodes, f.lineno));
    Ok(())
}

/// `case-lower`, either shape.
fn read_lower(f: &Fields, kind: &str, state: &mut Read) -> Result<(), String> {
    let case = f.required("case=")?;
    check_case_id(&case, kind, f.lineno)?;
    let bound = f.number("bound=", MAX_LENGTH)? as u8;
    // ONE validation of the result, before the shapes diverge. Both branches used to carry the
    // same three lines.
    let result = f.required("result=")?;
    if result != "NO-SOLUTION" {
        return Err(format!(
            "line {}: case {case} says {result}, not NO-SOLUTION",
            f.lineno
        ));
    }
    if is_goal_set_kind(kind) {
        read_goal_bound(f, kind, case, bound, state)
    } else {
        read_f2l_bound(f, case, bound, state)
    }
}

/// One pass over the lines, turning records into claims.
///
/// Non-certificate lines (progress chatter, blanks) are ignored. A line that BEGINS like a case
/// certificate and does not parse is an error: a mangled certificate must never pass as chatter.
fn read_records(lines: &[&str], local_hash_hex: &str, kind: &str) -> Result<Read, String> {
    let mut state = Read::default();
    for (n, raw) in lines.iter().enumerate() {
        let line = raw.trim();
        let record = match line.split_whitespace().next() {
            Some(w @ ("case-goals" | "case-alg" | "case-lower")) => w,
            _ => continue, // chatter, blanks, and the superflip records certificate.rs owns
        };
        let f = Fields {
            line,
            lineno: n + 1,
            record,
        };
        // Every record carries the move set it was produced against. A stale binary's table is
        // the operational mistake most likely to look like a valid result.
        let hash = f.required("moveset=")?;
        if hash != local_hash_hex {
            return Err(format!(
                "line {}: move-set hash {hash} does not match the local move set",
                f.lineno
            ));
        }
        let line_kind = f.required("kind=")?;
        if line_kind != kind {
            // Records for another kind in the same log are legitimate — they are simply not this
            // claim. Remembered so the report can say a whole table was checked against the wrong
            // expectation rather than silently reporting zero cases.
            state.foreign_kinds.insert(line_kind);
            continue;
        }
        match record {
            "case-goals" => read_goals(&f, kind, &mut state)?,
            "case-alg" => read_alg(&f, kind, &mut state)?,
            "case-lower" => read_lower(&f, kind, &mut state)?,
            _ => unreachable!("the match above admits exactly these three records"),
        }
    }
    Ok(state)
}

/// **F3, as the rule it is.** Every goal in the declared set, at exactly `L-1`.
fn check_goal_coverage(case: &str, claim: &Claim, length: u8, goals: u32) -> Result<(), String> {
    let want_bound = length - 1;
    for (goal, (bound, lineno)) in &claim.lower {
        if *goal >= goals {
            return Err(format!(
                "line {lineno}: case {case} certifies goal {goal}, which is outside the declared set of {goals}"
            ));
        }
        if *bound != want_bound {
            return Err(format!(
                "line {lineno}: case {case} claims length {length} but goal {goal} was only exhausted to {bound}"
            ));
        }
    }
    if claim.lower.len() as u32 == goals {
        return Ok(());
    }
    // The first eight missing indices, and a count of the rest. Collecting all of them allocated
    // one entry per goal in the DECLARED set, which a corrupt `size=` could make enormous —
    // sixteen gigabytes for a diagnostic about a file that is already being refused.
    let mut shown: Vec<u32> = Vec::new();
    let mut missing = 0u32;
    for g in 0..goals {
        if !claim.lower.contains_key(&g) {
            missing += 1;
            if shown.len() < 8 {
                shown.push(g);
            }
        }
    }
    Err(format!(
        "case {case} claims length {length} but {missing} of {goals} goals have no evidence: {shown:?}"
    ))
}

/// F2L: one exhausted contour, at exactly `L-1`.
fn check_exhaustion(case: &str, claim: &Claim, length: u8) -> Result<(), String> {
    let Some((bound, _nodes, lineno)) = claim.exhausted else {
        return Err(format!(
            "case {case} claims length {length} with no exhausted contour — a length nobody ruled anything out for"
        ));
    };
    if bound != length - 1 {
        return Err(format!(
            "line {lineno}: case {case} claims length {length} but exhausted only to {bound}"
        ));
    }
    Ok(())
}

/// Check case certificates for ONE kind against the local move-set hash and a stated expectation.
///
/// `expect` is what a log cannot establish about itself: which cases must appear, and which goal
/// set the bounds are about. A set that is internally consistent but covers 41 of the F2L table's
/// 42 rows is not a table, and neither is one whose 42nd row is a case id nobody enumerates — "the
/// checker did not notice" is precisely the operational mistake this exists for.
///
/// The counts, since they are easy to state a rung out: OLL is 57 cases and the skip, PLL is 21
/// perms and the skip, F2L is 41 cases and the one where the pair is already placed. `Expect`
/// derives all three from the case machinery rather than repeating them.
pub fn check_case_certificates(
    lines: &[&str],
    local_hash_hex: &str,
    expect: &Expect,
) -> Result<CaseProof, String> {
    let kind = expect.kind.as_str();
    if !is_goal_set_kind(kind) && kind != "f2l" {
        return Err(format!("unknown case kind {kind}"));
    }
    if expect.cases.is_empty() {
        return Err(format!("{kind}: an expectation of no cases is not one"));
    }
    let state = read_records(lines, local_hash_hex, kind)?;
    let Read {
        goalset,
        claims,
        foreign_kinds,
    } = state;

    if claims.is_empty() {
        return Err(if foreign_kinds.is_empty() {
            format!("no {kind} case certificates found")
        } else {
            format!(
                "no {kind} case certificates found — the log holds {} records instead",
                foreign_kinds.into_iter().collect::<Vec<_>>().join(", ")
            )
        });
    }

    let (goalset_id, goals) = match (&goalset, &expect.goal_set) {
        (Some((id, size, lineno)), Some((want_id, want_size))) => {
            // THE DECLARED SET IS COMPARED, not merely used. A log is free to say `size=1` and
            // carry one goal's evidence for every case: internally consistent, and a claim about
            // a sixteenth of what the length obliges.
            if id != want_id || size != want_size {
                return Err(format!(
                    "line {lineno}: the log declares goal set {id}/{size}, and a {kind} claim is about {want_id}/{want_size}"
                ));
            }
            (id.clone(), *size)
        }
        (None, Some(_)) => {
            return Err(format!(
                "no case-goals line: a {kind} lower bound is a claim ABOUT a goal set, and a set nobody declared is not one"
            ))
        }
        // F2L's obligation is not over a goal set. A log that declares one is claiming the wrong
        // shape of evidence and is refused rather than read charitably.
        (Some((_, _, lineno)), None) => {
            return Err(format!(
                "line {lineno}: f2l carries no goal set — its projection has exactly one goal, and a set of one is not a set"
            ))
        }
        (None, None) => (String::from("none"), 0),
    };

    for (case, claim) in &claims {
        let Some(length) = claim.length else {
            return Err(format!(
                "case {case} has lower bounds but no algorithm — evidence for a claim nobody made"
            ));
        };
        // Length 0 is the SKIP: nothing to do, so there is nothing shorter to rule out. Carrying
        // lower bounds for it would be evidence about an algorithm that does not exist.
        if length == 0 {
            if !claim.lower.is_empty() || claim.exhausted.is_some() {
                return Err(format!(
                    "case {case} is the skip (length 0) and cannot carry a lower bound"
                ));
            }
            continue;
        }
        if is_goal_set_kind(kind) {
            check_goal_coverage(case, claim, length, goals)?;
        } else {
            check_exhaustion(case, claim, length)?;
        }
    }

    // COVERAGE AS A SET, not as a count. Replacing one case id with `pll:deadbeef` throughout its
    // records leaves the count right and the real case unclaimed, and a table missing a case is a
    // lookup that misses.
    let claimed: BTreeSet<&str> = claims.keys().map(String::as_str).collect();
    let expected: BTreeSet<&str> = expect.cases.iter().map(String::as_str).collect();
    let missing: Vec<&&str> = expected.difference(&claimed).collect();
    let extra: Vec<&&str> = claimed.difference(&expected).collect();
    if !missing.is_empty() || !extra.is_empty() {
        let mut e = format!(
            "{} of {} {kind} cases are claimed",
            claims.len(),
            expect.cases.len()
        );
        if !missing.is_empty() {
            e.push_str(&format!(
                " — {} missing: {:?}",
                missing.len(),
                &missing[..missing.len().min(8)]
            ));
        }
        if !extra.is_empty() {
            e.push_str(&format!(
                " — {} that are not cases: {:?}",
                extra.len(),
                &extra[..extra.len().min(8)]
            ));
        }
        return Err(e);
    }

    // BTreeMap, so the table comes out in case-id order on every machine. A HashMap here would
    // make the accepted table a different string each run, which is exactly the property this
    // whole mechanism exists to give the artifact.
    let table = claims
        .iter()
        .map(|(case, c)| {
            (
                case.clone(),
                c.length.expect("a claim with no length was refused above"),
                c.alg.clone().unwrap_or_default(),
            )
        })
        .collect();

    Ok(CaseProof {
        kind: kind.to_string(),
        cases: claims.len(),
        goalset: goalset_id,
        goals,
        table,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
    const GOALS: u32 = 4; // a small stand-in for OLL's 288, so a complete set fits in a test

    fn goals_line() -> String {
        format!("case-goals moveset={HASH} kind=oll goalset=deadbeef size={GOALS}")
    }
    fn alg_line(case: &str, length: u8) -> String {
        let alg = vec!["R"; length as usize].join(".");
        format!("case-alg moveset={HASH} kind=oll case=oll:{case} length={length} alg={alg}")
    }
    fn lower_line(case: &str, goal: u32, bound: u8) -> String {
        format!("case-lower moveset={HASH} kind=oll case=oll:{case} goal={goal} bound={bound} result=NO-SOLUTION")
    }
    /// One complete OLL case: an algorithm and a lower bound for every goal.
    fn complete_case(case: &str, length: u8) -> Vec<String> {
        let mut out = vec![alg_line(case, length)];
        for g in 0..GOALS {
            out.push(lower_line(case, g, length - 1));
        }
        out
    }
    /// The expectation a test supplies: which case KEYS must appear, and the stand-in goal set.
    ///
    /// Explicit rather than derived from the lines, because the whole point of the expectation is
    /// that the log cannot supply it. A helper that read the ids out of the log would make the
    /// coverage check assert nothing.
    fn expect_oll(cases: &[&str]) -> Expect {
        Expect {
            kind: "oll".into(),
            cases: cases.iter().map(|c| format!("oll:{c}")).collect(),
            goal_set: Some(("deadbeef".into(), GOALS)),
        }
    }
    fn check(lines: &[String], cases: &[&str]) -> Result<CaseProof, String> {
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        check_case_certificates(&refs, HASH, &expect_oll(cases))
    }

    #[test]
    fn a_complete_set_is_a_proof_and_chatter_is_ignored() {
        let mut lines = vec![goals_line(), "  contour 9 exhausted, 12345 nodes".into()];
        lines.extend(complete_case("00", 7));
        lines.push(String::new());
        lines.extend(complete_case("11", 9));
        let proof = check(&lines, &["00", "11"]).expect("a complete set");
        assert_eq!(proof.kind, "oll");
        assert_eq!(proof.cases, 2);
        assert_eq!(proof.goalset, "deadbeef");
        assert_eq!(proof.goals, GOALS);
        // The accepted TABLE, not merely a count — and in case-id order whatever order the log
        // was in, which is what makes a regeneration diff readable.
        assert_eq!(
            proof.table,
            vec![
                ("oll:00".to_string(), 7u8, "R.R.R.R.R.R.R".to_string()),
                ("oll:11".to_string(), 9u8, "R.R.R.R.R.R.R.R.R".to_string()),
            ]
        );
    }

    /// **B2's verification, in the words the plan uses: delete one goal's evidence, and the
    /// checker must reject what remains.**
    ///
    /// This is F3 made mechanical. Without it a certificate that exhausted the winning goal's
    /// contour and stopped would read as a minimality proof over the whole goal set.
    #[test]
    fn deleting_one_goals_evidence_is_refused() {
        let mut lines = vec![goals_line()];
        lines.extend(complete_case("00", 7));
        assert!(
            check(&lines, &["00"]).is_ok(),
            "the complete set must pass first"
        );
        for drop in 0..GOALS {
            let mut short = vec![goals_line()];
            short.extend(
                complete_case("00", 7)
                    .into_iter()
                    .filter(|l| !l.contains(&format!("goal={drop} "))),
            );
            let e = check(&short, &["00"]).expect_err("a missing goal is not a proof");
            assert!(
                e.contains("have no evidence") && e.contains(&format!("{drop}")),
                "dropping goal {drop}: {e}"
            );
        }
    }

    #[test]
    fn every_other_defect_is_a_named_refusal() {
        let base = || {
            let mut l = vec![goals_line()];
            l.extend(complete_case("00", 7));
            l
        };
        // A bound one short of L-1 rules out less than the claim needs.
        let mut weak = base();
        weak[2] = lower_line("00", 0, 5);
        assert!(check(&weak, &["00"])
            .unwrap_err()
            .contains("only exhausted to 5"));
        // A goal outside the declared set is evidence about something else.
        let mut stray = base();
        stray.push(lower_line("00", GOALS + 3, 6));
        assert!(check(&stray, &["00"])
            .unwrap_err()
            .contains("outside the declared set"));
        // The same goal twice is not two goals.
        let mut twice = base();
        twice.push(lower_line("00", 0, 6));
        assert!(check(&twice, &["00"])
            .unwrap_err()
            .contains("already certified"));
        // No goal set declared at all: a lower bound is a claim ABOUT one.
        let undeclared: Vec<String> = base().into_iter().skip(1).collect();
        assert!(check(&undeclared, &["00"])
            .unwrap_err()
            .contains("no case-goals line"));
        // Two different goal sets cannot be one claim.
        let mut two_sets = base();
        two_sets.push(goals_line().replace("deadbeef", "cafebabe"));
        assert!(check(&two_sets, &["00"])
            .unwrap_err()
            .contains("disagrees with line"));
        // A foreign move set — the stale-binary mistake.
        let mut foreign = base();
        foreign[1] = foreign[1].replace(HASH, &HASH.replace('a', "b"));
        assert!(check(&foreign, &["00"])
            .unwrap_err()
            .contains("does not match"));
        // Lower bounds with no algorithm: evidence for a claim nobody made.
        let orphan = vec![goals_line(), lower_line("22", 0, 6)];
        assert!(check(&orphan, &["22"])
            .unwrap_err()
            .contains("no algorithm"));
        // An algorithm whose move count and stated length disagree.
        let mut miscounted = base();
        miscounted[1] = miscounted[1].replace("length=7", "length=6");
        assert!(check(&miscounted, &["00"])
            .unwrap_err()
            .contains("but length says 6"));
        // Two algorithms for one case is exactly the ambiguity the tie-break exists to remove.
        let mut doubled = base();
        doubled.push(alg_line("00", 7));
        assert!(check(&doubled, &["00"])
            .unwrap_err()
            .contains("two algorithms"));
        // A duplicated proof-critical field is ambiguity, and ambiguity is refusal.
        let mut smuggled = base();
        smuggled[2] = format!("{} result=FOUND", smuggled[2]);
        assert!(check(&smuggled, &["00"])
            .unwrap_err()
            .contains("more than once"));
        // A key of the wrong kind on this record.
        let mut wrong_kind = base();
        wrong_kind[1] = wrong_kind[1].replace("case=oll:00", "case=pll:00");
        assert!(check(&wrong_kind, &["00"])
            .unwrap_err()
            .contains("is a pll key"));
        // An incomplete TABLE, not merely an incomplete case.
        let e = check(&base(), &["00", "11", "22"]).unwrap_err();
        assert!(e.contains("1 of 3") && e.contains("2 missing"), "{e}");
        // AND A CASE THAT IS NOT ONE. The count is right and the table is wrong: this is what
        // renaming a case id throughout its records looks like, and a coverage check that counted
        // rather than compared could not see it.
        let mut renamed = vec![goals_line()];
        renamed.extend(complete_case("de", 7));
        let e = check(&renamed, &["00"]).unwrap_err();
        assert!(e.contains("not cases") && e.contains("oll:de"), "{e}");
        // Nothing at all is never an empty proof.
        assert!(check(&[String::from("chatter")], &["00"])
            .unwrap_err()
            .contains("no oll case certificates"));
    }

    #[test]
    fn a_log_of_the_wrong_kind_says_so_rather_than_reporting_nothing() {
        // The failure certificate.rs has by construction: records it does not recognise are
        // skipped, and an empty read is not a refusal there. Here it names what it found.
        let lines = vec![
            format!("case-goals moveset={HASH} kind=pll goalset=deadbeef size=1"),
            format!("case-alg moveset={HASH} kind=pll case=pll:01 length=11 alg=R"),
        ];
        let e = check(&lines, &["00"]).expect_err("a pll log is not an oll proof");
        assert!(e.contains("holds pll records instead"), "{e}");
    }

    /// The goal set is COMPARED with what the caller says the claim is about, not merely used.
    ///
    /// A log is free to declare `size=1` and carry one goal's evidence for every case: internally
    /// consistent, and a claim about a sixteenth of what a PLL length obliges. The declared
    /// identity matters for the same reason — `auf4` and `auf4xauf4` are different obligations.
    #[test]
    fn a_log_that_declares_a_smaller_goal_set_is_refused_however_consistent_it_is() {
        let shrink = |lines: Vec<String>, size: u32| -> Vec<String> {
            lines
                .into_iter()
                .filter(|l| !l.contains("goal=") || l.contains("goal=0 "))
                .map(|l| l.replace(&format!("size={GOALS}"), &format!("size={size}")))
                .collect()
        };
        let mut full = vec![goals_line()];
        full.extend(complete_case("00", 7));
        assert!(
            check(&full, &["00"]).is_ok(),
            "the complete set must pass first"
        );

        let e = check(&shrink(full.clone(), 1), &["00"]).expect_err("size=1 is not the claim");
        assert!(e.contains("declares goal set deadbeef/1"), "{e}");

        let renamed: Vec<String> = full
            .iter()
            .map(|l| l.replace("goalset=deadbeef", "goalset=cafebabe"))
            .collect();
        let e = check(&renamed, &["00"]).expect_err("a different goal set is a different claim");
        assert!(e.contains("declares goal set cafebabe"), "{e}");
    }

    /// The real goal sets, so the checker and the generator cannot drift apart quietly.
    #[test]
    fn the_standard_expectations_are_the_ones_the_generators_produce() {
        let oll = Expect::standard("oll").expect("oll is a kind");
        assert_eq!(oll.cases.len(), 58, "57 OLL cases and the skip");
        assert_eq!(oll.goal_set, Some((OLL_GOAL_SET.0.to_string(), 1152)));
        assert!(oll.cases.contains("oll:00000000"), "the skip is a case");
        let pll = Expect::standard("pll").expect("pll is a kind");
        assert_eq!(pll.cases.len(), 22, "21 named perms and the skip");
        assert_eq!(pll.goal_set, Some((PLL_GOAL_SET.0.to_string(), 16)));
        let f2l = Expect::standard("f2l").expect("f2l is a kind");
        assert_eq!(f2l.cases.len(), 42, "41 cases and the one already placed");
        assert_eq!(
            f2l.goal_set, None,
            "f2l's obligation is not over a goal set"
        );
        assert!(Expect::standard("typo").is_err());
    }

    /// Fields are parsed and range-checked, never cast.
    #[test]
    fn a_numeric_field_that_does_not_fit_is_refused_rather_than_narrowed() {
        let mut over = vec![goals_line()];
        over.extend(complete_case("00", 7));
        // `bound=264 as u8` used to be 8, which happens to be a plausible bound for a length-7
        // claim — a corrupt field reading as a valid one.
        let wrapped = check(
            &over
                .iter()
                .map(|l| l.replace("bound=6", "bound=264"))
                .collect::<Vec<_>>(),
            &["00"],
        )
        .expect_err("264 is not a bound");
        assert!(wrapped.contains("above 20"), "{wrapped}");
        // And a length above God's number is a corrupt field, not a long algorithm.
        let long = check(
            &over
                .iter()
                .map(|l| l.replace("length=7", "length=21"))
                .collect::<Vec<_>>(),
            &["00"],
        )
        .expect_err("21 moves is not a case algorithm");
        assert!(long.contains("above 20"), "{long}");
    }

    /// An algorithm is MOVES, not a count of separators.
    #[test]
    fn an_algorithm_is_checked_move_by_move() {
        let bad = |alg: &str| {
            let mut l = vec![goals_line()];
            l.extend(complete_case("00", 7));
            l[1] = format!("case-alg moveset={HASH} kind=oll case=oll:00 length=7 alg={alg}");
            check(&l, &["00"]).expect_err(alg)
        };
        // Three tokens that are not moves used to pass as a three-move algorithm.
        assert!(bad("X.Y.Z.R.R.R.R").contains("not a face turn"));
        // An empty segment counted as a move.
        assert!(bad("R..R.R.R.R.R").contains("not a face turn"));
        // Lowercase and wide turns are not HTM face turns.
        assert!(bad("r.U.R.U.R.U.R").contains("not a face turn"));
        // And the skip: length 0 used to accept any algorithm at all, because the count was
        // skipped rather than checked against zero.
        let mut skip = vec![goals_line(), alg_line("ff", 0)];
        skip[1] = skip[1].replace("alg=", "alg=R.U.R");
        assert!(check(&skip, &["ff"])
            .unwrap_err()
            .contains("carries no algorithm"));
    }

    #[test]
    fn the_skip_carries_no_lower_bound_because_there_is_no_algorithm_to_bound() {
        // `ff` stands for the skip's key here; what matters is that its length is 0.
        let mut lines = vec![goals_line(), alg_line("ff", 0)];
        assert_eq!(check(&lines, &["ff"]).unwrap().cases, 1);
        lines.push(lower_line("ff", 0, 0));
        assert!(check(&lines, &["ff"])
            .unwrap_err()
            .contains("cannot carry a lower bound"));
    }

    // ---- the F2L shape, which is a different claim -----------------------------------------

    fn f2l(lines: &[String], cases: &[&str]) -> Result<CaseProof, String> {
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        check_case_certificates(
            &refs,
            HASH,
            &Expect {
                kind: "f2l".into(),
                cases: cases.iter().map(|c| format!("f2l:{c}")).collect(),
                goal_set: None,
            },
        )
    }

    #[test]
    fn f2l_carries_an_exhausted_contour_and_never_a_goal_set() {
        let alg =
            format!("case-alg moveset={HASH} kind=f2l case=f2l:0a length=7 alg=R.U.R.U.R.U.R");
        let ex = format!("case-lower moveset={HASH} kind=f2l case=f2l:0a scope=f2l-projection floor=4 bound=6 nodes=41310 result=NO-SOLUTION");
        let proof = f2l(&[alg.clone(), ex.clone()], &["0a"]).expect("a complete f2l claim");
        assert_eq!(proof.goals, 0, "f2l's obligation is not over a goal set");
        assert_eq!(proof.goalset, "none");

        // A goal set declared for f2l is the wrong shape of evidence, not a harmless extra.
        let with_goals = vec![
            format!("case-goals moveset={HASH} kind=f2l goalset=deadbeef size=4"),
            alg.clone(),
            ex.clone(),
        ];
        assert!(f2l(&with_goals, &["0a"])
            .unwrap_err()
            .contains("carries no goal set"));

        // A per-goal bound is likewise the wrong shape.
        let per_goal = vec![
            alg.clone(),
            format!(
                "case-lower moveset={HASH} kind=f2l case=f2l:0a goal=0 bound=6 result=NO-SOLUTION"
            ),
        ];
        assert!(f2l(&per_goal, &["0a"])
            .unwrap_err()
            .contains("must state scope=f2l-projection"));

        // An algorithm with no exhausted contour: a length nobody ruled anything out for.
        assert!(f2l(std::slice::from_ref(&alg), &["0a"])
            .unwrap_err()
            .contains("no exhausted contour"));

        // Enumerating nothing rules out nothing.
        // A search that visited nothing, from a floor that does not reach the bound: the contours
        // between are simply unaccounted for. The SAME zero with `floor=8` is accepted below,
        // because then there was nothing between to account for.
        let empty = ex.replace("nodes=41310", "nodes=0");
        assert!(f2l(&[alg.clone(), empty], &["0a"])
            .unwrap_err()
            .contains("searched nothing"));
        // The heuristic reaching the answer on its own IS the lower bound, and costs no contour.
        let by_floor = ex
            .replace("nodes=41310", "nodes=0")
            .replace("floor=4", "floor=7");
        assert!(
            f2l(&[alg.clone(), by_floor], &["0a"]).is_ok(),
            "a bound established entirely by an admissible heuristic must be accepted"
        );
        // But a floor cannot be higher than the bound it is meant to help establish.
        let overshoot = ex.replace("floor=4", "floor=9");
        assert!(f2l(&[alg.clone(), overshoot], &["0a"])
            .unwrap_err()
            .contains("above its own bound"));

        // And an enumeration that stopped short of L-1.
        let short = ex.replace("bound=6", "bound=4");
        assert!(f2l(&[alg, short], &["0a"])
            .unwrap_err()
            .contains("exhausted only to 4"));
    }
}
