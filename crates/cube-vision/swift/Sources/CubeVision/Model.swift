// The CoreML runner. Loads the NMS-free .mlpackage exported by ml/export.py (raw 1×(4+nc)×8400
// output, float tensor in / fp16 out), compiles it, and runs one frame to the raw output tensor.
// `compileModel(at:)` writes a fresh .mlmodelc into a temporary directory on EVERY call — it does
// not cache, whatever this comment used to say — so the one place a repeat load is made free is
// FFI.swift's `cube_vision_load`, which keeps the built model and answers a same-path, same-units
// load from it. The tensor is copied out row-major as Float32 — the exact
// `{ data, anchors }` layout `decodeDetections` parses, so the post-processing is byte-for-byte the
// browser's. NMS, grid-fit and assembly stay in TypeScript; nothing here interprets the numbers.

import CoreML
import Foundation

public struct Inference {
    public let data: [Float]   // row-major (4+numClasses) × anchors
    public let rows: Int
    public let anchors: Int
}

public final class CubeModel {
    private let model: MLModel
    private let inputName: String
    private let outputName: String

    public init(mlpackageURL: URL, computeUnits: MLComputeUnits = .all) throws {
        // .mlpackage must be compiled to .mlmodelc before load: seconds, and paid per call of this
        // initialiser (the plan's "Known costs" row). Not repeating it is the caller's job.
        let compiled = try MLModel.compileModel(at: mlpackageURL)
        let cfg = MLModelConfiguration()
        cfg.computeUnits = computeUnits
        self.model = try MLModel(contentsOf: compiled, configuration: cfg)
        let desc = model.modelDescription
        guard let inName = desc.inputDescriptionsByName.keys.first else {
            throw CubeVisionError.badModel("model has no input")
        }
        guard let outName = desc.outputDescriptionsByName.keys.first else {
            throw CubeVisionError.badModel("model has no output")
        }
        self.inputName = inName
        self.outputName = outName
    }

    /// Run one letterboxed CHW Float32 tensor (length 3*imgsz*imgsz) → raw detect output.
    public func infer(chw: [Float], imgsz: Int = Letterbox.imgSize) throws -> Inference {
        let input = try MLMultiArray(shape: [1, 3, NSNumber(value: imgsz), NSNumber(value: imgsz)], dataType: .float32)
        let ptr = input.dataPointer.bindMemory(to: Float.self, capacity: chw.count)
        chw.withUnsafeBufferPointer { ptr.update(from: $0.baseAddress!, count: chw.count) }
        let provider = try MLDictionaryFeatureProvider(dictionary: [inputName: MLFeatureValue(multiArray: input)])
        let out = try model.prediction(from: provider)
        guard let arr = out.featureValue(for: outputName)?.multiArrayValue else {
            throw CubeVisionError.badModel("prediction produced no '\(outputName)'")
        }
        // Output shape is [1, 4+nc, anchors]; drop the leading batch of 1.
        let dims = arr.shape.map { $0.intValue }
        guard dims.count >= 2 else { throw CubeVisionError.badModel("output rank < 2") }
        let anchors = dims[dims.count - 1]
        let rows = dims[dims.count - 2]
        let count = rows * anchors
        var data = [Float](repeating: 0, count: count)
        // Copy honouring strides — an MLMultiArray is not guaranteed dense — into dense row-major.
        // Bind the raw pointer to exactly ONE element type, the model's own: binding one allocation
        // to two types (UInt16 and Float) is undefined behaviour even when the unused branch never
        // runs. The exported model's output is fp16, but fp32 is handled for robustness.
        let strides = arr.strides.map { $0.intValue }
        let rStride = strides[strides.count - 2]
        let aStride = strides[strides.count - 1]
        if arr.dataType == .float16 {
            // Read the halves as raw UInt16 and widen in `float32(fromFloat16:)`, rather than
            // binding to Swift's `Float16`.
            //
            // `Float16` is arm64-only on macOS, and the universal binary the release workflow asks
            // for builds BOTH halves — so this file compiled on Apple Silicon and failed the
            // x86_64 half with "'Float16' is unavailable in macOS", taking the whole macOS leg down
            // with it. It was the only red leg of five, and it had never been run.
            //
            // The widening is exact for every one of the 65,536 half patterns — fp32 has strictly
            // more exponent range and mantissa bits — so this cannot change a single number the
            // model produces on arm64, and the golden-frame native leg is what proves it did not.
            let base = arr.dataPointer.bindMemory(to: UInt16.self, capacity: arr.count)
            for r in 0..<rows {
                for a in 0..<anchors {
                    data[r * anchors + a] = float32(fromFloat16: base[r * rStride + a * aStride])
                }
            }
        } else {
            let base = arr.dataPointer.bindMemory(to: Float.self, capacity: arr.count)
            for r in 0..<rows {
                for a in 0..<anchors {
                    data[r * anchors + a] = base[r * rStride + a * aStride]
                }
            }
        }
        return Inference(data: data, rows: rows, anchors: anchors)
    }
}

/// Widen an IEEE-754 binary16 bit pattern to `Float`, on any architecture.
///
/// Exact by construction, for every input including subnormals, infinities and NaN payloads: binary32
/// has both a wider exponent range and more mantissa bits, so no binary16 value needs rounding.
/// `CubeVisionTests`-free by design — the exhaustive check against `Float16` lives in the probe's
/// `--self-check`, which can run it on arm64 where both implementations exist.
@inline(__always)
public func float32(fromFloat16 h: UInt16) -> Float {
    let sign = UInt32(h & 0x8000) << 16
    let exp = UInt32((h >> 10) & 0x1F)
    let mant = UInt32(h & 0x03FF)
    if exp == 0 {
        // Zero, or a subnormal whose value is exactly mant x 2^-24.
        if mant == 0 { return Float(bitPattern: sign) }
        let magnitude = Float(mant) * 0x1p-24
        return Float(bitPattern: sign | magnitude.bitPattern)
    }
    if exp == 0x1F {
        if mant == 0 { return Float(bitPattern: sign | 0x7F80_0000) }  // infinity
        // NaN: payload carried across rather than flattened, and QUIETED — bit 22 forced on.
        //
        // Quieting is what IEEE-754 requires of a format conversion, and it is what Swift's own
        // `Float(Float16)` does. Widening a signalling NaN without it left 1022 of the 65,536
        // patterns disagreeing, every one of them an sNaN. Found by the exhaustive `--self-check`
        // below, not by reading: the corners of a hand-written float conversion are precisely
        // where reading it again does not help.
        return Float(bitPattern: sign | 0x7F80_0000 | (mant << 13) | 0x0040_0000)
    }
    // Normal: rebias the exponent (127 - 15 = 112) and left-align the mantissa.
    return Float(bitPattern: sign | ((exp + 112) << 23) | (mant << 13))
}


public enum CubeVisionError: Error, CustomStringConvertible {
    case badModel(String)
    case badImage(String)
    case capture(String)

    public var description: String {
        switch self {
        case .badModel(let m): return "model: \(m)"
        case .badImage(let m): return "image: \(m)"
        case .capture(let m): return "capture: \(m)"
        }
    }
}
