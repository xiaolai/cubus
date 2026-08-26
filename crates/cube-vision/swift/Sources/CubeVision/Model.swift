// The CoreML runner. Loads the NMS-free .mlpackage exported by ml/export.py (raw 1×(4+nc)×8400
// output, float tensor in / fp16 out), compiles it on first use (CoreML caches the .mlmodelc), and
// runs one frame to the raw output tensor. The tensor is copied out row-major as Float32 — the exact
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
        // .mlpackage must be compiled to .mlmodelc before load; CoreML caches the result so this is
        // a one-time cost (seconds) that the plan calls out under "Known costs".
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
        // to two types (Float16 and Float) is undefined behaviour even when the unused branch never
        // runs. The exported model's output is fp16, but fp32 is handled for robustness.
        let strides = arr.strides.map { $0.intValue }
        let rStride = strides[strides.count - 2]
        let aStride = strides[strides.count - 1]
        if arr.dataType == .float16 {
            let base = arr.dataPointer.bindMemory(to: Float16.self, capacity: arr.count)
            for r in 0..<rows {
                for a in 0..<anchors {
                    data[r * anchors + a] = Float(base[r * rStride + a * aStride])
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
