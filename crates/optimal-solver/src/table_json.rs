//! Read a generated case table back — strictly, and in one place.
//!
//! **Why this module exists.** The generators write hand-rolled JSON, which is fine: every value
//! is a number, a facelet string, or a maneuver over `[URFDLB'2 ]`, so there is no escaping to get
//! wrong on the way out. Reading it back is the other half, and it had grown three separate
//! improvisations — `case-cross-check` split on `{ "case": "`, `oll-compare` split on
//! `"length": `, and `tests/committed_tables.rs` matched a line prefix. Each accepted things that
//! are not the table:
//!
//! - a file missing its closing brace parsed cleanly, because nothing ever looked at the
//!   structure;
//! - `"length": 9.9` read as `9`, because the digits were taken with `take_while(is_ascii_digit)`
//!   and the rest was dropped in silence;
//! - a duplicated case id overwrote the earlier row in a `BTreeMap`, so a corrupt table with two
//!   rows for one case looked like a smaller correct one — and could suppress a refutation;
//! - compact JSON (no space after `:`) matched nothing at all, and `oll-compare` then failed its
//!   count assertion with a message about the wrong thing.
//!
//! So the parse is a real parse. It is small because the grammar is JSON and JSON is small, and
//! it is here rather than behind a dependency because the crate's whole point is that its
//! proof-critical inputs are ones it can account for.
//!
//! **What a read GUARANTEES, beyond well-formedness.** The reader is where the table's internal
//! contract is checked, because a caller that forgets to check it is the normal case:
//!
//! - every `length` is a non-negative integer no greater than God's number;
//! - every case id appears exactly once;
//! - the algorithm's move count EQUALS the length it is stored beside, and a length of zero
//!   carries an empty algorithm. A hand edit that shortens the number without shortening the
//!   maneuver is the exact corruption the tables are committed to make visible, and until now
//!   nothing looked.

use std::collections::BTreeSet;
use std::fmt;

/// God's number in the half-turn metric. No case can claim more, so a longer length is a corrupt
/// field rather than a surprising result.
const MAX_LENGTH: u64 = 20;

// ---------------------------------------------------------------------------------------------
// A JSON value, and a parser that refuses everything that is not one.
// ---------------------------------------------------------------------------------------------

/// A parsed JSON value.
///
/// `Number` keeps the literal TEXT rather than an `f64`. Every number in a case table is an
/// integer, and the failure this module was written for is a fractional one being read as its
/// floor; keeping the token means the integer conversion can refuse `9.9` by looking at it.
/// `Object` keeps a `Vec` of pairs rather than a map for the same reason — a duplicate key is
/// something to refuse, and a map would silently keep one of them.
#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Number(String),
    String(String),
    Array(Vec<Json>),
    Object(Vec<(String, Json)>),
}

impl Json {
    /// The value at `key`, or `None`. Duplicate keys are refused at parse time, so this cannot be
    /// ambiguous.
    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Object(pairs) => pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    fn type_name(&self) -> &'static str {
        match self {
            Json::Null => "null",
            Json::Bool(_) => "a boolean",
            Json::Number(_) => "a number",
            Json::String(_) => "a string",
            Json::Array(_) => "an array",
            Json::Object(_) => "an object",
        }
    }
}

/// Where a parse or a validation gave up, and why. Carries the byte offset so a message about a
/// 65,000-line certificate file points somewhere.
#[derive(Debug, Clone, PartialEq)]
pub struct TableError {
    pub at: usize,
    pub message: String,
}

impl fmt::Display for TableError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "at byte {}: {}", self.at, self.message)
    }
}

impl std::error::Error for TableError {}

fn err<T>(at: usize, message: impl Into<String>) -> Result<T, TableError> {
    Err(TableError {
        at,
        message: message.into(),
    })
}

