//! The tensor wire format and the checks a native answer passes before it is encoded.
//!
//! ONE encoder for both arms (2026-09-21, audit-fix rows 95 and 96). `apple.rs` moved to version 2
//! on 2026-09-19 and `windows.rs` stayed on version 1 "until it could be built and tested on the
//! platform" — which left the scan screen unable to place a sticker in the picture on Windows, since
//! version 1 carries no picture size. Both arms now write the same bytes through this module.
//!
//! The layout: `int32 -2` (the version, negative so it can never be read as a row count), then
//! `int32 rows, int32 anchors, int32 width, int32 height`, then `count` little-endian f32s.
//! `width`×`height` is the camera picture the tensor was letterboxed from, `[0, 0]` for the idle
//! answer ("no frame yet"), which is the 20-byte header alone. `decodeTensorResponse` in
//! `packages/cube-scanner/view/native-detector.ts` reads it.
//!
//! VERSION 3 ADDS THE FRAME'S IDENTITY (D2, `dev-docs/scan-pipeline-audit-2026-09-23.md` §3): one
//! more `int32` after the height, and a 24-byte header. The camera re-serves its cached frame on
//! every tick for up to `Camera.frameStaleAfter`, and the page had no way to tell that from a
//! stream of new frames — so one physical frame supplied several reads to a gate that asks for
//! three identical ones, and any accumulation on top would have counted it several times.
//!
//! A FRAME ID IS OPTIONAL, AND THAT IS THE POINT. An arm that cannot identify its frames writes
//! version 2 and says nothing; only an arm that genuinely knows writes version 3. Inventing a
//! counter would read on the page as "every tick is a new frame" — exactly the false belief this
//! corrects — so a plugin without the fact stays silent rather than being made to look modern.
//!
//! VALIDATED, NOT CLAMPED. `tensor_bytes` used to clamp every value to zero and truncate an oversized
//! count to the buffer, so a native side that broke its contract — a negative row count, a count the
//! buffer could not hold, a shape whose product was not the count — shipped a plausible-looking
//! tensor that failed later, in TypeScript, with a message about the model. The contract is checked
//! here, at the boundary the values cross, and a violation is an `Err` naming the value.

/// The version word for a response that carries no frame identity: negative, so a reader that
/// expected version 1's `rows` first cannot mistake it.
pub const WIRE_VERSION: i32 = -2;

/// The version word for a response that carries its frame's identity.
pub const WIRE_VERSION_FRAME_ID: i32 = -3;

/// The header's size in bytes: version, rows, anchors, width, height.
pub const HEADER_BYTES: usize = 20;

/// A version 3 header: `HEADER_BYTES` plus the frame id.
pub const HEADER_BYTES_FRAME_ID: usize = 24;

/// The bytes of a tensor response, or why the native side's answer is not one.
///
/// `count` is how many of `data`'s floats the native side wrote; `rows` × `anchors` must be exactly
/// that many; `picture` is `[width, height]`, both zero (no frame) or both positive. `frame_id` is
/// `None` from an arm that cannot identify its frames, which writes version 2 — see the module
/// header for why that is never faked.
pub fn tensor_bytes(
    count: i32,
    rows: i32,
    anchors: i32,
    picture: [i32; 2],
    frame_id: Option<i32>,
    data: &[f32],
) -> Result<Vec<u8>, String> {
    let n = usize::try_from(count).map_err(|_| format!("a tensor of {count} elements"))?;
    if n > data.len() {
        return Err(format!(
            "the native side reported {count} elements into a buffer of {}",
            data.len()
        ));
    }
    let rows_n = usize::try_from(rows).map_err(|_| format!("a tensor with {rows} rows"))?;
    let anchors_n =
        usize::try_from(anchors).map_err(|_| format!("a tensor with {anchors} anchors"))?;
    let promised = rows_n
        .checked_mul(anchors_n)
        .ok_or_else(|| format!("a tensor of {rows}x{anchors} elements overflows"))?;
    if promised != n {
        return Err(format!(
            "the native side reported a {rows}x{anchors} tensor ({promised} elements) but wrote \
             {count}"
        ));
    }
    let [width, height] = picture;
    if width < 0 || height < 0 {
        return Err(format!("a picture of {width}x{height}"));
    }
    if (width == 0) != (height == 0) {
        return Err(format!(
            "a picture of {width}x{height} — half a size is neither a frame nor none"
        ));
    }
    // An id on the idle answer would be an identity for a frame that does not exist. The page's
    // reader admits a version 3 header whose counts are all zero, so this is refused HERE rather
    // than passed on as a frame nobody delivered.
    if frame_id.is_some() && anchors == 0 {
        return Err("a frame id on the idle answer — there is no frame to identify".to_string());
    }
    let header = match frame_id {
        None => HEADER_BYTES,
        Some(_) => HEADER_BYTES_FRAME_ID,
    };
    let mut out = Vec::with_capacity(header + n * 4);
    match frame_id {
        None => out.extend_from_slice(&WIRE_VERSION.to_le_bytes()),
        Some(_) => out.extend_from_slice(&WIRE_VERSION_FRAME_ID.to_le_bytes()),
    }
    out.extend_from_slice(&rows.to_le_bytes());
    out.extend_from_slice(&anchors.to_le_bytes());
    out.extend_from_slice(&width.to_le_bytes());
    out.extend_from_slice(&height.to_le_bytes());
    // Any i32 is a legal identity, negative included: it is compared for CHANGE, never ordered or
    // counted, so a counter that wrapped is still a correct answer to "is this the same frame?".
    if let Some(id) = frame_id {
        out.extend_from_slice(&id.to_le_bytes());
    }
    for &v in &data[..n] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    Ok(out)
}

