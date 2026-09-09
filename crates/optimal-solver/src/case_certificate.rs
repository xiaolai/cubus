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
//! line whose `state=` is not `superflip` is silently skipped, so case records would pass through
//! it *unread* and an empty read is not a refusal there. An earlier revision of the plan called
//! the retrofit free. It is not, and this module is the cost.
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
//! not a missing one, which is thirteen of the forty-one cases. A checker that refused every zero
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
//! ## The trust model, stated
//!
//! The same one `certificate.rs` states: the workers are our machines, their binaries one deployed
//! revision, their output collected over authenticated channels. This checker defends against
//! operational mistakes — a lost goal, a mixed-up log, a stale binary's move set, a partial run
//! pasted as complete. It is not a defence against forged lines, and no line here claims to be a
//! proof of work.

use std::collections::{BTreeMap, BTreeSet};

/// What a complete, mutually consistent case-certificate set proves.
#[derive(Debug, PartialEq, Eq)]
pub struct CaseProof {
    pub kind: String,
    /// How many cases carry a complete claim.
    pub cases: usize,
    /// The goal set every lower-bound record was taken against.
    pub goalset: String,
    /// How big that goal set is. 1 for PLL (a permutation algorithm must actually solve), 288 for
    /// OLL, and 0 for F2L, whose obligation is not over a goal set at all.
    pub goals: u32,
    /// The table the evidence supports: `(case id, length, dot-separated algorithm)`, in case-id
    /// order. Returned rather than merely counted, because "the certificates check out" and "this
    /// is the table they check out FOR" are different statements — and a regeneration diff is read
    /// against the second. Sorted, so two machines print it identically.
    pub table: Vec<(String, u8, String)>,
}

