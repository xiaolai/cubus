// The letterbox, byte-for-byte identical to `preprocess()` in
// packages/cube-scanner/src/onnx-detect.ts and to `letterbox()` in ml/cube_infer.py.
//
// This is the load-bearing parity claim of the whole native path: the model only reads the same
// stickers as the browser build if the 3×640×640 float tensor it is fed is the SAME bytes. So this
// does the identical IEEE-754 double arithmetic in the identical order and narrows to Float32 at the
// identical point — bilinear resample, grey-114 pad, `(i+0.5)/scale − 0.5` source mapping, clamped.
// Anything that "looks equivalent" (vImage, CoreImage, Accelerate's vImageScale) is NOT, and would
// shift detections; the golden-frame harness pins the SHA-256 of this output against the other two
// implementations so a drift fails a test rather than a scan.

import Foundation

public enum Letterbox {
    public static let imgSize = 640
    // 114/255 in double, then stored as Float — exactly `new Float32Array().fill(114 / 255)`.
    public static let pad = Float(114.0 / 255.0)

    /// `rgba` is row-major width*height*4 bytes (R,G,B,A; alpha ignored). Returns CHW Float32,
    /// length 3*imgsz*imgsz, channel-major (all R, then all G, then all B), matching the ONNX input.
    public static func chw(rgba: UnsafePointer<UInt8>, width w: Int, height h: Int, imgsz: Int = imgSize) -> [Float] {
        // A zero dimension computes `h - 1` below and reads before the buffer. The Rust side proves
        // both positive before any pointer exists (crates/cube-vision/src/frame.rs); this is the
        // belt for a caller that did not, and it stops here — loudly — rather than in a read.
        precondition(w > 0 && h > 0, "Letterbox.chw needs positive dimensions, got \(w)x\(h)")
        let scale = Double(imgsz) / Double(max(w, h))
        let newW = max(1, Int((Double(w) * scale + 0.5).rounded(.down)))   // JS Math.round: floor(x+0.5)
        let newH = max(1, Int((Double(h) * scale + 0.5).rounded(.down)))
        let padX = (imgsz - newW) / 2
        let padY = (imgsz - newH) / 2
        let plane = imgsz * imgsz
        var out = [Float](repeating: pad, count: 3 * plane)

        out.withUnsafeMutableBufferPointer { o in
            for y in 0..<newH {
                let sy = min(Double(h - 1), max(0.0, (Double(y) + 0.5) / scale - 0.5))
                let y0 = Int(sy.rounded(.down))
                let y1 = min(h - 1, y0 + 1)
                let fy = sy - Double(y0)
                let oy = y + padY
                for x in 0..<newW {
                    let sx = min(Double(w - 1), max(0.0, (Double(x) + 0.5) / scale - 0.5))
                    let x0 = Int(sx.rounded(.down))
                    let x1 = min(w - 1, x0 + 1)
                    let fx = sx - Double(x0)
                    let ox = x + padX
                    let o00 = (y0 * w + x0) * 4
                    let o01 = (y0 * w + x1) * 4
                    let o10 = (y1 * w + x0) * 4
                    let o11 = (y1 * w + x1) * 4
                    let dst = oy * imgsz + ox
                    for ch in 0..<3 {
                        let p00 = Double(rgba[o00 + ch])
                        let p01 = Double(rgba[o01 + ch])
                        let p10 = Double(rgba[o10 + ch])
                        let p11 = Double(rgba[o11 + ch])
                        let top = p00 + (p01 - p00) * fx
                        let bot = p10 + (p11 - p10) * fx
                        o[ch * plane + dst] = Float((top + (bot - top) * fy) / 255.0)
                    }
                }
            }
        }
        return out
    }
}
