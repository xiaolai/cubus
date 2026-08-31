//! The Rust side must not know what a cube brand is.
//!
//! This is Phase 2's acceptance criterion from `dev-docs/universal-cube-driver.md` §8, turned into
//! something that can go red. The predecessor crate hardcoded a "GAN" name prefix, the FFF5/FFF6
//! characteristic UUIDs, and GAN's manufacturer-data layout for MAC recovery — three pieces of
//! per-brand knowledge that the protocol layer already holds for ten protocols. Two places that
//! must agree about a brand is the failure this design exists to prevent, and it does not announce
//! itself: the second copy drifts, one build connects, the other silently does not.
//!
//! Scope is the transport crate AND the Tauri backend, because moving a brand constant from one to
//! the other would satisfy a narrower check while changing nothing.
//!
//! Two things are deliberately allowed. **Comments and doc comments**, because the history is the
//! most useful part of this record and a rule that forbids explaining itself gets deleted. And
//! **`#[cfg(test)]` modules**, because the unit tests exercise a GENERIC matcher with the realistic
//! filters the protocol layer actually sends — `namePrefix: "GAN"` there is a fixture, not a
//! constant the transport acts on, and replacing it with `"Foo"` would make the test prove less.
//! Both carve-outs are themselves asserted below, because a gate whose filter silently eats
//! everything passes everything.

use std::fs;
use std::path::{Path, PathBuf};

/// Brand tokens that must not appear in Rust CODE. Lowercased before comparison.
///
/// The UUIDs are here for the same reason as the names: FFF5/FFF6 are GAN's characteristics, and a
/// literal for one is a statement about which cube this crate is for.
/// Brand NAMES, matched as whole words.
///
/// Bounded because raw substring matching fires on ordinary identifiers — `organize` contains
/// "gan", `dangling` contains "gan" — and a gate that cries wolf gets weakened or deleted, after
/// which it is not there for the real case.
const FORBIDDEN_WORDS: &[&str] = &[
    // Vendor names.
    "gan", "giiker", "gocube", "moyu", "qiyi", "rubiks", "xiaomi", "mi smart", "tornado",
    // Advertised-name prefixes the protocol layer actually filters on. These were missing, which
    // left the most likely way for brand knowledge to creep back — a name prefix — uncovered.
    "aicube", "wcu_", "mhc", "qy-qysc", "hi-",
];

/// Brand UUID fragments, matched as raw substrings.
///
/// Deliberately NOT word-bounded: these appear INSIDE hex literals and identifiers, which is
/// exactly the form the predecessor used — `Uuid::from_u128(0x0000fff6_0000_1000_8000_...)`. A
/// word-boundary rule rejects that, i.e. it misses the precise thing the gate is for. A false
/// alarm from an unrelated hex literal is possible and cheap; a miss here is not.
const FORBIDDEN_SUBSTRINGS: &[&str] = &["fff5", "fff6", "aadb", "aadc"];

/// Is this brand token present in `line`, under whichever rule its class requires?
fn brand_hit(line_lower: &str) -> bool {
    FORBIDDEN_WORDS.iter().any(|n| contains_word(line_lower, n))
        || FORBIDDEN_SUBSTRINGS.iter().any(|n| line_lower.contains(n))
}

/// Does `haystack` contain `needle` bounded by non-identifier characters on both sides?
///
/// Identifier characters are `[A-Za-z0-9_]`; a needle containing a space or hyphen (like
/// `mi smart` or `qy-qysc`) is matched with the same rule, which is why the check is on the
/// characters either SIDE of the match rather than on the needle's own shape.
fn contains_word(haystack: &str, needle: &str) -> bool {
    let ident = |c: char| c.is_ascii_alphanumeric() || c == '_';
    let mut from = 0;
    while let Some(rel) = haystack[from..].find(needle) {
        let start = from + rel;
        let end = start + needle.len();
        let before_ok = start == 0 || !haystack[..start].chars().next_back().is_some_and(ident);
        let after_ok = end == haystack.len() || !haystack[end..].chars().next().is_some_and(ident);
        if before_ok && after_ok {
            return true;
        }
        from = start + 1;
    }
    false
}

