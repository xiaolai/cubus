//! The layout contract's desktop window — dev-docs/stage-contract.md.
//!
//! Pure arithmetic, no tauri: a monitor's work area in logical px, the app's title bar, and the
//! persisted orientation give a fixed window whose stage is exactly 4:3 (landscape) or 3:4
//! (portrait). The same formulas live in `apps/web/lib/stage.js` as the oracle the fixture tables
//! are checked against; the tests below hold this side to the document's desktop table.
//!
//! ```text
//! landscape:  w = min( clamp(minW, k·workW, maxW),  (workH − bar − margin) · 4/3 )   h = w · 3/4
//! portrait:   h = min( clamp(minH, k·workH, maxH),   workH − bar − margin )           w = h · 3/4
//! window    = (w, h + bar)
//! ```

/// The long side over the short side of the reference box.
pub const RATIO: f64 = 4.0 / 3.0;

/// Tuning values, not the contract: `k` is the share of the work area asked for before the
/// clamps, `min`/`max` bound the stage's long side.
#[derive(Clone, Copy, Debug)]
pub struct Constants {
    pub k: f64,
    pub min: f64,
    pub max: f64,
}

/// Of the work area's WIDTH; bounds the stage width.
pub const LANDSCAPE: Constants = Constants {
    k: 0.5,
    min: 840.0,
    max: 1600.0,
};
/// Of the work area's HEIGHT; bounds the stage height.
pub const PORTRAIT: Constants = Constants {
    k: 0.9,
    min: 500.0,
    max: 1200.0,
};
/// Keeps a height-bound window off the work area's edge.
pub const MARGIN: f64 = 16.0;

/// The app's own title bar, in logical px, drawn inside the window's content: 52 on macOS (the
/// overlay bar the traffic lights sit in), 44 on Windows and Linux (undecorated windows, the
/// caption buttons are the app's).
#[cfg(target_os = "macos")]
pub const BAR: f64 = 52.0;
#[cfg(not(target_os = "macos"))]
pub const BAR: f64 = 44.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Orientation {
    Landscape,
    Portrait,
}

impl Orientation {
    /// The persisted form. Anything else is landscape — the shape the app is designed in first.
    pub fn parse(s: &str) -> Self {
        if s.trim() == "portrait" {
            Self::Portrait
        } else {
            Self::Landscape
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Landscape => "landscape",
            Self::Portrait => "portrait",
        }
    }
}

/// A fixed window: the stage, and the window that holds it plus the bar. Logical px.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Window {
    pub stage_w: f64,
    pub stage_h: f64,
    pub width: f64,
    pub height: f64,
}

fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    v.max(lo).min(hi)
}

/// The window for a work area (logical px) and a title bar, in an orientation.
pub fn window(work_w: f64, work_h: f64, bar: f64, orientation: Orientation) -> Window {
    match orientation {
        Orientation::Landscape => {
            let Constants { k, min, max } = LANDSCAPE;
            let w = clamp(k * work_w, min, max).min((work_h - bar - MARGIN) * RATIO);
            let h = w / RATIO;
            Window {
                stage_w: w,
                stage_h: h,
                width: w,
                height: h + bar,
            }
        }
        Orientation::Portrait => {
            let Constants { k, min, max } = PORTRAIT;
            let h = clamp(k * work_h, min, max).min(work_h - bar - MARGIN);
            let w = h / RATIO;
            Window {
                stage_w: w,
                stage_h: h,
                width: w,
                height: h + bar,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (work area, bar, landscape stage, portrait stage) — one row of the document's table.
    type Row = ((f64, f64), f64, (f64, f64), (f64, f64));

    /// The contract document's desktop table, verbatim. stage.test.mjs reads the same rows out
    /// of the document and checks them against the JavaScript oracle; this holds the Rust side
    /// to the same numbers.
    const TABLE: &[Row] = &[
        ((1470.0, 850.0), 52.0, (840.0, 630.0), (574.0, 765.0)),
        ((2560.0, 1410.0), 52.0, (1280.0, 960.0), (900.0, 1200.0)),
        ((1366.0, 720.0), 44.0, (840.0, 630.0), (486.0, 648.0)),
        ((1280.0, 672.0), 44.0, (816.0, 612.0), (454.0, 605.0)),
    ];

    #[test]
    fn the_documents_desktop_table_is_what_the_formulas_give() {
        for ((ww, wh), bar, land, port) in TABLE {
            let l = window(*ww, *wh, *bar, Orientation::Landscape);
            let p = window(*ww, *wh, *bar, Orientation::Portrait);
            assert_eq!(
                (l.stage_w.round(), l.stage_h.round()),
                *land,
                "landscape for {ww}×{wh}"
            );
            assert_eq!(
                (p.stage_w.round(), p.stage_h.round()),
                *port,
                "portrait for {ww}×{wh}"
            );
        }
    }

    #[test]
    fn the_window_is_the_stage_plus_the_bar_and_never_exceeds_the_work_area() {
        for ((ww, wh), bar, _, _) in TABLE {
            for o in [Orientation::Landscape, Orientation::Portrait] {
                let w = window(*ww, *wh, *bar, o);
                assert_eq!(w.width, w.stage_w);
                assert_eq!(w.height, w.stage_h + bar);
                assert!(
                    w.width <= *ww && w.height <= *wh,
                    "{o:?} on {ww}×{wh}: {w:?}"
                );
                let ratio = match o {
                    Orientation::Landscape => w.stage_w / w.stage_h,
                    Orientation::Portrait => w.stage_h / w.stage_w,
                };
                assert!((ratio - RATIO).abs() < 1e-9, "stage ratio {ratio}");
            }
        }
    }

    #[test]
    fn a_work_area_too_small_for_the_minimum_gives_the_height_bound_window_not_the_minimum() {
        // The 150%-scaled Windows laptop: 1280×672, bar 44 — below minW, and it must still fit.
        let w = window(1280.0, 672.0, 44.0, Orientation::Landscape);
        assert!(w.stage_w < LANDSCAPE.min);
        assert!(w.height <= 672.0);
    }

    #[test]
    fn orientation_round_trips_through_its_persisted_form_and_defaults_to_landscape() {
        for o in [Orientation::Landscape, Orientation::Portrait] {
            assert_eq!(Orientation::parse(o.as_str()), o);
        }
        assert_eq!(Orientation::parse(""), Orientation::Landscape);
        assert_eq!(Orientation::parse("sideways\n"), Orientation::Landscape);
        assert_eq!(Orientation::parse("portrait\n"), Orientation::Portrait);
    }
}
