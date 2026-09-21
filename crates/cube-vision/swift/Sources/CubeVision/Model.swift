// The CoreML runner. Loads the NMS-free .mlpackage exported by ml/export.py (raw 1×(4+nc)×8400
// output, float tensor in / fp16 out), compiles it ONCE per source into a cache it reuses, and runs
// one frame to the raw output tensor. `compileModel(at:)` writes a fresh .mlmodelc into the temporary
// directory on every call and removes none of them — 213 of them, 2.8 GB, were found in the dev Mac's
// temporary directory on 2026-09-20 — so `compiledModel(for:)` moves the one it makes into
// <Caches>/im.cubus.cube-vision/compiled/, keyed on the source, and a later load of the same source
// finds it there and compiles nothing. FFI.swift's `cube_vision_load` still keeps the BUILT model and
// answers a same-path, same-units load from it, because even a cached load is a CoreML load. The
// tensor is copied out row-major as Float32 — the exact `{ data, anchors }` layout `decodeDetections`
// parses, so the post-processing is byte-for-byte the browser's. NMS, grid-fit and assembly stay in
// TypeScript; nothing here interprets the numbers.

import CommonCrypto
import CoreML
import Foundation

public struct Inference {
    public let data: [Float]   // row-major (4+numClasses) × anchors
    public let rows: Int
    public let anchors: Int
}

/// What the per-tick and still entries ask of a model: one letterboxed frame in, the raw tensor out.
/// `CubeModel` is the one that ships; the protocol exists so a test can stand in a model that FAILS —
/// the one path of those entries the committed model cannot be made to take (Tests/CubeVisionTests).
protocol FrameInferring: AnyObject {
    func infer(chw: [Float], imgsz: Int) throws -> Inference
}

extension CubeModel: FrameInferring {}

public final class CubeModel {
    private let model: MLModel
    private let inputName: String
    private let outputName: String
    /// The compiled model this instance runs, and whether THIS initialiser compiled it (false: the
    /// cache held it). Instruments for the tests (Tests/CubeVisionTests/ModelTests.swift), which
    /// import the module `@testable`; nothing on the hot path reads them, and nothing outside does.
    let compiledURL: URL
    let compiledNow: Bool

    public convenience init(mlpackageURL: URL, computeUnits: MLComputeUnits = .all) throws {
        try self.init(mlpackageURL: mlpackageURL, computeUnits: computeUnits, cache: nil)
    }

    /// `cache` is the tests' way of pointing the compiled-model cache at a directory of their own;
    /// the app always uses `compiledCacheDirectory()`.
    init(mlpackageURL: URL, computeUnits: MLComputeUnits, cache: URL?) throws {
        let cfg = MLModelConfiguration()
        cfg.computeUnits = computeUnits
        // .mlpackage must be compiled to .mlmodelc before load: seconds, paid once per source and
        // then found in the cache (the plan's "Known costs" row). Not repeating the LOAD is still the
        // caller's job. The load happens INSIDE `compiledModel`, under the cache's lock, so no other
        // process can sweep the entry between finding it and loading it.
        let loaded = try CubeModel.compiledModel(for: mlpackageURL, in: cache) { compiled in
            try MLModel(contentsOf: compiled, configuration: cfg)
        }
        self.model = loaded.loaded
        self.compiledURL = loaded.url
        self.compiledNow = loaded.compiledNow
        let desc = model.modelDescription
        self.inputName = try CubeModel.singleFeature(Array(desc.inputDescriptionsByName.keys), role: "input")
        self.outputName = try CubeModel.singleFeature(Array(desc.outputDescriptionsByName.keys), role: "output")
    }

    /// The one feature of its role, by name. The exported model has exactly one input and one
    /// output; a model with more is not the one this runner was written for, and picking
    /// `keys.first` from a dictionary would feed or read whichever the hash order put first
    /// (audit finding 108, 2026-09-21).
    static func singleFeature(_ names: [String], role: String) throws -> String {
        guard names.count == 1, let name = names.first else {
            throw CubeVisionError.badModel(
                "the model has \(names.count) \(role) features, not one: [\(names.sorted().joined(separator: ", "))]")
        }
        return name
    }

