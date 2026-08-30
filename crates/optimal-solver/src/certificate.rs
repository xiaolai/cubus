//! Turn a pile of shard certificate lines into a yes/no: do these constitute a complete
//! distributed proof that the superflip has no solution within the stated bound?
//!
//! The shards run on machines that trust each other only through these lines, so the checker
//! is strict: every superflip shard line must parse, share ONE move-set hash that matches the
//! local move set, share one bound and one shard count, cover every index exactly once, and
//! say NO-SOLUTION. Anything else is a named refusal, never a shrug.
//!
//! The trust model is stated, not implied: the workers are OUR machines, their binaries one
//! deployed git revision, and their output collected over authenticated channels. This checker
//! defends against operational mistakes — a lost shard, a mixed-up log, a stale binary's move
//! set, a partial run pasted as complete — not against an adversary forging lines, which
//! authentication upstream already excludes. Byzantine workers would need signed proofs of
//! work, a different artifact entirely, and no line here claims to be one.

/// What a complete, mutually consistent shard set proves.
#[derive(Debug, PartialEq, Eq)]
pub struct ShardProof {
    pub bound: u8,
    pub shard_count: u32,
}

/// Check superflip shard certificates against the local move-set hash (full lowercase hex).
///
/// `lines` is raw text — non-certificate lines (progress chatter, blanks) are ignored, but a
/// line that BEGINS like a superflip shard certificate and does not parse is an error, because
/// a mangled certificate must never pass as chatter. Hash prefixes of at least 12 hex
/// characters are accepted (shards started before 2026-08-29T19:00 printed a short prefix);
/// the returned warning names each such line so the caller can say it out loud.
pub fn check_superflip_shards(
    lines: &[&str],
    local_hash_hex: &str,
) -> Result<(ShardProof, Vec<String>), String> {
    let mut warnings = Vec::new();
    let mut bound: Option<u8> = None;
    let mut count: Option<u32> = None;
    let mut seen: Vec<u32> = Vec::new();
    for (n, raw) in lines.iter().enumerate() {
        let line = raw.trim();
        if !line.starts_with("certificate ") {
            continue; // progress chatter, blanks — not claims
        }
        let lineno = n + 1;
        // A field is a whole whitespace token `key=value`, present EXACTLY once: substring
        // matching would accept `note=state=superflip`, and first-match extraction would let
        // `result=NO-SOLUTION result=FOUND-AT-19` pass on its friendlier half.
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
            field(key)?.ok_or(format!("line {lineno}: certificate is missing {key}"))
        };
        if field("state=")?.as_deref() != Some("superflip") {
            continue; // some other certificate (a segment line, another state) — not our claim
        }
        let Some(shard) = field("shard=")? else {
            // The whole-superflip form is a different, legitimate claim — and it never
            // carries a bound. Anything else wearing state=superflip without a shard is a
            // mangled certificate, and a mangled certificate must never pass as chatter.
            if field("bound=")?.is_none() && required("result=")? == "PROVED-20" {
                continue;
            }
            return Err(format!(
                "line {lineno}: state=superflip but neither a shard certificate nor PROVED-20"
            ));
        };
        let hash = required("moveset=")?;
        if hash != local_hash_hex {
            if hash.len() >= 12 && local_hash_hex.starts_with(&hash) {
                warnings.push(format!(
                    "line {lineno}: short hash prefix {hash} (pre-2026-08-29T19:00 shard)"
                ));
            } else {
                return Err(format!(
                    "line {lineno}: move-set hash {hash} does not match the local move set"
                ));
            }
        }
        let b: u8 = required("bound=")?
            .parse()
            .map_err(|_| format!("line {lineno}: bound is not a number"))?;
        if *bound.get_or_insert(b) != b {
            return Err(format!(
                "line {lineno}: bound {b} disagrees with earlier lines"
            ));
        }
        let (i, c) = shard
            .split_once('/')
            .ok_or(format!("line {lineno}: shard is not i/n"))?;
        let (i, c): (u32, u32) = match (i.parse(), c.parse()) {
            (Ok(i), Ok(c)) if c > 0 && i < c => (i, c),
            _ => return Err(format!("line {lineno}: shard {shard} is not a shard")),
        };
        // 243 canonical two-move openings is the partition's whole universe — more shards
        // than openings is meaningless, and an unbounded count is an allocation lever.
        if c > 243 {
            return Err(format!(
                "line {lineno}: shard count {c} exceeds the 243 canonical openings"
            ));
        }
        if *count.get_or_insert(c) != c {
            return Err(format!(
                "line {lineno}: shard count {c} disagrees with earlier lines"
            ));
        }
        if seen.contains(&i) {
            return Err(format!("line {lineno}: shard {i}/{c} appears twice"));
        }
        seen.push(i);
        let result = required("result=")?;
        if result != "NO-SOLUTION" {
            return Err(format!(
                "line {lineno}: shard {i}/{c} says {result}, not NO-SOLUTION"
            ));
        }
    }
    let (Some(bound), Some(count)) = (bound, count) else {
        return Err("no superflip shard certificates found".into());
    };
    let missing: Vec<u32> = (0..count).filter(|i| !seen.contains(i)).collect();
    if !missing.is_empty() {
        return Err(format!(
            "incomplete: {} of {count} shards missing: {missing:?}",
            missing.len()
        ));
    }
    Ok((
        ShardProof {
            bound,
            shard_count: count,
        },
        warnings,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
    fn line(i: u32, n: u32) -> String {
        format!("certificate moveset={HASH} state=superflip bound=19 shard={i}/{n} result=NO-SOLUTION secs=1")
    }

    #[test]
    fn a_complete_shard_set_is_a_proof_and_chatter_is_ignored() {
        let lines = [
            line(0, 3),
            "  contour 17 exhausted, 12345 nodes".into(),
            line(2, 3),
            String::new(),
            line(1, 3),
        ];
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        let (proof, warnings) = check_superflip_shards(&refs, HASH).expect("complete set");
        assert_eq!(
            proof,
            ShardProof {
                bound: 19,
                shard_count: 3
            }
        );
        assert!(warnings.is_empty());
    }

    #[test]
    fn every_defect_is_a_named_refusal() {
        let check = |lines: Vec<String>| -> String {
            let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
            check_superflip_shards(&refs, HASH).expect_err("must refuse")
        };
        // A missing shard, by index.
        assert!(check(vec![line(0, 3), line(2, 3)]).contains("shards missing: [1]"));
        // The same shard twice.
        assert!(check(vec![line(0, 2), line(0, 2), line(1, 2)]).contains("appears twice"));
        // A foreign move set.
        let mut foreign = line(1, 2);
        foreign = foreign.replace(HASH, &HASH.replace('a', "b"));
        assert!(check(vec![line(0, 2), foreign]).contains("does not match"));
        // Two different shard counts cannot be one proof.
        assert!(check(vec![line(0, 2), line(1, 3)]).contains("disagrees"));
        // Two different bounds cannot be one proof.
        let other_bound = line(1, 2).replace("bound=19", "bound=18");
        assert!(check(vec![line(0, 2), other_bound]).contains("disagrees"));
        // A shard that FOUND a solution is a table failure, never part of a NO-SOLUTION proof.
        let found = line(1, 2).replace("result=NO-SOLUTION", "result=FOUND-AT-19");
        assert!(check(vec![line(0, 2), found]).contains("not NO-SOLUTION"));
        // A mangled certificate line must not pass as chatter.
        let mangled = line(1, 2).replace(" bound=19", "");
        assert!(check(vec![line(0, 2), mangled]).contains("missing bound="));
        // Nor may one that lost its shard tuple but kept everything else.
        let shardless = line(1, 2).replace(" shard=1/2", "");
        assert!(check(vec![line(0, 2), shardless]).contains("neither a shard certificate"));
        // A bound-bearing line is a shard claim even if it says PROVED-20 — whole-proof
        // lines never carry a bound, so this is mangled, not legitimate.
        let bound_proved = line(1, 2)
            .replace(" shard=1/2", "")
            .replace("result=NO-SOLUTION", "result=PROVED-20");
        assert!(check(vec![line(0, 2), bound_proved]).contains("neither a shard certificate"));
        // A duplicated proof-critical field is ambiguity, and ambiguity is refusal.
        let doubled = format!("{} result=FOUND-AT-19", line(1, 2));
        assert!(check(vec![line(0, 2), doubled]).contains("more than once"));
        // More shards than canonical openings is an allocation lever, not a partition.
        let huge = line(0, 2).replace("shard=0/2", "shard=0/100000000");
        assert!(check(vec![huge]).contains("exceeds the 243"));
        // Nothing at all is not a proof of anything.
        assert!(check(vec!["just chatter".into()]).contains("no superflip shard"));

        // And near-misses that must NOT be read as superflip shard claims at all:
        let other_state = line(0, 1).replace("state=superflip", "state=superflip-other");
        assert!(check(vec![other_state]).contains("no superflip shard"));
        let smuggled = line(0, 1).replace("state=superflip", "note=state=superflip");
        assert!(check(vec![smuggled]).contains("no superflip shard"));
        // A whole-superflip PROVED-20 line is a different, legitimate claim — ignored here.
        let whole = format!(
            "certificate moveset={HASH} state=superflip result=PROVED-20 nodes=1 secs=1 solution=U"
        );
        assert!(check(vec![whole]).contains("no superflip shard"));
    }

    #[test]
    fn a_short_hash_prefix_passes_with_a_warning_but_a_wrong_prefix_never() {
        let short = line(0, 1).replace(HASH, &HASH[..12]);
        let (proof, warnings) = check_superflip_shards(&[&short], HASH).expect("prefix accepted");
        assert_eq!(proof.shard_count, 1);
        assert_eq!(warnings.len(), 1, "the acceptance is said out loud");
        // Too short to trust, and a non-prefix — both refused.
        let tiny = line(0, 1).replace(HASH, &HASH[..8]);
        assert!(check_superflip_shards(&[&tiny], HASH).is_err());
        let wrong = line(0, 1).replace(HASH, &format!("ff{}", &HASH[..12]));
        assert!(check_superflip_shards(&[&wrong], HASH).is_err());
    }
}
