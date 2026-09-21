//! `preprocess()` from `packages/cube-scanner/src/letterbox.ts`, reproduced exactly, in Rust.
//!
//! THE LETTERBOX IS THE CORRECTNESS PROBLEM on every native arm that letterboxes in Rust (Windows):
//! everything downstream of `next_detection` is one TypeScript implementation calibrated against
//! one preprocessing — long side to 640, bilinear at PIXEL CENTRES, centre-pad grey 114, normalise,
//! CHW, RGB. `ml/golden_frames.py` proves the .onnx agrees with the other runtimes; it does not
//! prove this code feeds it the same pixels. That is what the parity tests below hold, on EVERY host
//! (2026-09-21, audit-fix row 38): this lived in `windows.rs`, whose tests run only on Windows, so
//! the one parity test there had never run on a Mac, covered a single landscape frame with no
//! horizontal padding, and compared ten samples and a weighted checksum rather than every float.
//! Moved here, compiled under `cfg(test)` everywhere, and held to an FNV-1a hash of every output
//! float against numbers the TypeScript produced (`scripts/letterbox-fixtures.mjs`).

/// Letterbox pad colour (grey 114), normalised — the pad the model was trained with
/// (ml/cube_infer.py PAD), and the same constant as the TS.
pub const PAD: f32 = 114.0 / 255.0;
/// The model's square input side.
pub const IMG: usize = 640;