    /// Where compiled models live: `<Caches>/im.cubus.cube-vision/compiled/`. Caches rather than
    /// Application Support because a compiled model is derived from a source that is still there —
    /// the OS may purge it under pressure, and the next load compiles again. Created on demand; a
    /// directory that cannot be made is an error, not a quiet return to the temporary directory this
    /// replaced (2026-09-20).
    static func compiledCacheDirectory() throws -> URL {
        guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
            throw CubeVisionError.badModel("no caches directory to keep the compiled model in")
        }
        let dir = caches.appendingPathComponent("im.cubus.cube-vision/compiled", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        } catch {
            throw CubeVisionError.badModel("cannot create \(dir.path) for the compiled model: \(error.localizedDescription)")
        }
        return dir
    }

    /// The name a source's compiled form is cached under, and the prefix every entry for that
    /// source shares. The prefix is the source's file name plus a hash of its PATH, so two checkouts
    /// each holding a `cubedet.mlpackage` keep their own entry rather than evicting each other's;
    /// the rest is a hash of what is IN the source — every regular file's relative path and its
    /// BYTES, streamed (`digestContents`) — and the OS version, so a re-exported model, or an OS
    /// whose CoreML writes compiled models differently, compiles afresh and the old entry is swept
    /// as stale. The bytes, not the size and modification date they stood in for until 2026-09-21:
    /// a re-export that kept both (a `git checkout` sets neither to anything a hash could rely on)
    /// answered from the wrong compiled model (audit finding 47).
    struct CacheKey {
        let prefix: String
        let name: String

        init(for source: URL) throws {
            let path = source.standardizedFileURL.path
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory) else {
                throw CubeVisionError.badModel("no model at \(path)")
            }
            let stem = source.deletingPathExtension().lastPathComponent
            prefix = "\(stem)-\(Sha256.hex(of: path).prefix(8))"
            let contents = try CacheKey.digestContents(at: path, isDirectory: isDirectory.boolValue)
            name = "\(prefix)-\(contents.prefix(16)).mlmodelc"
        }

        /// SHA-256, as hex, over every regular file under `path` in relative-path order — each as
        /// its relative path, its size and then exactly that many bytes, with boundaries no path or
        /// byte can forge (`Sha256.update(file:named:)`) — and the OS version. A file that cannot
        /// be opened or read whole is an error: a key that skipped it would name a model it did not
        /// look at.
        static func digestContents(at path: String, isDirectory: Bool) throws -> String {
            var digest = Sha256()
            let root = URL(fileURLWithPath: path)
            for relative in try regularFiles(at: path, isDirectory: isDirectory) {
                let file = isDirectory ? root.appendingPathComponent(relative) : root
                try digest.update(file: file, named: relative)
            }
            let os = ProcessInfo.processInfo.operatingSystemVersion
            digest.update("\nos \(os.majorVersion).\(os.minorVersion).\(os.patchVersion)")
            return digest.finish()
        }

        /// The relative paths of the regular files under `path`, sorted; `[""]` for a single file.
        static func regularFiles(at path: String, isDirectory: Bool) throws -> [String] {
            guard isDirectory else { return [""] }
            let fm = FileManager.default
            // A subtree the walk cannot enter is an ERROR, not a gap (2026-09-21, verification of the
            // audit fix): without a handler the enumerator skips what it cannot read and the key
            // digests the rest — a model missing a directory would then key the same as the whole.
            var refused: (url: URL, error: Error)?
            guard let walk = fm.enumerator(
                at: URL(fileURLWithPath: path), includingPropertiesForKeys: [.isRegularFileKey], options: [],
                errorHandler: { url, error in
                    refused = (url, error)
                    return false
                })
            else {
                throw CubeVisionError.badModel("cannot list \(path)")
            }
            var files: [String] = []
            for case let file as URL in walk {
                guard try file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else { continue }
                files.append(String(file.standardizedFileURL.path.dropFirst(path.count)))
            }
            if let refused {
                throw CubeVisionError.badModel(
                    "cannot list \(refused.url.path) inside \(path): \(refused.error.localizedDescription)")
            }
            return files.sorted()
        }
    }

    /// The compiled form of `source`, loaded by `load`: the cache's entry when it holds one for
    /// this exact source, else a fresh compile moved into the cache. `compiledNow` says which.
    /// `cache` is the tests' way of pointing this at a directory of their own; the app always uses
    /// `compiledCacheDirectory()`.
    ///
    /// Everything from the lookup to the sweep — the compile, the install, the LOAD — runs under
    /// one lock on the cache directory, held across processes (`withCacheLock`, 2026-09-21). The
    /// cache is shared by the app, the probe and every Rust test on the machine, and a process
    /// loading the entry it was handed used to be exposed to another process sweeping it as stale
    /// for the source version IT had (audit finding 48); with the load inside the lock, an entry is
    /// swept only by a process that holds the lock, which nobody in that window can. A cached entry
    /// `load` refuses — half-written by a process killed mid-move, or from an OS that wrote the
    /// format differently — is removed and made again, once; a removal that fails is an error
    /// naming both failures, never the same entry handed back (audit finding 107). A fresh compile
    /// that fails to load is the model's own fault, and that one throws as it is.
    static func compiledModel<Loaded>(for source: URL, in cache: URL? = nil,
                                      load: (URL) throws -> Loaded) throws -> (loaded: Loaded, url: URL, compiledNow: Bool) {
        let fm = FileManager.default
        let key = try CacheKey(for: source)
        let dir = try cache ?? compiledCacheDirectory()
        return try withCacheLock(in: dir) {
            let dest = dir.appendingPathComponent(key.name, isDirectory: true)
            defer { sweep(in: dir, prefix: key.prefix, keeping: key.name) }
            if fm.fileExists(atPath: dest.path) {
                do {
                    return (try load(dest), dest, false)
                } catch {
                    do {
                        try fm.removeItem(at: dest)
                    } catch let removal {
                        throw CubeVisionError.badModel(
                            "the cached model \(dest.path) cannot be loaded (\(error.localizedDescription)) "
                                + "and cannot be removed to make it again: \(removal.localizedDescription)")
                    }
                }
            }
            try install(try MLModel.compileModel(at: source), at: dest, in: dir)
            return (try load(dest), dest, true)
        }
    }

    /// The cache directory's lock file. Taken with `flock`, which the kernel releases with the
    /// descriptor — a process that dies holding it holds nothing — and which two descriptors in
    /// one process contend for too, so `swift test` can hold it from the test and watch a load wait.
    static let lockName = ".lock"

    private static func withCacheLock<T>(in dir: URL, _ body: () throws -> T) throws -> T {
        let path = dir.appendingPathComponent(lockName).path
        let fd = open(path, O_RDWR | O_CREAT | O_CLOEXEC, 0o644)
        guard fd >= 0 else {
            throw CubeVisionError.badModel("cannot open the cache lock \(path): \(String(cString: strerror(errno)))")
        }
        defer { close(fd) }
        guard flock(fd, LOCK_EX) == 0 else {
            throw CubeVisionError.badModel("cannot take the cache lock \(path): \(String(cString: strerror(errno)))")
        }
        defer { flock(fd, LOCK_UN) }
        return try body()
    }

    /// Two moves to land in the cache: INTO the cache directory under a name nobody else uses (a
    /// copy, when the temporary directory is on another volume), then a rename to the final name,
    /// which is one atomic step on one volume — so no reader ever sees a half-moved entry, and a
    /// process killed between the two leaves a staging directory, never a broken model.
    private static func install(_ fresh: URL, at dest: URL, in dir: URL) throws {
        let fm = FileManager.default
        let staging = dir.appendingPathComponent("\(stagingPrefix)\(UUID().uuidString)", isDirectory: true)
        do {
            try fm.moveItem(at: fresh, to: staging)
            try fm.moveItem(at: staging, to: dest)
        } catch {
            try? fm.removeItem(at: staging)
            try? fm.removeItem(at: fresh)
            // A process from before the lock existed compiled the same source meanwhile and won
            // the rename: its entry is the same bytes as ours would have been.
            if fm.fileExists(atPath: dest.path) { return }
            throw error
        }
    }

    /// What a compile is staged under while it is moved into the cache.
    static let stagingPrefix = ".staging-"

    /// How old a staging directory must be to count as abandoned: a compile is seconds and its two
    /// moves are less, so ten minutes is not a compile in flight. Age rather than "not ours", so a
    /// process from before the lock existed, staging without it, is not swept mid-move.
    static let stagingAbandonedAfter: TimeInterval = 10 * 60

    /// Every entry for the same source that is not the current one — a re-exported model's, an
    /// earlier OS version's — goes, and so does every staging directory a killed process left
    /// behind (audit finding 110, 2026-09-21). Under the lock, after the load. Best effort: a sweep
    /// that fails leaves a stale directory, which is what there was before, and never a failed load.
    private static func sweep(in dir: URL, prefix: String, keeping name: String) {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(atPath: dir.path) else { return }
        for entry in entries {
            let url = dir.appendingPathComponent(entry)
            if entry != name && entry.hasPrefix("\(prefix)-") {
                try? fm.removeItem(at: url)
            } else if entry.hasPrefix(stagingPrefix), isAbandoned(url) {
                try? fm.removeItem(at: url)
            }
        }
    }

    private static func isAbandoned(_ staging: URL) -> Bool {
        guard let modified = (try? staging.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate else {
            return false
        }
        return Date().timeIntervalSince(modified) > stagingAbandonedAfter
    }

    /// The element count of a CHW input for `imgsz` — `3 * imgsz * imgsz`, refused when that does
    /// not fit an `Int` or `imgsz` is not positive.
    static func inputCount(imgsz: Int) throws -> Int {
        guard imgsz > 0 else { throw CubeVisionError.badImage("the input size must be positive, not \(imgsz)") }
        let (plane, planeOverflow) = imgsz.multipliedReportingOverflow(by: imgsz)
        let (count, countOverflow) = plane.multipliedReportingOverflow(by: 3)
        guard !planeOverflow, !countOverflow else {
            throw CubeVisionError.badImage("an input of 3×\(imgsz)×\(imgsz) has more elements than this machine can count")
        }
        return count
    }

    /// Run one letterboxed CHW Float32 tensor (length 3*imgsz*imgsz) → raw detect output. A tensor
    /// of any other length is refused before a pointer is formed: one too long wrote past the
    /// array CoreML allocated, an empty one unwrapped a nil base address (audit finding 49).
    public func infer(chw: [Float], imgsz: Int = Letterbox.imgSize) throws -> Inference {
        let expected = try CubeModel.inputCount(imgsz: imgsz)
        guard chw.count == expected else {
            throw CubeVisionError.badImage("the input tensor is \(chw.count) floats, not 3×\(imgsz)×\(imgsz) = \(expected)")
        }
        let input = try MLMultiArray(shape: [1, 3, NSNumber(value: imgsz), NSNumber(value: imgsz)], dataType: .float32)
        let ptr = input.dataPointer.bindMemory(to: Float.self, capacity: expected)
        chw.withUnsafeBufferPointer { ptr.update(from: $0.baseAddress!, count: expected) }
        let provider = try MLDictionaryFeatureProvider(dictionary: [inputName: MLFeatureValue(multiArray: input)])
        let out = try model.prediction(from: provider)
        guard let arr = out.featureValue(for: outputName)?.multiArrayValue else {
            throw CubeVisionError.badModel("prediction produced no '\(outputName)'")
        }
        return try CubeModel.readOutput(arr)
    }

    /// Where an output tensor's elements are: its two dimensions, the stride of each, and how far
    /// past the base pointer the last element lies — the extent a pointer must be bound over.
    struct OutputLayout: Equatable {
        let rows: Int
        let anchors: Int
        let rowStride: Int
        let anchorStride: Int
        let extent: Int
    }

    /// The layout of an output of `shape` and `strides`, or the reason it is not the model's:
    /// exactly `[1, rows, anchors]` with both positive and a stride for each dimension. Any rank of
    /// two or more used to be read from its last two dimensions, so a `[2, rows, anchors]` came out
    /// as one batch of plausible numbers (audit finding 50). Overflow-checked, so a shape that
    /// cannot be counted is refused rather than wrapped.
    static func outputLayout(shape: [Int], strides: [Int]) throws -> OutputLayout {
        guard shape.count == 3, shape[0] == 1 else {
            throw CubeVisionError.badModel("the output tensor's shape is \(shape), not [1, rows, anchors]")
        }
        let (rows, anchors) = (shape[1], shape[2])
        guard rows > 0, anchors > 0 else {
            throw CubeVisionError.badModel("the output tensor's shape is \(shape); rows and anchors must be positive")
        }
        guard strides.count == 3, strides[1] > 0, strides[2] > 0 else {
            throw CubeVisionError.badModel("the output tensor's strides are \(strides), not one positive stride per dimension")
        }
        let (rowSpan, rowOverflow) = (rows - 1).multipliedReportingOverflow(by: strides[1])
        let (anchorSpan, anchorOverflow) = (anchors - 1).multipliedReportingOverflow(by: strides[2])
        let (span, spanOverflow) = rowSpan.addingReportingOverflow(anchorSpan)
        let (_, countOverflow) = rows.multipliedReportingOverflow(by: anchors)
        guard !rowOverflow, !anchorOverflow, !spanOverflow, !countOverflow, span < Int.max else {
            throw CubeVisionError.badModel("an output of \(shape) with strides \(strides) has more elements than this machine can count")
        }
        // The extent the strides actually reach, not `arr.count`: with a gap between elements the
        // last one read lies past the count (2026-09-20, found by the stride case in ModelTests.swift).
        return OutputLayout(rows: rows, anchors: anchors, rowStride: strides[1], anchorStride: strides[2], extent: span + 1)
    }

    /// The raw output tensor, dense and row-major as Float32, from whatever layout CoreML handed
    /// back. Output shape is [1, 4+nc, anchors]; the leading batch of 1 is dropped. A function of
    /// the array alone, so `swift test` can hand it arrays of every type and stride without a model
    /// (Tests/CubeVisionTests/ModelTests.swift).
    static func readOutput(_ arr: MLMultiArray) throws -> Inference {
        let layout = try outputLayout(shape: arr.shape.map { $0.intValue }, strides: arr.strides.map { $0.intValue })
        // Copy honouring strides — an MLMultiArray is not guaranteed dense — into dense row-major.
        // Bind the raw pointer to exactly ONE element type, the model's own: binding one allocation
        // to two types (UInt16 and Float) is undefined behaviour even when the unused branch never
        // runs. The exported model's output is fp16; fp32 is read too; anything else is refused by
        // name (2026-09-20, audit §2.14) — until then every other type was read AS Float32, so a
        // model exported with a double or int32 head would have produced numbers, not an error.
        let data: [Float]
        switch arr.dataType {
        case .float16:
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
            data = denseCopy(arr.dataPointer.bindMemory(to: UInt16.self, capacity: layout.extent), layout, float32(fromFloat16:))
        case .float32:
            data = denseCopy(arr.dataPointer.bindMemory(to: Float.self, capacity: layout.extent), layout) { $0 }
        default:
            throw CubeVisionError.badModel("the output tensor is \(describe(arr.dataType)), not float16 or float32")
        }
        return Inference(data: data, rows: layout.rows, anchors: layout.anchors)
    }

    /// The elements at `layout`'s strides, converted by `convert`, as one dense row-major array.
    /// One loop for both element types (audit finding 51): the type decides only how an element
    /// becomes a Float.
    @inline(__always)
    private static func denseCopy<Element>(_ base: UnsafePointer<Element>, _ layout: OutputLayout, _ convert: (Element) -> Float) -> [Float] {
        var data = [Float](repeating: 0, count: layout.rows * layout.anchors)
        for r in 0..<layout.rows {
            for a in 0..<layout.anchors {
                data[r * layout.anchors + a] = convert(base[r * layout.rowStride + a * layout.anchorStride])
            }
        }
        return data
    }
}