struct Parser<'a> {
    src: &'a [u8],
    at: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<u8> {
        self.src.get(self.at).copied()
    }

    fn bump(&mut self) -> Option<u8> {
        let c = self.peek();
        if c.is_some() {
            self.at += 1;
        }
        c
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.at += 1;
        }
    }

    fn expect(&mut self, want: u8) -> Result<(), TableError> {
        self.skip_ws();
        match self.bump() {
            Some(c) if c == want => Ok(()),
            Some(c) => err(
                self.at - 1,
                format!("expected `{}`, found `{}`", want as char, c as char),
            ),
            None => err(
                self.at,
                format!("expected `{}`, found the end of the file", want as char),
            ),
        }
    }

    fn value(&mut self) -> Result<Json, TableError> {
        self.skip_ws();
        match self.peek() {
            Some(b'{') => self.object(),
            Some(b'[') => self.array(),
            Some(b'"') => Ok(Json::String(self.string()?)),
            Some(b't') => self.literal("true", Json::Bool(true)),
            Some(b'f') => self.literal("false", Json::Bool(false)),
            Some(b'n') => self.literal("null", Json::Null),
            Some(c) if c == b'-' || c.is_ascii_digit() => self.number(),
            Some(c) => err(self.at, format!("`{}` begins no JSON value", c as char)),
            None => err(self.at, "the file ended where a value was expected"),
        }
    }

    fn literal(&mut self, text: &str, value: Json) -> Result<Json, TableError> {
        let start = self.at;
        if self.src[self.at..].starts_with(text.as_bytes()) {
            self.at += text.len();
            Ok(value)
        } else {
            err(start, format!("expected `{text}`"))
        }
    }

    fn object(&mut self) -> Result<Json, TableError> {
        self.expect(b'{')?;
        let mut pairs: Vec<(String, Json)> = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.at += 1;
            return Ok(Json::Object(pairs));
        }
        loop {
            self.skip_ws();
            let key_at = self.at;
            let key = self.string()?;
            if pairs.iter().any(|(k, _)| *k == key) {
                return err(
                    key_at,
                    format!("the key `{key}` appears twice in one object"),
                );
            }
            self.expect(b':')?;
            let value = self.value()?;
            pairs.push((key, value));
            self.skip_ws();
            match self.bump() {
                Some(b',') => continue,
                Some(b'}') => return Ok(Json::Object(pairs)),
                Some(c) => {
                    return err(
                        self.at - 1,
                        format!("expected `,` or `}}`, found `{}`", c as char),
                    )
                }
                None => return err(self.at, "the file ended inside an object"),
            }
        }
    }

    fn array(&mut self) -> Result<Json, TableError> {
        self.expect(b'[')?;
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.at += 1;
            return Ok(Json::Array(items));
        }
        loop {
            items.push(self.value()?);
            self.skip_ws();
            match self.bump() {
                Some(b',') => continue,
                Some(b']') => return Ok(Json::Array(items)),
                Some(c) => {
                    return err(
                        self.at - 1,
                        format!("expected `,` or `]`, found `{}`", c as char),
                    )
                }
                None => return err(self.at, "the file ended inside an array"),
            }
        }
    }

    fn string(&mut self) -> Result<String, TableError> {
        self.expect(b'"')?;
        let mut out = String::new();
        loop {
            let at = self.at;
            match self.bump() {
                None => return err(at, "the file ended inside a string"),
                Some(b'"') => return Ok(out),
                Some(b'\\') => {
                    let escape_at = self.at;
                    match self.bump() {
                        Some(b'"') => out.push('"'),
                        Some(b'\\') => out.push('\\'),
                        Some(b'/') => out.push('/'),
                        Some(b'b') => out.push('\u{8}'),
                        Some(b'f') => out.push('\u{c}'),
                        Some(b'n') => out.push('\n'),
                        Some(b'r') => out.push('\r'),
                        Some(b't') => out.push('\t'),
                        Some(b'u') => out.push(self.unicode_escape(escape_at)?),
                        Some(c) => {
                            return err(escape_at, format!("`\\{}` is not an escape", c as char))
                        }
                        None => return err(escape_at, "the file ended inside an escape"),
                    }
                }
                Some(c) if c < 0x20 => {
                    return err(
                        at,
                        format!("a raw control byte {c:#04x} is not allowed in a string"),
                    )
                }
                Some(c) => {
                    // UTF-8 continuation bytes are copied through untouched; the source is checked
                    // as UTF-8 before it reaches here, so a multi-byte character is whole.
                    let start = self.at - 1;
                    let len = utf8_len(c);
                    if start + len > self.src.len() {
                        return err(start, "the file ended inside a character");
                    }
                    self.at = start + len;
                    match std::str::from_utf8(&self.src[start..self.at]) {
                        Ok(s) => out.push_str(s),
                        Err(_) => return err(start, "not valid UTF-8"),
                    }
                }
            }
        }
    }

    fn unicode_escape(&mut self, at: usize) -> Result<char, TableError> {
        let hex = self
            .src
            .get(self.at..self.at + 4)
            .ok_or_else(|| TableError {
                at,
                message: "a truncated `\\u` escape".into(),
            })?;
        let text = std::str::from_utf8(hex).map_err(|_| TableError {
            at,
            message: "a `\\u` escape that is not hex".into(),
        })?;
        let code = u32::from_str_radix(text, 16).map_err(|_| TableError {
            at,
            message: format!("`\\u{text}` is not hex"),
        })?;
        self.at += 4;
        char::from_u32(code).ok_or_else(|| TableError {
            at,
            message: format!(
                "`\\u{text}` is not a character (a lone surrogate has no place in a case table)"
            ),
        })
    }

    fn number(&mut self) -> Result<Json, TableError> {
        let start = self.at;
        if self.peek() == Some(b'-') {
            self.at += 1;
        }
        let int_start = self.at;
        while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
            self.at += 1;
        }
        if self.at == int_start {
            return err(start, "a number with no digits");
        }
        if self.src[int_start] == b'0' && self.at - int_start > 1 {
            return err(start, "a leading zero is not a JSON number");
        }
        if self.peek() == Some(b'.') {
            self.at += 1;
            let frac_start = self.at;
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.at += 1;
            }
            if self.at == frac_start {
                return err(start, "a decimal point with no digits after it");
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.at += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.at += 1;
            }
            let exp_start = self.at;
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.at += 1;
            }
            if self.at == exp_start {
                return err(start, "an exponent with no digits");
            }
        }
        Ok(Json::Number(
            std::str::from_utf8(&self.src[start..self.at])
                .expect("digits and signs are ASCII")
                .to_string(),
        ))
    }
}

