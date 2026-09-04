//! The ONE wire shape of `infer_frame`, and the checks that stand between it and any FFI.
//!
//! `infer_frame` exists for the parity harness: a still frame in, the raw tensor out, so a test can
//! prove the plugin's own letterbox matches `preprocess()` end to end. Two plugins implemented it
//! and they disagreed about everything — Apple took `rgba: Vec<u8>` with `i32` dimensions, Windows
//! took `rgb_base64` with `usize` — so a harness written against one could never drive the other,
//! and the Apple arm multiplied two `i32`s straight into a length check it then trusted (audit
//! 2026-09-04, headline 5). This module is where that ends:
//!
//! - **`rgba_base64`, `width: usize`, `height: usize`** on every platform. RGBA because that is
//!   what a `RawFrame` and every canvas readback already are; base64 because a `Vec<u8>` crosses
//!   Tauri's bridge as a JSON array of numbers (~4 bytes of text per byte) and a 1080p frame is
//!   8 MB of pixels; `usize` because a negative dimension is not a dimension.
//! - **Every check happens here, before any pointer is formed**: zero dimensions refused (the
//!   letterbox computes `h - 1`), the byte count computed with `checked_mul` (a large pair used to
//!   overflow into a length the buffer then failed to satisfy — or satisfied by accident), and
//!   the decoded length compared EXACTLY against it.
//!
//! Compiled on every target that has an `infer_frame`, and under `cfg(test)` everywhere else so the
//! checks are exercised on a Mac without a Windows machine and vice versa.

use base64::Engine as _;

/// Bytes per RGBA pixel — the only pixel format `infer_frame` accepts.
pub const RGBA_CHANNELS: usize = 4;

/// Decode and validate one `infer_frame` payload. Returns the RGBA bytes, guaranteed to be exactly
/// `width * height * 4` long with both dimensions positive — the only precondition the letterboxes
/// (Swift, Rust) need, and the one they must never be asked to check themselves.
pub fn decode_rgba(rgba_base64: &str, width: usize, height: usize) -> Result<Vec<u8>, String> {
    let expected = rgba_len(width, height)?;
    let rgba = base64::engine::general_purpose::STANDARD
        .decode(rgba_base64.as_bytes())
        .map_err(|e| format!("rgba_base64 is not base64: {e}"))?;
    if rgba.len() != expected {
        return Err(format!(
            "rgba is {} bytes, expected {expected} for {width}x{height} RGBA",
            rgba.len()
        ));
    }
    Ok(rgba)
}

/// The byte length a `width`x`height` RGBA frame must have, or why no such frame can exist.
///
/// Refuses BEFORE decoding: a zero dimension is rejected against an empty payload as much as a
/// full one, and an overflowing pair is rejected rather than wrapped into a number some buffer
/// might happen to match.
pub fn rgba_len(width: usize, height: usize) -> Result<usize, String> {
    if width == 0 || height == 0 {
        return Err(format!(
            "frame dimensions must be positive, got {width}x{height}"
        ));
    }
    width
        .checked_mul(height)
        .and_then(|px| px.checked_mul(RGBA_CHANNELS))
        .ok_or_else(|| format!("{width}x{height} RGBA overflows a usize"))
}

/// Drop the alpha channel: the Windows letterbox reads RGB triples, the wire carries RGBA quads.
/// Only the harness path pays this pass; the camera thread decodes straight to RGB.
#[cfg(any(target_os = "windows", test))]
pub fn strip_alpha(rgba: &[u8]) -> Vec<u8> {
    let (pixels, rest) = rgba.as_chunks::<RGBA_CHANNELS>();
    debug_assert!(
        rest.is_empty(),
        "an RGBA buffer is a whole number of pixels"
    );
    pixels.iter().flat_map(|px| [px[0], px[1], px[2]]).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b64(bytes: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    #[test]
    fn a_well_formed_frame_decodes_to_exactly_its_bytes() {
        let px = vec![7u8; 3 * 2 * 4];
        assert_eq!(decode_rgba(&b64(&px), 3, 2).unwrap(), px);
    }

    /// Zero dimensions were the audit's headline: `0 * h * 4 == 0` matched an EMPTY payload, so
    /// the check passed and the letterbox then computed `h - 1`. Both zeros are refused, and they
    /// are refused even when the payload agrees with them.
    #[test]
    fn a_zero_dimension_is_refused_even_against_an_empty_payload() {
        assert!(decode_rgba("", 0, 480).unwrap_err().contains("positive"));
        assert!(decode_rgba("", 640, 0).unwrap_err().contains("positive"));
        assert!(rgba_len(0, 0).is_err());
    }

    /// The multiplication cannot wrap. Before `checked_mul` a pair like this produced a small
    /// "expected" length that a small buffer satisfied, and the FFI was handed dimensions
    /// describing terabytes of pixels it did not have.
    #[test]
    fn an_overflowing_pair_is_refused_rather_than_wrapped() {
        let huge = usize::MAX / 2;
        let e = rgba_len(huge, 4).unwrap_err();
        assert!(e.contains("overflows"), "{e}");
        assert!(decode_rgba("", huge, huge).is_err());
    }

    #[test]
    fn a_length_mismatch_is_refused_with_both_numbers() {
        let e = decode_rgba(&b64(&[0u8; 10]), 2, 2).unwrap_err();
        assert!(e.contains("10 bytes") && e.contains("expected 16"), "{e}");
    }

    #[test]
    fn junk_is_not_base64() {
        assert!(decode_rgba("not base64!!", 1, 1)
            .unwrap_err()
            .contains("not base64"));
    }

    #[test]
    fn strip_alpha_keeps_rgb_in_order() {
        assert_eq!(
            strip_alpha(&[1, 2, 3, 255, 4, 5, 6, 0]),
            vec![1, 2, 3, 4, 5, 6]
        );
    }
}