/// An `MLMultiArrayDataType` by name, for an error a person reads. The enum has no description of
/// its own, and a raw value (`65600`) says nothing; a case newer than these four (the SDK keeps
/// adding them) is named by its raw value, which is still a fact.
private func describe(_ type: MLMultiArrayDataType) -> String {
    switch type {
    case .double: return "double"
    case .float32: return "float32"
    case .float16: return "float16"
    case .int32: return "int32"
    default: return "MLMultiArrayDataType(\(type.rawValue))"
    }
}

/// A streaming SHA-256. CommonCrypto rather than CryptoKit on purpose: it lives in libSystem, so
/// the static library links into the Rust plugin with no framework the build script would have to
/// name.
struct Sha256 {
    private var context = CC_SHA256_CTX()

    init() {
        CC_SHA256_Init(&context)
    }

    mutating func update(_ bytes: UnsafeRawBufferPointer) {
        CC_SHA256_Update(&context, bytes.baseAddress, CC_LONG(bytes.count))
    }

    mutating func update(_ text: String) {
        var utf8 = Array(text.utf8)
        utf8.withUnsafeMutableBytes { update(UnsafeRawBufferPointer($0)) }
    }

    /// One file's contribution, framed so no two manifests digest alike: its name, a NUL (which no
    /// path holds), its size in decimal, a NUL, then exactly that many bytes, then a NUL. The size
    /// is stated up front, so a name cannot run into bytes or bytes into the next name; a file that
    /// yields more or fewer bytes than it said — changed while it was read — is an error.
    mutating func update(file: URL, named name: String) throws {
        let declared = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        update("\(name)\u{0}\(declared)\u{0}")
        let handle: FileHandle
        do {
            handle = try FileHandle(forReadingFrom: file)
        } catch {
            throw CubeVisionError.badModel("cannot read \(file.path): \(error.localizedDescription)")
        }
        defer { try? handle.close() }
        var read = 0
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty {
            chunk.withUnsafeBytes { update($0) }
            read += chunk.count
        }
        guard read == declared else {
            throw CubeVisionError.badModel("\(file.path) is \(read) bytes, not the \(declared) it reported — it changed while it was read")
        }
        update("\u{0}")
    }

    /// The digest as lower-case hex; the context is spent.
    mutating func finish() -> String {
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        CC_SHA256_Final(&digest, &context)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// SHA-256 of a string's UTF-8, as lower-case hex.
    static func hex(of text: String) -> String {
        var digest = Sha256()
        digest.update(text)
        return digest.finish()
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