fn utf8_len(first: u8) -> usize {
    match first {
        0x00..=0x7f => 1,
        0xc0..=0xdf => 2,
        0xe0..=0xef => 3,
        _ => 4,
    }
}

/// Parse `text` as one JSON value, with nothing after it.
///
/// "Nothing after it" is the half a `split`-based reader never had: a file truncated mid-way, or
/// one with a second document appended, is a defect and not a value.
pub fn parse(text: &str) -> Result<Json, TableError> {
    let mut p = Parser {
        src: text.as_bytes(),
        at: 0,
    };
    let value = p.value()?;
    p.skip_ws();
    if p.at != p.src.len() {
        return err(p.at, "trailing text after the JSON value");
    }
    Ok(value)
}

// ---------------------------------------------------------------------------------------------
// The case table itself.
// ---------------------------------------------------------------------------------------------

/// One row of a case table: the fields every table has, whatever its kind.
///
/// The kind-specific columns (`facelets`, `alignment` and `goalsAtOptimum` for OLL and PLL;
/// `name`, the slot fields and `minimal` for F2L) stay in the `extra` object so a reader that
/// needs one can ask for it without this struct having to be the union of three shapes.
#[derive(Debug, Clone, PartialEq)]
pub struct Row {
    pub case: String,
    pub length: u8,
    pub alg: String,
    pub extra: Json,
}

impl Row {
    /// A named integer column, refused if it is absent, fractional, negative or out of range.
    pub fn integer(&self, key: &str) -> Result<u64, TableError> {
        let value = self.extra.get(key).ok_or_else(|| TableError {
            at: 0,
            message: format!("case {}: no `{key}` column", self.case),
        })?;
        integer(value, u64::MAX).map_err(|e| TableError {
            at: e.at,
            message: format!("case {}: `{key}` {}", self.case, e.message),
        })
    }

    /// A named string column.
    pub fn text(&self, key: &str) -> Result<&str, TableError> {
        match self.extra.get(key) {
            Some(Json::String(s)) => Ok(s),
            Some(other) => err(
                0,
                format!(
                    "case {}: `{key}` is {}, not a string",
                    self.case,
                    other.type_name()
                ),
            ),
            None => err(0, format!("case {}: no `{key}` column", self.case)),
        }
    }
}

/// A whole case table, read and checked.
#[derive(Debug, Clone, PartialEq)]
pub struct CaseTable {
    /// `oll`, `pll` or `f2l`, as the file states it.
    pub kind: String,
    /// The move-set hash the generating build used.
    pub moveset: String,
    pub rows: Vec<Row>,
    /// The whole parsed document, for the metadata a particular reader cares about (`goalSet`,
    /// `goals`, `scope`).
    pub document: Json,
}

impl CaseTable {
    /// The rows as `(case id, length)`, which is what a histogram wants.
    pub fn lengths(&self) -> impl Iterator<Item = (&str, u8)> {
        self.rows.iter().map(|r| (r.case.as_str(), r.length))
    }

    /// The row for a case, or `None`.
    pub fn row(&self, case: &str) -> Option<&Row> {
        self.rows.iter().find(|r| r.case == case)
    }
}

