//! Command lines for this crate's binaries, parsed strictly and in one place.
//!
//! **The class of defect this exists to remove.** Every binary here had grown its own argv
//! handling, and each one was permissive in a different way. The audit found the same shape six
//! times over, and the shape is always this: an argument the parser does not understand is
//! DROPPED, and the run then proceeds confidently with a default the caller never asked for.
//!
//! | Was accepted | What actually happened |
//! |---|---|
//! | `gen-f2l table.json --cap 8` | `--cap`'s value counted as a positional, so certificates were written to a file called `8` |
//! | `gen-f2l a.json b.txt --cap x` | the unparseable value fell back to the default 14, and the run reported the cap it was not given |
//! | `f2l-cross-check --max-length invalid` | became "no limit", and a six-move case was reported as checked |
//! | `f2l-cross-check --only DOES_NOT_EXIST` | matched nothing, checked nothing, exited 0 |
//! | `oll-routes 0` | generated the tables, then extrapolated a benchmark from zero samples |
//! | `certify … check-cases typo 22 log` | ran forty minutes of generation and search before rejecting the kind |
//!
//! Every one of them is the same mechanism — options and their values parsed separately, and a
//! bad value defaulted rather than refused — so it is fixed once, here.
//!
//! **What a parse guarantees.** Options are consumed with their values; an unknown option, a
//! repeated option, a missing value, a value that begins with `-`, and a positional count outside
//! the declared range are all refusals. A value that is present but unparseable is a refusal too:
//! a default applies only when the option is ABSENT, which is the distinction every one of the
//! rows above collapsed.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Display;
use std::ops::RangeInclusive;
use std::str::FromStr;

/// What one binary's command line is allowed to be.
pub struct Spec {
    /// The usage line, printed on any refusal. One string, so a binary cannot print two
    /// different ones from two error paths.
    pub usage: &'static str,
    /// Options that take a following value: `--cap 8`.
    pub value_options: &'static [&'static str],
    /// Options that stand alone: `--verbose`.
    pub flags: &'static [&'static str],
    /// How many positional arguments are required.
    pub positionals: RangeInclusive<usize>,
}

/// One parsed command line.
#[derive(Debug)]
pub struct Args {
    positional: Vec<String>,
    values: BTreeMap<String, String>,
    flags: BTreeSet<String>,
}

impl Args {
    /// The `i`th positional. The count was checked at parse time, so this cannot be out of range
    /// for an index the spec guarantees.
    pub fn positional(&self, i: usize) -> &str {
        &self.positional[i]
    }

    /// Every positional, for a binary whose spec allows a variable number.
    pub fn positionals(&self) -> &[String] {
        &self.positional
    }

    /// Was this flag given?
    pub fn flag(&self, name: &str) -> bool {
        self.flags.contains(name)
    }

    /// The raw text of an option, or `None` when it was not given.
    pub fn value(&self, name: &str) -> Option<&str> {
        self.values.get(name).map(String::as_str)
    }

    /// An option parsed into `T`, with `default` used ONLY when the option is absent.
    ///
    /// This is the whole point: `--cap x` is an error, not a 14. A caller who asked for a cap and
    /// got the default instead has been told something false about the run.
    pub fn parsed<T>(&self, name: &str, default: T) -> Result<T, String>
    where
        T: FromStr,
        T::Err: Display,
    {
        match self.values.get(name) {
            None => Ok(default),
            Some(text) => text
                .parse()
                .map_err(|e| format!("{name}: `{text}` is not a valid value ({e})")),
        }
    }

    /// An option parsed into `T` and required to lie inside `range`.
    pub fn parsed_in<T>(
        &self,
        name: &str,
        range: RangeInclusive<T>,
        default: T,
    ) -> Result<T, String>
    where
        T: FromStr + PartialOrd + Display + Copy,
        T::Err: Display,
    {
        let value = self.parsed(name, default)?;
        if !range.contains(&value) {
            return Err(format!(
                "{name}: {value} is outside {}..={}",
                range.start(),
                range.end()
            ));
        }
        Ok(value)
    }

    /// A required positional parsed into `T`, named for the error message.
    pub fn positional_parsed<T>(&self, i: usize, name: &str) -> Result<T, String>
    where
        T: FromStr,
        T::Err: Display,
    {
        self.positional[i].parse().map_err(|e: T::Err| {
            format!(
                "{name}: `{}` is not a valid value ({e})",
                self.positional[i]
            )
        })
    }