/// RGB pixels of a `w`×`h` picture → the CHW float tensor the model takes, `3 * IMG * IMG` long.
///
/// IN f64, because the TypeScript is. Every JS number is a double and only the store into
/// `Float32Array` rounds; computing in f32 can land `sy` on the other side of an integer boundary
/// and pick a different source row, so "reproduced line for line" was not true of the arithmetic —
/// only of the shape of it. The same gap existed in the Android plugin and was fixed in the same
/// pass. The caller guarantees `w > 0`, `h > 0` and `rgb.len() == w * h * 3` (`crate::frame` for the
/// harness path, the capture loop for the camera's).
pub fn letterbox(rgb: &[u8], w: usize, h: usize) -> Vec<f32> {
    let scale = IMG as f64 / w.max(h) as f64;
    let new_w = ((w as f64 * scale).round() as usize).max(1);
    let new_h = ((h as f64 * scale).round() as usize).max(1);
    let pad_x = (IMG - new_w) / 2;
    let pad_y = (IMG - new_h) / 2;
    let area = IMG * IMG;
    let mut out = vec![PAD; 3 * area];
    let at = |x: usize, y: usize, c: usize| -> f64 { rgb[(y * w + x) * 3 + c] as f64 };

    for y in 0..new_h {
        // The `+ 0.5 … - 0.5` is the half-pixel convention the model was calibrated against, not
        // decoration: dropping it shifts every box by half a pixel at 640 and more after the scale
        // back, which reads as a model that got worse.
        let sy = (((y as f64 + 0.5) / scale) - 0.5).clamp(0.0, h as f64 - 1.0);
        let y0 = sy.floor() as usize;
        let y1 = (y0 + 1).min(h - 1);
        let fy = sy - y0 as f64;
        let oy = y + pad_y;
        for x in 0..new_w {
            let sx = (((x as f64 + 0.5) / scale) - 0.5).clamp(0.0, w as f64 - 1.0);
            let x0 = sx.floor() as usize;
            let x1 = (x0 + 1).min(w - 1);
            let fx = sx - x0 as f64;
            let o = oy * IMG + (x + pad_x);
            for c in 0..3 {
                let top = at(x0, y0, c) + (at(x1, y0, c) - at(x0, y0, c)) * fx;
                let bot = at(x0, y1, c) + (at(x1, y1, c) - at(x0, y1, c)) * fx;
                out[c * area + o] = ((top + (bot - top) * fy) / 255.0) as f32;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The fixture picture, generated the same way on both sides of the comparison
    /// (`scripts/letterbox-fixtures.mjs` `fixture`).
    fn fixture(w: usize, h: usize) -> Vec<u8> {
        let mut rgb = vec![0u8; w * h * 3];
        for y in 0..h {
            for x in 0..w {
                let o = (y * w + x) * 3;
                rgb[o] = ((x * 7 + y * 13) % 256) as u8;
                rgb[o + 1] = ((x * 31 + y * 5 + 77) % 256) as u8;
                rgb[o + 2] = ((x * 17 + y * 23 + 191) % 256) as u8;
            }
        }
        rgb
    }

    /// FNV-1a 64 over the little-endian bytes of every float — the same digest the TypeScript side
    /// of `scripts/letterbox-fixtures.mjs` computes over its `Float32Array`.
    fn fnv1a64(floats: &[f32]) -> u64 {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for v in floats {
            for b in v.to_le_bytes() {
                h ^= u64::from(b);
                h = h.wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
        h
    }

    /// THE PARITY TEST, against numbers produced by the TypeScript, not by this code — every
    /// output float, hashed, on eight shapes: the landscape frame that was the only one checked
    /// before, its PORTRAIT twin (horizontal padding, which the old test never exercised), a square
    /// (no padding), the 1×1 and 640×1 / 1×640 boundaries where `round(...).max(1)` and the clamp
    /// decide, a frame larger than 640 both ways, and a tall sliver. The expected hashes come from
    /// `node crates/cube-vision/scripts/letterbox-fixtures.mjs`, which bundles the real
    /// `preprocess` and prints them; re-run it, never edit them by hand.
    #[test]
    fn letterbox_matches_the_typescript_reference_on_every_shape() {
        let expected: [(usize, usize, u64); 8] = [
            (97, 43, 0xabe7_d5ae_4f3b_5437),
            (43, 97, 0x6996_4d28_a768_530b),
            (50, 50, 0x694a_34c5_8d2d_00c6),
            (1, 1, 0xe153_7a62_680b_2325),
            (640, 1, 0x571e_1798_6f67_2743),
            (1, 640, 0x5222_b287_e320_76e2),
            (1281, 721, 0xca3c_feee_1d4c_7216),
            (3, 1000, 0xd34f_61a8_6fa8_1749),
        ];
        for (w, h, want) in expected {
            let out = letterbox(&fixture(w, h), w, h);
            assert_eq!(
                out.len(),
                3 * IMG * IMG,
                "{w}x{h}: the tensor is 3x{IMG}x{IMG}"
            );
            let got = fnv1a64(&out);
            assert_eq!(
                got, want,
                "{w}x{h}: this letterbox hashes to {got:#018x}, the TypeScript's to {want:#018x} — \
                 the letterbox has drifted from `preprocess()`"
            );
        }
    }

    /// The readable anchor the hash test replaces nothing of: ten values straight out of the
    /// TypeScript on the landscape frame, so a drift is shown as numbers and not only as a hash.
    #[test]
    fn letterbox_matches_the_typescript_reference_sample_for_sample() {
        let (w, h) = (97usize, 43usize);
        let out = letterbox(&fixture(w, h), w, h);
        let expected: [(usize, f32); 10] = [
            (128_100, 0.552_769_6),
            (192_320, 0.232_916_67),
            (256_600, 0.162_696_08),
            (537_700, 0.142_132_36),
            (601_920, 0.477_181_37),
            (666_200, 0.913_823_55),
            (947_300, 0.320_842_53),
            (1_011_520, 0.563_982_84),
            (1_075_800, 0.744_497_54),
            (6_410, 0.447_058_83),
        ];
        for (i, want) in expected {
            assert_eq!(
                out[i], want,
                "index {i}: this implementation gives {}, the TypeScript gives {want}",
                out[i]
            );
        }
    }

    /// The portrait frame's padding is HORIZONTAL: the first and last columns of every row are the
    /// pad colour and the middle is picture — the geometry the landscape-only test could not see.
    #[test]
    fn a_portrait_frame_is_padded_left_and_right() {
        let (w, h) = (43usize, 97usize);
        let out = letterbox(&fixture(w, h), w, h);
        let new_w = ((w as f64 * (IMG as f64 / h as f64)).round() as usize).max(1);
        let pad_x = (IMG - new_w) / 2;
        let row = (IMG / 2) * IMG;
        assert_eq!(out[row], PAD, "left pad");
        assert_eq!(out[row + IMG - 1], PAD, "right pad");
        assert_ne!(out[row + pad_x + new_w / 2], PAD, "picture in the middle");
        assert_ne!(
            out[IMG / 2],
            PAD,
            "no top pad: the long side fills the square"
        );
    }
}