fn integer(value: &Json, max: u64) -> Result<u64, TableError> {
    match value {
        Json::Number(text) => {
            if text.contains('.') || text.contains('e') || text.contains('E') {
                return err(0, format!("`{text}` is not an integer"));
            }
            if text.starts_with('-') {
                return err(0, format!("`{text}` is negative"));
            }
            let n: u64 = text.parse().map_err(|_| TableError {
                at: 0,
                message: format!("`{text}` does not fit in a 64-bit integer"),
            })?;
            if n > max {
                return err(0, format!("{n} is above the permitted maximum of {max}"));
            }
            Ok(n)
        }
        other => err(0, format!("{} is not a number", other.type_name())),
    }
}

fn string_field<'a>(doc: &'a Json, key: &str) -> Result<&'a str, TableError> {
    match doc.get(key) {
        Some(Json::String(s)) => Ok(s),
        Some(other) => err(0, format!("`{key}` is {}, not a string", other.type_name())),
        None => err(0, format!("the table has no `{key}` field")),
    }
}

/// Read a generated case table, checking everything a reader would otherwise have to remember to.
///
/// `expect_kind` is the kind the caller is asking for; a `pll.json` handed to an OLL reader is a
/// mix-up worth failing on rather than a table that happens to have unfamiliar case ids.
pub fn read_table(text: &str, expect_kind: &str) -> Result<CaseTable, TableError> {
    let document = parse(text)?;
    if !matches!(document, Json::Object(_)) {
        return err(
            0,
            format!("a case table is an object, not {}", document.type_name()),
        );
    }
    let kind = string_field(&document, "kind")?.to_string();
    if kind != expect_kind {
        return err(
            0,
            format!("this is a `{kind}` table, and a `{expect_kind}` one was asked for"),
        );
    }
    let moveset = string_field(&document, "moveset")?.to_string();
    let Some(Json::Array(cases)) = document.get("cases") else {
        return err(0, "the table has no `cases` array");
    };
    if cases.is_empty() {
        return err(0, "the table holds no cases");
    }

    let mut rows = Vec::with_capacity(cases.len());
    let mut seen: BTreeSet<String> = BTreeSet::new();
    for (i, entry) in cases.iter().enumerate() {
        let at = |m: String| TableError {
            at: 0,
            message: format!("case {i}: {m}"),
        };
        if !matches!(entry, Json::Object(_)) {
            return Err(at(format!("is {}, not an object", entry.type_name())));
        }
        let case = match entry.get("case") {
            Some(Json::String(s)) => s.clone(),
            Some(other) => {
                return Err(at(format!("`case` is {}, not a string", other.type_name())))
            }
            None => return Err(at("has no `case` id".into())),
        };
        if !seen.insert(case.clone()) {
            // A duplicate used to overwrite the earlier row in a map, which turns a corrupt table
            // into a plausible smaller one — and can hide the very row a comparison would refute.
            return Err(at(format!("`{case}` appears more than once in this table")));
        }
        let length_value = entry
            .get("length")
            .ok_or_else(|| at(format!("`{case}` has no `length`")))?;
        let length = integer(length_value, MAX_LENGTH)
            .map_err(|e| at(format!("`{case}` length: {}", e.message)))? as u8;
        let alg = match entry.get("alg") {
            Some(Json::String(s)) => s.clone(),
            Some(other) => {
                return Err(at(format!(
                    "`{case}` alg is {}, not a string",
                    other.type_name()
                )))
            }
            None => return Err(at(format!("`{case}` has no `alg`"))),
        };
        // THE CHECK NOTHING WAS MAKING. The length and the maneuver are two spellings of one fact,
        // and a hand edit to either alone is exactly the corruption committed tables exist to make
        // visible.
        let moves = alg.split_whitespace().count();
        if moves != length as usize {
            return Err(at(format!(
                "`{case}` claims {length} moves and carries {moves} (`{alg}`)"
            )));
        }
        rows.push(Row {
            case,
            length,
            alg,
            extra: entry.clone(),
        });
    }
    Ok(CaseTable {
        kind,
        moveset,
        rows,
        document,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLL: &str = r#"{
  "kind": "pll",
  "moveset": "abc",
  "goalSet": "auf4xauf4",
  "goals": 16,
  "cases": [
    { "case": "pll:01230123", "facelets": "U", "length": 0, "alg": "", "alignment": 0, "goalsAtOptimum": 1 },
    { "case": "pll:01230231", "facelets": "U", "length": 3, "alg": "R U R'", "alignment": 2, "goalsAtOptimum": 4 }
  ]
}
"#;

    #[test]
    fn a_well_formed_table_reads_back_with_its_rows_and_metadata() {
        let t = read_table(PLL, "pll").expect("a table");
        assert_eq!(t.kind, "pll");
        assert_eq!(t.moveset, "abc");
        assert_eq!(t.rows.len(), 2);
        assert_eq!(t.rows[1].case, "pll:01230231");
        assert_eq!(t.rows[1].length, 3);
        assert_eq!(t.rows[1].alg, "R U R'");
        assert_eq!(t.rows[1].integer("goalsAtOptimum").unwrap(), 4);
        assert_eq!(t.rows[1].text("facelets").unwrap(), "U");
        assert_eq!(t.row("pll:01230123").map(|r| r.length), Some(0));
        assert_eq!(
            integer(t.document.get("goals").unwrap(), u64::MAX).unwrap(),
            16
        );
    }

    /// The four reads that used to succeed on something that is not a table.
    #[test]
    fn the_four_ways_a_split_based_read_used_to_be_fooled_are_all_refused() {
        // 1. A truncated file — no closing brace.
        let truncated = &PLL[..PLL.len() - 3];
        assert!(
            read_table(truncated, "pll").is_err(),
            "a truncated table parsed"
        );

        // 2. A fractional length silently floored to 9.
        let fractional = PLL.replace("\"length\": 3", "\"length\": 3.9");
        let e = read_table(&fractional, "pll").expect_err("a fractional length parsed");
        assert!(e.message.contains("not an integer"), "{e}");

        // 3. A duplicated case id, which a map read would have collapsed.
        let duplicated = PLL.replace("pll:01230231", "pll:01230123");
        let e = read_table(&duplicated, "pll").expect_err("a duplicate id parsed");
        assert!(e.message.contains("more than once"), "{e}");

        // 4. Compact JSON, which a `"length": ` split reads as an empty table. It is valid JSON
        //    and must READ, not fail — the old readers failed on it for the wrong reason.
        let compact =
            r#"{"kind":"pll","moveset":"abc","cases":[{"case":"pll:0","length":1,"alg":"R"}]}"#;
        assert_eq!(
            read_table(compact, "pll")
                .expect("compact is valid")
                .rows
                .len(),
            1
        );
    }

    #[test]
    fn a_length_that_disagrees_with_its_maneuver_is_refused() {
        let edited = PLL.replace(
            "\"length\": 3, \"alg\": \"R U R'\"",
            "\"length\": 2, \"alg\": \"R U R'\"",
        );
        let e = read_table(&edited, "pll").expect_err("a hand-edited length parsed");
        assert!(e.message.contains("claims 2 moves and carries 3"), "{e}");

        let skip = PLL.replace(
            "\"length\": 0, \"alg\": \"\"",
            "\"length\": 0, \"alg\": \"R\"",
        );
        assert!(
            read_table(&skip, "pll").is_err(),
            "a skip with an algorithm parsed"
        );
    }

    #[test]
    fn a_length_above_gods_number_is_a_corrupt_field_not_a_result() {
        let absurd = PLL.replace("\"length\": 3", "\"length\": 21");
        let e = read_table(&absurd, "pll").expect_err("21 moves parsed");
        assert!(e.message.contains("above the permitted maximum"), "{e}");
    }

    #[test]
    fn the_wrong_kind_of_table_is_refused_rather_than_read_as_unfamiliar_cases() {
        let e = read_table(PLL, "oll").expect_err("a pll table read as oll");
        assert!(e.message.contains("`pll` table"), "{e}");
    }

    #[test]
    fn the_parser_refuses_what_is_not_json() {
        for bad in [
            "",
            "{",
            "{}{}",
            "{\"a\": 1,}",
            "[1, 2,]",
            "{\"a\": 01}",
            "{\"a\": 1.}",
            "{\"a\": 1e}",
            "{\"a\": tru}",
            "{\"a\": \"unterminated",
            "{\"a\": 1, \"a\": 2}",
        ] {
            assert!(parse(bad).is_err(), "parsed {bad:?}");
        }
        // And accepts what is.
        assert_eq!(parse("  null ").unwrap(), Json::Null);
        assert_eq!(parse("[]").unwrap(), Json::Array(vec![]));
        assert_eq!(parse(r#""a\"bé""#).unwrap(), Json::String("a\"bé".into()));
        assert_eq!(parse("-1.5e+3").unwrap(), Json::Number("-1.5e+3".into()));
    }
}
