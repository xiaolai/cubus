//! Which capture format the scan wants, decided over plain numbers so the choice is tested on every
//! host — `windows.rs` maps Media Foundation's formats onto [Candidate] and back.
//!
//! The scan wants the colour format nearest to `WANTED_WIDTH`×`WANTED_HEIGHT`, and at that size the
//! highest frame rate; ties keep the camera's own order. "Nearest" is nokhwa's own metric for
//! `Closest` — squared distance in pixels — applied across every colour format at once rather than
//! within one. Colour only: the RGB decoder reads colour formats and nothing else, so a GRAY-only
//! camera is refused here instead of failing on its first frame.
//!
//! `WANTED_*` are the browser path's `IDEAL_WIDTH`/`IDEAL_HEIGHT` (`packages/cube-scanner/src/
//! camera.ts`): both ask the camera for the same frame, and the letterbox takes the long side down
//! to 640 whatever arrives. The two were two literals with nothing holding them together
//! (2026-09-21, audit-fix row 30); `the_wanted_frame_is_the_browsers_ideal` reads them out of the
//! TypeScript at test time so a change to the browser's policy fails here.

/// The frame the scan asks a camera for, if the camera has it.
pub const WANTED_WIDTH: u32 = 1280;
pub const WANTED_HEIGHT: u32 = 720;

/// One format a camera offers, reduced to what the policy reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub width: u32,
    pub height: u32,
    /// Whether the RGB decoder can read it (`nokhwa::utils::color_frame_formats`).
    pub colour: bool,
    pub frame_rate: u32,
}

/// The index of the format to capture at, or None when nothing on offer is a colour format.
pub fn pick_nearest(offered: &[Candidate]) -> Option<usize> {
    offered
        .iter()
        .enumerate()
        .filter(|(_, c)| c.colour)
        .min_by_key(|(_, c)| (distance(c), std::cmp::Reverse(c.frame_rate)))
        .map(|(i, _)| i)
}

/// Squared distance from the wanted size, in `u128`: two `u32` deltas squared and summed can pass
/// `i64::MAX` for metadata near the top of the range, which was a debug panic (or a wrapped, wrong
/// order in release) on malformed driver data (2026-09-21, audit-fix row 129). `abs_diff` never wraps.
fn distance(c: &Candidate) -> u128 {
    let dx = u128::from(c.width.abs_diff(WANTED_WIDTH));
    let dy = u128::from(c.height.abs_diff(WANTED_HEIGHT));
    dx * dx + dy * dy
}

#[cfg(test)]
mod tests {
    use super::*;

    fn offered(width: u32, height: u32, colour: bool, frame_rate: u32) -> Candidate {
        Candidate {
            width,
            height,
            colour,
            frame_rate,
        }
    }

    /// The audit's camera (2.15): its top rate exists only at 480p. `AbsoluteHighestFrameRate`
    /// took that mode and the letterbox upscaled it; the scan wants 720p, at 720p's best rate.
    #[test]
    fn the_capture_format_is_the_nearest_to_720p_not_the_fastest() {
        let list = [
            offered(640, 480, true, 60),
            offered(1280, 720, true, 10),
            offered(1280, 720, true, 30),
            offered(1920, 1080, true, 30),
        ];
        assert_eq!(pick_nearest(&list), Some(2), "720p at its highest rate");
    }

    /// A camera with no 720p mode gets its nearest size — where an exact-size request would have
    /// refused it outright.
    #[test]
    fn a_camera_without_720p_gets_its_nearest_size_rather_than_a_refusal() {
        let list = [offered(640, 480, true, 30), offered(1600, 1200, true, 15)];
        // (1600-1280)² + (1200-720)² = 332 800 against (640-1280)² + (480-720)² = 467 200.
        assert_eq!(pick_nearest(&list), Some(1));
    }

    /// Ties keep the camera's order, and a format the decoder cannot read is never chosen.
    #[test]
    fn only_colour_formats_are_considered_and_ties_keep_the_cameras_order() {
        let list = [
            offered(1280, 720, false, 60),
            offered(1280, 720, true, 30),
            offered(1280, 720, true, 30),
        ];
        assert_eq!(
            pick_nearest(&list),
            Some(1),
            "first of the equal candidates"
        );
        assert_eq!(
            pick_nearest(&[offered(1280, 720, false, 30)]),
            None,
            "a GRAY-only camera is refused before its first frame, not on it"
        );
    }

    /// Malformed metadata at the top of `u32` does not overflow the distance (2026-09-21, audit-fix
    /// row 129):
    /// it is simply the farthest candidate, and a sane one beside it wins.
    #[test]
    fn a_size_at_the_top_of_u32_is_far_not_a_panic() {
        let list = [
            offered(u32::MAX, u32::MAX, true, 30),
            offered(1280, 720, true, 30),
        ];
        assert_eq!(pick_nearest(&list), Some(1));
        assert_eq!(
            pick_nearest(&list[..1]),
            Some(0),
            "alone, it is still a choice"
        );
    }

    /// `WANTED_*` are the browser's ideal, read out of the TypeScript source at test time so the
    /// two policies cannot drift apart silently (audit-fix row 30).
    #[test]
    fn the_wanted_frame_is_the_browsers_ideal() {
        let camera_ts = include_str!("../../../packages/cube-scanner/src/camera.ts");
        let declared = |name: &str| -> u32 {
            let key = format!("export const {name} = ");
            let at = camera_ts
                .find(&key)
                .unwrap_or_else(|| panic!("camera.ts no longer declares {name}"));
            let rest = &camera_ts[at + key.len()..];
            let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            digits
                .parse()
                .unwrap_or_else(|_| panic!("{name} in camera.ts is not a number: {rest:.20}"))
        };
        assert_eq!(WANTED_WIDTH, declared("IDEAL_WIDTH"));
        assert_eq!(WANTED_HEIGHT, declared("IDEAL_HEIGHT"));
    }
}