    /// A required positional restricted to a named set — the `oll|pll|f2l` shape, refused at
    /// PARSE time rather than after the expensive work has already been done.
    pub fn positional_one_of(
        &self,
        i: usize,
        name: &str,
        allowed: &[&str],
    ) -> Result<String, String> {
        let got = &self.positional[i];
        if allowed.contains(&got.as_str()) {
            Ok(got.clone())
        } else {
            Err(format!(
                "{name}: `{got}` is not one of {}",
                allowed.join(", ")
            ))
        }
    }
}

/// Parse `argv` (without the program name) against `spec`.
pub fn parse<I, S>(argv: I, spec: &Spec) -> Result<Args, String>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let argv: Vec<String> = argv.into_iter().map(Into::into).collect();
    let mut positional = Vec::new();
    let mut values: BTreeMap<String, String> = BTreeMap::new();
    let mut flags: BTreeSet<String> = BTreeSet::new();
    let mut i = 0;
    while i < argv.len() {
        let arg = &argv[i];
        if let Some(name) = arg.strip_prefix("--") {
            // `--name=value` and `--name value` are the same thing spelt two ways.
            let (name, inline) = match name.split_once('=') {
                Some((n, v)) => (n.to_string(), Some(v.to_string())),
                None => (name.to_string(), None),
            };
            let full = format!("--{name}");
            if spec.flags.contains(&full.as_str()) {
                if inline.is_some() {
                    return Err(format!("{full} takes no value"));
                }
                if !flags.insert(full.clone()) {
                    return Err(format!("{full} given more than once"));
                }
            } else if spec.value_options.contains(&full.as_str()) {
                let value = match inline {
                    Some(v) => v,
                    None => {
                        let next = argv
                            .get(i + 1)
                            .ok_or_else(|| format!("{full} needs a value"))?;
                        // A value that looks like the next option means the value is missing —
                        // and swallowing the next option is how `--only` followed by a flag
                        // became "check nothing, exit 0".
                        if next.starts_with("--") {
                            return Err(format!("{full} needs a value, and `{next}` is an option"));
                        }
                        i += 1;
                        next.clone()
                    }
                };
                if values.insert(full.clone(), value).is_some() {
                    return Err(format!("{full} given more than once"));
                }
            } else {
                return Err(format!("unknown option {full}"));
            }
        } else if arg.starts_with('-') && arg.len() > 1 {
            return Err(format!("unknown option {arg}"));
        } else {
            positional.push(arg.clone());
        }
        i += 1;
    }
    if !spec.positionals.contains(&positional.len()) {
        let want = if spec.positionals.start() == spec.positionals.end() {
            format!("exactly {}", spec.positionals.start())
        } else {
            format!("{} to {}", spec.positionals.start(), spec.positionals.end())
        };
        return Err(format!(
            "expected {want} arguments, got {}",
            positional.len()
        ));
    }
    Ok(Args {
        positional,
        values,
        flags,
    })
}

/// Parse this process's own arguments, or print the usage line and exit 1.
///
/// ONE exit path, so a binary cannot grow two spellings of the same refusal — which is what
/// `oll-routes` had, with the usage message written out twice and the two copies free to drift.
pub fn parse_or_exit(spec: &Spec) -> Args {
    match parse(std::env::args().skip(1), spec) {
        Ok(args) => args,
        Err(e) => fail(spec, &e),
    }
}

/// Refuse a command line for a reason the parser could not know — a value out of range, a case id
/// that does not exist — through the same path and the same usage line.
pub fn fail(spec: &Spec, message: &str) -> ! {
    eprintln!("{message}\n{}", spec.usage);
    std::process::exit(1)
}