/// Files whose code is checked. The Swift/JS sides are out of scope by design — the protocol layer
/// is JavaScript and is SUPPOSED to name brands.
fn rust_sources() -> Vec<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("workspace root")
        .to_path_buf();
    let mut out = Vec::new();
    for dir in [
        root.join("crates/cube-ble/src"),
        root.join("apps/desktop/src-tauri/src"),
    ] {
        collect(&dir, &mut out);
    }
    assert!(
        out.len() >= 3,
        "found only {} rust sources — the walk is broken, and a broken walk passes everything",
        out.len()
    );
    out
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect(&p, out);
        } else if p.extension().is_some_and(|x| x == "rs") {
            out.push(p);
        }
    }
}

/// Remove `#[cfg(test)]` modules by brace matching.
///
/// Run AFTER comment stripping, so a brace inside a comment cannot throw off the count.
fn strip_test_modules(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let mut rest = src;
    while let Some(at) = rest.find("#[cfg(test)]") {
        out.push_str(&rest[..at]);
        let after = &rest[at..];
        let Some(open) = after.find('{') else {
            break; // no body to skip; drop the rest rather than pretend it was scanned
        };
        // Braces inside STRING LITERALS do not nest. A test fixture containing `"{"` would
        // otherwise unbalance the count and swallow the rest of the file — which, for a gate whose
        // whole job is to scan that file, means passing everything in silence.
        let mut depth = 0usize;
        let mut end = None;
        let mut in_str = false;
        let mut escaped = false;
        for (i, c) in after[open..].char_indices() {
            if in_str {
                if escaped {
                    escaped = false;
                } else if c == '\\' {
                    escaped = true;
                } else if c == '"' {
                    in_str = false;
                }
                continue;
            }
            match c {
                '"' => in_str = true,
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(open + i + 1);
                        break;
                    }
                }
                _ => {}
            }
        }
        match end {
            Some(e) => rest = &after[e..],
            // Unbalanced braces mean the parse is wrong, and a wrong parse must not be read as a
            // clean file. Keep the remainder so the scan still sees it.
            None => {
                out.push_str(after);
                return out;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Strip comments and doc comments, so the rule applies to code and not to the record of why the
/// rule exists. Block comments are handled too — a `/* ... */` is the obvious way to smuggle one
/// past a line-based filter.
fn strip_comments(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let b: Vec<char> = src.chars().collect();
    let mut i = 0;
    let (mut in_line, mut in_block, mut in_str) = (false, false, false);
    while i < b.len() {
        let c = b[i];
        let next = b.get(i + 1).copied().unwrap_or('\0');
        if in_line {
            if c == '\n' {
                in_line = false;
                out.push(c);
            }
        } else if in_block {
            if c == '*' && next == '/' {
                in_block = false;
                i += 1;
            }
        } else if in_str {
            if c == '\\' {
                i += 1; // skip the escaped character
            } else if c == '"' {
                in_str = false;
            }
            out.push(c);
        } else if c == '/' && next == '/' {
            in_line = true;
            i += 1;
        } else if c == '/' && next == '*' {
            in_block = true;
            i += 1;
        } else {
            if c == '"' {
                in_str = true;
            }
            out.push(c);
        }
        i += 1;
    }
    out
}

#[test]
fn no_cube_brand_appears_in_rust_code() {
    let mut hits = Vec::new();
    for path in rust_sources() {
        let src = fs::read_to_string(&path).expect("read source");
        for (n, line) in strip_test_modules(&strip_comments(&src))
            .lines()
            .enumerate()
        {
            if brand_hit(&line.to_ascii_lowercase()) {
                hits.push(format!("{}:{}: {}", path.display(), n + 1, line.trim()));
            }
        }
    }
    assert!(
        hits.is_empty(),
        "brand knowledge leaked back into the native side:\n  {}\n\nThe protocol layer owns the \
         brand table (nameFilters / matchesDevice / gattAffinity). A second copy here is two \
         places that must agree about a cube, which is what this design exists to prevent.",
        hits.join("\n  ")
    );
}

#[test]
fn the_word_match_ignores_brands_buried_inside_other_words() {
    // The failure this prevents is a FALSE alarm, which is its own kind of damage: a gate that
    // fires on `organize` gets weakened or deleted, and then it is not there for the real case.
    for innocent in [
        "let organized = 1;",
        "std::time::Duration::from_nanos(5)",
        "let dangling = x;",
    ] {
        let lower = innocent.to_ascii_lowercase();
        assert!(!brand_hit(&lower), "false positive on: {innocent}");
    }
    // And it still catches the real thing: hyphenated and spaced needles, AND a uuid buried in a
    // hex literal, which is the form the predecessor actually used.
    for guilty in [
        "name.starts_with(\"GAN\")",
        "let s = \"qy-qysc\";",
        "// mi smart",
        "Uuid::from_u128(0x0000fff6_0000_1000_8000_00805f9b34fb)",
    ] {
        let lower = guilty.to_ascii_lowercase();
        assert!(brand_hit(&lower), "missed: {guilty}");
    }
}

#[test]
fn the_comment_stripper_does_not_hide_real_code() {
    // The stripper is the part of this gate that could quietly make it vacuous, so it is tested
    // rather than trusted: a rule enforced by a broken filter passes everything.
    let src = r#"
// gan in a line comment is fine
/* gan in a block comment is fine */
let uuid = "fff6";
"#;
    let stripped = strip_comments(src);
    assert!(
        !stripped.contains("line comment"),
        "line comments must be stripped"
    );
    assert!(
        !stripped.contains("block comment"),
        "block comments must be stripped"
    );
    assert!(
        stripped.contains("fff6"),
        "a string literal in CODE must survive"
    );
}

#[test]
fn the_test_module_carve_out_removes_a_module_and_nothing_else() {
    // The widest possible failure of this gate: a stripper that eats the whole file. Then every
    // brand constant in production code passes unnoticed, and the gate reads green forever.
    let src = r#"
pub fn production() { let x = 1; }
#[cfg(test)]
mod tests {
    fn helper() { if true { } }
    const NAME: &str = "GAN";
    const BRACE: &str = "{";
}
pub fn after() { let y = 2; }
"#;
    let stripped = strip_test_modules(src);
    assert!(
        stripped.contains("production"),
        "code before the test module must survive"
    );
    assert!(
        stripped.contains("after"),
        "code AFTER the test module must survive — nested braces"
    );
    assert!(
        !stripped.contains("GAN"),
        "the test module's contents must be removed"
    );
}

#[test]
fn the_gate_still_sees_production_code_in_the_real_sources() {
    // Both carve-outs together could hollow the scan out. This asserts the scan still has
    // something to look at: the real files, after stripping, still contain their public API.
    let joined: String = rust_sources()
        .iter()
        .map(|p| strip_test_modules(&strip_comments(&fs::read_to_string(p).unwrap())))
        .collect();
    for marker in ["matches_request", "discover_characteristics", "ble_connect"] {
        assert!(
            joined.contains(marker),
            "{marker} vanished — the scan is looking at nothing"
        );
    }
}

#[test]
fn the_gate_catches_what_it_is_for() {
    // Every construct the predecessor actually used, proving the needle list is not decorative.
    for offender in [
        r#"if name.starts_with("GAN") {"#,
        "pub const FFF6_NOTIFY: Uuid = Uuid::from_u128(0x0000fff6_0000_1000_8000_00805f9b34fb);",
        "let giiker = 1;",
        r#"let s = "QiYi";"#,
    ] {
        let stripped = strip_comments(offender).to_ascii_lowercase();
        assert!(
            brand_hit(&stripped),
            "the gate would not have caught: {offender}"
        );
    }
}