/// One case's claim, assembled from its lines.
#[derive(Default)]
struct Claim {
    length: Option<u8>,
    /// The algorithm this case's evidence is about, dot-separated. Carried out in `CaseProof`:
    /// a checker that could not quote what it accepted would make a regeneration diff unreadable.
    alg: Option<String>,
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

/// Check case certificates for ONE kind against the local move-set hash.
///
/// `expect_cases` is how many cases the kind has — 58 for OLL, 22 for PLL, 41 for F2L (§2). A set
/// that is internally consistent but covers 40 of 41 cases is not a table, and "the checker did
/// not notice" is precisely the operational mistake this exists for.
///
/// Non-certificate lines (progress chatter, blanks) are ignored. A line that BEGINS like a case
/// certificate and does not parse is an error: a mangled certificate must never pass as chatter.
pub fn check_case_certificates(
    lines: &[&str],
    local_hash_hex: &str,
    kind: &str,
    expect_cases: usize,
) -> Result<CaseProof, String> {
    if !is_goal_set_kind(kind) && kind != "f2l" {
        return Err(format!("unknown case kind {kind}"));
    }
    let mut goalset: Option<(String, u32, usize)> = None;
    let mut claims: BTreeMap<String, Claim> = BTreeMap::new();
    let mut foreign_kinds: BTreeSet<String> = BTreeSet::new();

    for (n, raw) in lines.iter().enumerate() {
        let line = raw.trim();
        let record = match line.split_whitespace().next() {
            Some(w @ ("case-goals" | "case-alg" | "case-lower")) => w,
            _ => continue, // chatter, blanks, and the superflip records certificate.rs owns
        };
        let lineno = n + 1;
        // A field is a whole whitespace token `key=value`, present EXACTLY once. Substring
        // matching would accept `note=kind=oll`; first-match extraction would let
        // `result=NO-SOLUTION result=FOUND` pass on its friendlier half.
        let field = |key: &str| -> Result<Option<String>, String> {
            let mut hits = line
                .split_whitespace()
                .filter_map(|w| w.strip_prefix(key).map(str::to_string));
            let first = hits.next();
            if hits.next().is_some() {
                return Err(format!("line {lineno}: {key} appears more than once"));
            }
            Ok(first)
        };
        let required = |key: &str| -> Result<String, String> {
            field(key)?.ok_or(format!("line {lineno}: {record} is missing {key}"))
        };
        let number = |key: &str| -> Result<u64, String> {
            required(key)?
                .parse()
                .map_err(|_| format!("line {lineno}: {key} is not a number"))
        };

        // Every record carries the move set it was produced against. A stale binary's table is
        // the operational mistake most likely to look like a valid result.
        let hash = required("moveset=")?;
        if hash != local_hash_hex {
            return Err(format!(
                "line {lineno}: move-set hash {hash} does not match the local move set"
            ));
        }
        let line_kind = required("kind=")?;
        if line_kind != kind {
            // Records for another kind in the same log are legitimate — they are simply not this
            // claim. Remembered so the report can say a whole table was checked against the wrong
            // expectation rather than silently reporting zero cases.
            foreign_kinds.insert(line_kind);
            continue;
        }

        match record {
            "case-goals" => {
                let set = required("goalset=")?;
                let size = number("size=")? as u32;
                if is_goal_set_kind(kind) && size == 0 {
                    return Err(format!(
                        "line {lineno}: a goal set of nothing certifies nothing"
                    ));
                }
                if let Some((prev, prev_size, first_line)) = &goalset {
                    if *prev != set || *prev_size != size {
                        return Err(format!(
                            "line {lineno}: goal set {set}/{size} disagrees with line {first_line}"
                        ));
                    }
                } else {
                    goalset = Some((set, size, lineno));
                }
            }
            "case-alg" => {
                let case = required("case=")?;
                check_case_id(&case, kind, lineno)?;
                let length = number("length=")?;
                if length > 32 {
                    return Err(format!(
                        "line {lineno}: length {length} is not a case algorithm"
                    ));
                }
                let alg = required("alg=")?;
                let moves = if length == 0 {
                    0
                } else {
                    alg.split('.').count()
                };
                if moves as u64 != length {
                    return Err(format!(
                        "line {lineno}: alg has {moves} moves but length says {length}"
                    ));
                }
                let claim = claims.entry(case.clone()).or_default();
                if claim.length.is_some() {
                    return Err(format!("line {lineno}: case {case} has two algorithms"));
                }
                claim.length = Some(length as u8);
                claim.alg = Some(alg);
                claim.alg_line = lineno;
            }
            "case-lower" => {
                let case = required("case=")?;
                check_case_id(&case, kind, lineno)?;
                let bound = number("bound=")? as u8;
                let result = required("result=")?;
                let claim = claims.entry(case.clone()).or_default();
                if is_goal_set_kind(kind) {
                    if result != "NO-SOLUTION" {
                        return Err(format!(
                            "line {lineno}: case {case} says {result}, not NO-SOLUTION"
                        ));
                    }
                    if field("scope=")?.is_some() {
                        return Err(format!(
                            "line {lineno}: scope= is the F2L shape; a {kind} bound is per goal"
                        ));
                    }
                    let goal = number("goal=")? as u32;
                    if let Some((_, prev_line)) = claim.lower.get(&goal).map(|(b, l)| (*b, *l)) {
                        return Err(format!(
                            "line {lineno}: case {case} goal {goal} already certified on line {prev_line}"
                        ));
                    }
                    claim.lower.insert(goal, (bound, lineno));
                } else {
                    // F2L: one exhaustion record per case, and it must name the space it is in.
                    // Missing and wrong are ONE refusal here on purpose: both mean the record does
                    // not say which claim it is making, and a bound that could be read as a
                    // distance in the WHOLE cube is a much weaker statement wearing the same
                    // number.
                    if field("scope=")?.as_deref() != Some("f2l-projection") {
                        return Err(format!(
                            "line {lineno}: an f2l bound must state scope=f2l-projection — the space it is a distance in is the claim"
                        ));
                    }
                    if field("goal=")?.is_some() {
                        return Err(format!(
                            "line {lineno}: an f2l bound has no goal index; its projection has exactly one goal"
                        ));
                    }
                    if result != "NO-SOLUTION" {
                        return Err(format!(
                            "line {lineno}: case {case} says {result}, not NO-SOLUTION"
                        ));
                    }
                    let nodes = number("nodes=")?;
                    let floor = number("floor=")? as u8;
                    if floor == 0 {
                        return Err(format!(
                            "line {lineno}: case {case} has floor 0 — a heuristic of zero bounds nothing"
                        ));
                    }
                    if floor > bound + 1 {
                        return Err(format!(
                            "line {lineno}: case {case} claims a floor of {floor} above its own bound of {bound}"
                        ));
                    }
                    // The one place a zero is allowed, and exactly there: contours were skipped
                    // only when the heuristic had already ruled them out. A record that skipped
                    // them AND had no floor to justify it is a bound with nothing behind it.
                    if nodes == 0 && floor != bound + 1 {
                        return Err(format!(
                            "line {lineno}: case {case} searched nothing from a floor of {floor}, so contours {floor}..={bound} are unaccounted for"
                        ));
                    }
                    if let Some((_, _, prev)) = claim.exhausted {
                        return Err(format!(
                            "line {lineno}: case {case} already exhausted on line {prev}"
                        ));
                    }
                    claim.exhausted = Some((bound, nodes, lineno));
                }
            }
            _ => unreachable!("the match above admits exactly these three records"),
        }
    }

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

    let (goalset_id, goals) = match (&goalset, is_goal_set_kind(kind)) {
        (Some((id, size, _)), true) => (id.clone(), *size),
        (None, true) => {
            return Err(format!(
                "no case-goals line: a {kind} lower bound is a claim ABOUT a goal set, and a set nobody declared is not one"
            ))
        }
        // F2L's obligation is not over a goal set. A log that declares one is claiming the wrong
        // shape of evidence and is refused rather than read charitably.
        (Some((_, _, lineno)), false) => {
            return Err(format!(
                "line {lineno}: f2l carries no goal set — its projection has exactly one goal, and a set of one is not a set"
            ))
        }
        (None, false) => (String::from("none"), 0),
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
        let want_bound = length - 1;
        if is_goal_set_kind(kind) {
            // **F3, as the rule it is.** Every goal in the declared set, at exactly `L-1`.
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
            let missing: Vec<u32> = (0..goals)
                .filter(|g| !claim.lower.contains_key(g))
                .collect();
            if !missing.is_empty() {
                return Err(format!(
                    "case {case} claims length {length} but {} of {goals} goals have no evidence: {:?}",
                    missing.len(),
                    &missing[..missing.len().min(8)]
                ));
            }
        } else {
            let Some((bound, _nodes, lineno)) = claim.exhausted else {
                return Err(format!(
                    "case {case} claims length {length} with no exhausted contour — a length nobody ruled anything out for"
                ));
            };
            if bound != want_bound {
                return Err(format!(
                    "line {lineno}: case {case} claims length {length} but exhausted only to {bound}"
                ));
            }
        }
    }

    if claims.len() != expect_cases {
        return Err(format!(
            "{} of {expect_cases} {kind} cases are claimed — a table missing a case is a lookup that misses",
            claims.len()
        ));
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
    fn check(lines: &[String], cases: usize) -> Result<CaseProof, String> {
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        check_case_certificates(&refs, HASH, "oll", cases)
    }

    #[test]
    fn a_complete_set_is_a_proof_and_chatter_is_ignored() {
        let mut lines = vec![goals_line(), "  contour 9 exhausted, 12345 nodes".into()];
        lines.extend(complete_case("00", 7));
        lines.push(String::new());
        lines.extend(complete_case("11", 9));
        let proof = check(&lines, 2).expect("a complete set");
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
        assert!(check(&lines, 1).is_ok(), "the complete set must pass first");
        for drop in 0..GOALS {
            let mut short = vec![goals_line()];
            short.extend(
                complete_case("00", 7)
                    .into_iter()
                    .filter(|l| !l.contains(&format!("goal={drop} "))),
            );
            let e = check(&short, 1).expect_err("a missing goal is not a proof");
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
        assert!(check(&weak, 1).unwrap_err().contains("only exhausted to 5"));
        // A goal outside the declared set is evidence about something else.
        let mut stray = base();
        stray.push(lower_line("00", GOALS + 3, 6));
        assert!(check(&stray, 1)
            .unwrap_err()
            .contains("outside the declared set"));
        // The same goal twice is not two goals.
        let mut twice = base();
        twice.push(lower_line("00", 0, 6));
        assert!(check(&twice, 1).unwrap_err().contains("already certified"));
        // No goal set declared at all: a lower bound is a claim ABOUT one.
        let undeclared: Vec<String> = base().into_iter().skip(1).collect();
        assert!(check(&undeclared, 1)
            .unwrap_err()
            .contains("no case-goals line"));
        // Two different goal sets cannot be one claim.
        let mut two_sets = base();
        two_sets.push(goals_line().replace("deadbeef", "cafebabe"));
        assert!(check(&two_sets, 1)
            .unwrap_err()
            .contains("disagrees with line"));
        // A foreign move set — the stale-binary mistake.
        let mut foreign = base();
        foreign[1] = foreign[1].replace(HASH, &HASH.replace('a', "b"));
        assert!(check(&foreign, 1).unwrap_err().contains("does not match"));
        // Lower bounds with no algorithm: evidence for a claim nobody made.
        let orphan = vec![goals_line(), lower_line("22", 0, 6)];
        assert!(check(&orphan, 1).unwrap_err().contains("no algorithm"));
        // An algorithm whose move count and stated length disagree.
        let mut miscounted = base();
        miscounted[1] = miscounted[1].replace("length=7", "length=6");
        assert!(check(&miscounted, 1)
            .unwrap_err()
            .contains("but length says 6"));
        // Two algorithms for one case is exactly the ambiguity the tie-break exists to remove.
        let mut doubled = base();
        doubled.push(alg_line("00", 7));
        assert!(check(&doubled, 1).unwrap_err().contains("two algorithms"));
        // A duplicated proof-critical field is ambiguity, and ambiguity is refusal.
        let mut smuggled = base();
        smuggled[2] = format!("{} result=FOUND", smuggled[2]);
        assert!(check(&smuggled, 1).unwrap_err().contains("more than once"));
        // A key of the wrong kind on this record.
        let mut wrong_kind = base();
        wrong_kind[1] = wrong_kind[1].replace("case=oll:00", "case=pll:00");
        assert!(check(&wrong_kind, 1).unwrap_err().contains("is a pll key"));
        // An incomplete TABLE, not merely an incomplete case.
        assert!(check(&base(), 58).unwrap_err().contains("1 of 58"));
        // Nothing at all is never an empty proof.
        assert!(check(&[String::from("chatter")], 1)
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
        let e = check(&lines, 22).expect_err("a pll log is not an oll proof");
        assert!(e.contains("holds pll records instead"), "{e}");
    }

    #[test]
    fn the_skip_carries_no_lower_bound_because_there_is_no_algorithm_to_bound() {
        // `ff` stands for the skip's key here; what matters is that its length is 0.
        let mut lines = vec![goals_line(), alg_line("ff", 0)];
        assert_eq!(check(&lines, 1).unwrap().cases, 1);
        lines.push(lower_line("ff", 0, 0));
        assert!(check(&lines, 1)
            .unwrap_err()
            .contains("cannot carry a lower bound"));
    }

    // ---- the F2L shape, which is a different claim -----------------------------------------

    fn f2l(lines: &[String], cases: usize) -> Result<CaseProof, String> {
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        check_case_certificates(&refs, HASH, "f2l", cases)
    }

    #[test]
    fn f2l_carries_an_exhausted_contour_and_never_a_goal_set() {
        let alg =
            format!("case-alg moveset={HASH} kind=f2l case=f2l:0a length=7 alg=R.U.R.U.R.U.R");
        let ex = format!("case-lower moveset={HASH} kind=f2l case=f2l:0a scope=f2l-projection floor=4 bound=6 nodes=41310 result=NO-SOLUTION");
        let proof = f2l(&[alg.clone(), ex.clone()], 1).expect("a complete f2l claim");
        assert_eq!(proof.goals, 0, "f2l's obligation is not over a goal set");
        assert_eq!(proof.goalset, "none");

        // A goal set declared for f2l is the wrong shape of evidence, not a harmless extra.
        let with_goals = vec![
            format!("case-goals moveset={HASH} kind=f2l goalset=deadbeef size=4"),
            alg.clone(),
            ex.clone(),
        ];
        assert!(f2l(&with_goals, 1)
            .unwrap_err()
            .contains("carries no goal set"));

        // A per-goal bound is likewise the wrong shape.
        let per_goal = vec![
            alg.clone(),
            format!(
                "case-lower moveset={HASH} kind=f2l case=f2l:0a goal=0 bound=6 result=NO-SOLUTION"
            ),
        ];
        assert!(f2l(&per_goal, 1)
            .unwrap_err()
            .contains("must state scope=f2l-projection"));

        // An algorithm with no exhausted contour: a length nobody ruled anything out for.
        assert!(f2l(std::slice::from_ref(&alg), 1)
            .unwrap_err()
            .contains("no exhausted contour"));

        // Enumerating nothing rules out nothing.
        // A search that visited nothing, from a floor that does not reach the bound: the contours
        // between are simply unaccounted for. The SAME zero with `floor=8` is accepted below,
        // because then there was nothing between to account for.
        let empty = ex.replace("nodes=41310", "nodes=0");
        assert!(f2l(&[alg.clone(), empty], 1)
            .unwrap_err()
            .contains("searched nothing"));
        // The heuristic reaching the answer on its own IS the lower bound, and costs no contour.
        let by_floor = ex
            .replace("nodes=41310", "nodes=0")
            .replace("floor=4", "floor=7");
        assert!(
            f2l(&[alg.clone(), by_floor], 1).is_ok(),
            "a bound established entirely by an admissible heuristic must be accepted"
        );
        // But a floor cannot be higher than the bound it is meant to help establish.
        let overshoot = ex.replace("floor=4", "floor=9");
        assert!(f2l(&[alg.clone(), overshoot], 1)
            .unwrap_err()
            .contains("above its own bound"));

        // And an enumeration that stopped short of L-1.
        let short = ex.replace("bound=6", "bound=4");
        assert!(f2l(&[alg, short], 1)
            .unwrap_err()
            .contains("exhausted only to 4"));
    }
}