/// `Ok` or the usage path — for the checks a binary makes after parsing.
pub fn or_exit<T>(spec: &Spec, result: Result<T, String>) -> T {
    match result {
        Ok(v) => v,
        Err(e) => fail(spec, &e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPEC: Spec = Spec {
        usage: "usage: t <a> <b> [--cap N] [--only C] [--verbose]",
        value_options: &["--cap", "--only"],
        flags: &["--verbose"],
        positionals: 2..=2,
    };

    fn ok(argv: &[&str]) -> Args {
        parse(argv.iter().map(|s| s.to_string()), &SPEC).expect("a valid command line")
    }

    fn refused(argv: &[&str]) -> String {
        parse(argv.iter().map(|s| s.to_string()), &SPEC).expect_err("should have been refused")
    }

    #[test]
    fn an_option_value_is_not_a_positional() {
        // `gen-f2l table.json --cap 8` wrote certificates to a file called `8`.
        let a = ok(&["table.json", "certs.txt", "--cap", "8"]);
        assert_eq!(a.positional(0), "table.json");
        assert_eq!(a.positional(1), "certs.txt");
        assert_eq!(a.parsed::<u8>("--cap", 14).unwrap(), 8);
        // And with the option first, which used to shift the destinations.
        let b = ok(&["--cap", "8", "table.json", "certs.txt"]);
        assert_eq!(b.positional(0), "table.json");
        assert_eq!(b.positional(1), "certs.txt");
        assert_eq!(b.parsed::<u8>("--cap", 14).unwrap(), 8);
    }

    #[test]
    fn a_default_applies_only_when_the_option_is_absent() {
        assert_eq!(ok(&["a", "b"]).parsed::<u8>("--cap", 14).unwrap(), 14);
        // Present but unparseable is an ERROR, not the default. This is the whole distinction.
        let e = ok(&["a", "b", "--cap", "x"])
            .parsed::<u8>("--cap", 14)
            .unwrap_err();
        assert!(e.contains("--cap"), "{e}");
        // Overflow is unparseable too, rather than wrapping to something plausible.
        assert!(ok(&["a", "b", "--cap", "300"])
            .parsed::<u8>("--cap", 14)
            .is_err());
        assert!(ok(&["a", "b", "--cap", "-1"])
            .parsed::<u8>("--cap", 14)
            .is_err());
    }

    #[test]
    fn a_range_is_checked_and_zero_is_not_quietly_allowed() {
        let a = ok(&["a", "b", "--cap", "0"]);
        assert!(
            a.parsed_in("--cap", 1..=57u8, 6).is_err(),
            "0 samples passed"
        );
        assert_eq!(ok(&["a", "b"]).parsed_in("--cap", 1..=57u8, 6).unwrap(), 6);
        assert!(ok(&["a", "b", "--cap", "58"])
            .parsed_in("--cap", 1..=57u8, 6)
            .is_err());
    }

    #[test]
    fn everything_the_old_parsers_dropped_in_silence_is_refused() {
        for argv in [
            &["a", "b", "--scrtach", "x"][..],
            &["a", "b", "-x"][..],
            &["a", "b", "--cap"][..],
            &["a", "b", "--cap", "--verbose"][..],
            &["a", "b", "--cap", "1", "--cap", "2"][..],
            &["a", "b", "--verbose", "--verbose"][..],
            &["a", "b", "--verbose=1"][..],
            &["a"][..],
            &["a", "b", "c"][..],
        ] {
            let e = refused(argv);
            assert!(!e.is_empty(), "{argv:?}");
        }
    }

    #[test]
    fn inline_and_separated_values_are_the_same_command_line() {
        assert_eq!(
            ok(&["a", "b", "--only=DFR0/FR1"]).value("--only"),
            ok(&["a", "b", "--only", "DFR0/FR1"]).value("--only")
        );
        assert!(ok(&["a", "b", "--verbose"]).flag("--verbose"));
        assert!(!ok(&["a", "b"]).flag("--verbose"));
    }

    #[test]
    fn a_named_set_is_checked_where_it_is_cheap_rather_than_after_the_work() {
        let a = ok(&["typo", "b"]);
        assert!(a
            .positional_one_of(0, "kind", &["oll", "pll", "f2l"])
            .is_err());
        assert_eq!(
            ok(&["oll", "b"])
                .positional_one_of(0, "kind", &["oll", "pll", "f2l"])
                .unwrap(),
            "oll"
        );
    }

    #[test]
    fn a_negative_number_positional_is_still_a_positional() {
        // `-` alone, and a bare `-1`, are values people pass. Only `-x` and `--x` are options.
        const NUMBERS: Spec = Spec {
            usage: "usage: t <n>",
            value_options: &[],
            flags: &[],
            positionals: 1..=1,
        };
        assert_eq!(parse(["-"], &NUMBERS).unwrap().positional(0), "-");
        assert!(
            parse(["-1"], &NUMBERS).is_err(),
            "`-1` reads as an option, and that is stated"
        );
    }
}