/// The bytes of a FRAME's tensor: `tensor_bytes`, plus the rule that a frame has a size. A tensor
/// with a `[0, 0]` picture is the two sides of a native boundary disagreeing, not a frame to pass on
/// unplaceable (audit, 2026-09-19).
pub fn frame_bytes(
    count: i32,
    rows: i32,
    anchors: i32,
    picture: [i32; 2],
    frame_id: Option<i32>,
    data: &[f32],
) -> Result<Vec<u8>, String> {
    let [width, height] = picture;
    if width <= 0 || height <= 0 {
        return Err(format!(
            "next_detection produced a tensor but reported its picture as {width}x{height}"
        ));
    }
    tensor_bytes(count, rows, anchors, picture, frame_id, data)
}

/// The idle answer — camera open, no frame yet: the header alone, zero anchors, no picture. The
/// page reads it as "try again next tick". Always version 2: there is no frame, so there is no
/// frame to identify.
pub fn no_frame() -> Vec<u8> {
    tensor_bytes(0, 0, 0, [0, 0], None, &[])
        .expect("the idle answer is well-formed by construction")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(bytes: &[u8], i: usize) -> i32 {
        i32::from_le_bytes(bytes[i * 4..i * 4 + 4].try_into().unwrap())
    }

    /// Wire version 2, byte for byte: the page's `decodeTensorResponse` reads exactly this, and a
    /// header that moved would place every sticker of the scan screen's view in the wrong picture.
    #[test]
    fn a_tensor_response_is_version_2_with_the_picture_size() {
        let bytes = tensor_bytes(2, 1, 2, [1280, 720], None, &[1.5, -2.0, 9.0]).unwrap();
        assert_eq!(
            [
                word(&bytes, 0),
                word(&bytes, 1),
                word(&bytes, 2),
                word(&bytes, 3),
                word(&bytes, 4)
            ],
            [-2, 1, 2, 1280, 720]
        );
        let f = |i: usize| f32::from_le_bytes(bytes[20 + i * 4..24 + i * 4].try_into().unwrap());
        assert_eq!([f(0), f(1)], [1.5, -2.0], "only `count` floats cross");
        assert_eq!(bytes.len(), HEADER_BYTES + 2 * 4);
        let none = no_frame();
        assert_eq!(none.len(), HEADER_BYTES);
        assert_eq!(word(&none, 2), 0, "no frame yet is zero anchors");
    }

    /// Wire version 3, byte for byte (D2): the same header with the frame's identity after the
    /// height, and the floats pushed four bytes later. `decodeTensorResponse` reads exactly this,
    /// and a header that moved would read the first float as the id and the tensor off by one word.
    #[test]
    fn a_tensor_response_with_a_frame_id_is_version_3() {
        let bytes = tensor_bytes(2, 1, 2, [1280, 720], Some(77), &[1.5, -2.0, 9.0]).unwrap();
        assert_eq!(
            [
                word(&bytes, 0),
                word(&bytes, 1),
                word(&bytes, 2),
                word(&bytes, 3),
                word(&bytes, 4),
                word(&bytes, 5)
            ],
            [-3, 1, 2, 1280, 720, 77]
        );
        let f = |i: usize| {
            f32::from_le_bytes(
                bytes[HEADER_BYTES_FRAME_ID + i * 4..HEADER_BYTES_FRAME_ID + 4 + i * 4]
                    .try_into()
                    .unwrap(),
            )
        };
        assert_eq!([f(0), f(1)], [1.5, -2.0], "the floats follow the longer header");
        assert_eq!(bytes.len(), HEADER_BYTES_FRAME_ID + 2 * 4);
    }

    /// An identity is compared for CHANGE and never ordered, so every i32 is a legal one — a
    /// counter that wrapped past i32::MAX still answers "is this the same frame?" correctly, and
    /// refusing it would turn a long scan into a bridge error.
    #[test]
    fn any_i32_is_a_legal_frame_id() {
        for id in [i32::MIN, -1, 0, 1, i32::MAX] {
            let bytes = tensor_bytes(1, 1, 1, [4, 3], Some(id), &[0.5]).unwrap();
            assert_eq!(word(&bytes, 5), id, "{id} did not survive the wire");
        }
    }

    /// The idle answer never carries an id, and an arm that tries to attach one to "no frame yet"
    /// is refused rather than shipping an identity for a frame nobody delivered — the page's reader
    /// admits a version 3 header whose counts are zero, so this side is where it has to be caught.
    #[test]
    fn the_idle_answer_cannot_carry_a_frame_id() {
        let e = tensor_bytes(0, 0, 0, [0, 0], Some(5), &[]).unwrap_err();
        assert!(e.contains("no frame to identify"), "{e}");
        assert_eq!(no_frame().len(), HEADER_BYTES, "the idle answer is version 2");
    }

    /// Every contract violation the audit named is refused with the value in the message, never
    /// clamped into a tensor that fails later (2026-09-21, audit-fix row 95).
    #[test]
    fn a_native_answer_that_breaks_the_contract_is_refused_not_clamped() {
        let data = [0.5f32, 0.25, 0.125];
        let refused = |count, rows, anchors, picture: [i32; 2]| {
            tensor_bytes(count, rows, anchors, picture, None, &data)
                .expect_err("should have been refused")
        };
        assert!(refused(-1, 1, 3, [4, 3]).contains("-1"), "a negative count");
        assert!(
            refused(4, 1, 4, [4, 3]).contains("buffer of 3"),
            "a count past the buffer"
        );
        assert!(
            refused(3, -1, 3, [4, 3]).contains("-1 rows"),
            "negative rows"
        );
        assert!(
            refused(3, 1, -3, [4, 3]).contains("-3 anchors"),
            "negative anchors"
        );
        assert!(
            refused(3, 2, 2, [4, 3]).contains("2x2 tensor (4 elements) but wrote 3"),
            "a shape whose product is not the count"
        );
        assert!(
            refused(3, 1, 3, [-4, 3]).contains("-4x3"),
            "a negative picture side"
        );
        assert!(
            refused(3, 1, 3, [4, 0]).contains("half a size"),
            "a picture with one zero side"
        );
        assert!(
            tensor_bytes(0, i32::MAX, i32::MAX, [0, 0], None, &[])
                .unwrap_err()
                .contains("overflows")
                || tensor_bytes(0, i32::MAX, i32::MAX, [0, 0], None, &[])
                    .unwrap_err()
                    .contains("but wrote 0"),
            "a product past the count is refused either way"
        );
        // And the well-formed answers still pass: a frame, and the idle header.
        assert!(tensor_bytes(3, 1, 3, [4, 3], None, &data).is_ok());
        assert!(tensor_bytes(0, 0, 0, [0, 0], None, &[]).is_ok());
    }

    /// A frame's picture must have a size; the idle `[0, 0]` is `tensor_bytes`'s to allow and
    /// `frame_bytes`'s to refuse.
    #[test]
    fn a_frame_carries_its_picture_and_one_without_is_refused() {
        let bytes = frame_bytes(3, 1, 3, [721, 479], None, &[0.5, 0.25, 0.125]).unwrap();
        assert_eq!(
            [
                word(&bytes, 0),
                word(&bytes, 1),
                word(&bytes, 2),
                word(&bytes, 3),
                word(&bytes, 4)
            ],
            [-2, 1, 3, 721, 479]
        );
        for bad in [[0, 479], [721, 0], [-721, 479], [0, 0]] {
            let e = frame_bytes(3, 1, 3, bad, None, &[0.5, 0.25, 0.125]).unwrap_err();
            assert!(
                e.contains("reported its picture") || e.contains("-721"),
                "{bad:?}: {e}"
            );
        }
    }
}
