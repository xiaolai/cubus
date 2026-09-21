// The CoreML runner's seams that need no camera (2026-09-20, audit §2.14; 2026-09-21, audit findings
// 47–51, 107, 108, 110): the output tensor's shape, type and layout — read through
// `CubeModel.readOutput` on arrays built here, so every type and a non-dense stride are exercised
// without a prediction — the input tensor's length, the model's feature count, and the compiled-model
// cache, driven with the committed model against a cache directory of the test's own: the key that
// follows the bytes, the lock a load waits for, the entries that are swept and the one that cannot
// be. Run with `swift test` from crates/cube-vision/swift; CI runs it in the golden-macos job.
import CoreML
import XCTest
@testable import CubeVision

/// The committed model, from this file's place in the repo: Tests/CubeVisionTests → swift →
/// cube-vision → crates → the repo root.
private let modelURL: URL = {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<6 { url.deleteLastPathComponent() }
    return url.appendingPathComponent("ml/models/cubedet.mlpackage")
}()

final class ModelOutputTests: XCTestCase {
    /// A tensor of any type but the two the runner reads is refused, and the refusal names the type.
    /// Until 2026-09-20 every non-fp16 array was read AS Float32 — a double or int32 head would
    /// have produced numbers, not an error.
    func testAnOutputThatIsNeitherHalfNorFloatIsRefusedByName() throws {
        for (type, name) in [(MLMultiArrayDataType.double, "double"), (.int32, "int32")] {
            let arr = try MLMultiArray(shape: [1, 2, 3], dataType: type)
            XCTAssertThrowsError(try CubeModel.readOutput(arr), name) { error in
                let said = "\(error)"
                XCTAssertTrue(said.contains(name), "the refusal does not name the type: \(said)")
                XCTAssertTrue(said.contains("model:"), "not a model error: \(said)")
            }
        }
    }

    /// Both readable types come out dense and row-major, through strides that are NOT dense: the
    /// array is built over a buffer with a gap after every element and every row, so a copy that
    /// assumed contiguity would read the gaps.
    func testHalfAndFloatOutputsAreReadDenselyThroughTheirStrides() throws {
        let expected: [Float] = [0, 0.5, 1, 1.5, 2, 2.5]
        // Shape [1, 2, 3]; element (r, a) lives at r*8 + a*2 — a row is 8 elements apart, an anchor 2.
        let strides: [NSNumber] = [16, 8, 2]
        var floats = [Float](repeating: .nan, count: 16)
        var halves = [UInt16](repeating: 0x7E00, count: 16)  // NaN in the gaps, so a gap read shows
        for r in 0..<2 {
            for a in 0..<3 {
                let value = expected[r * 3 + a]
                floats[r * 8 + a * 2] = value
                halves[r * 8 + a * 2] = Self.half(value)
            }
        }
        // Buffers the arrays borrow for their whole life, not a pointer valid only inside a closure.
        let floatBuffer = UnsafeMutableBufferPointer<Float>.allocate(capacity: floats.count)
        let halfBuffer = UnsafeMutableBufferPointer<UInt16>.allocate(capacity: halves.count)
        defer {
            floatBuffer.deallocate()
            halfBuffer.deallocate()
        }
        _ = floatBuffer.initialize(from: floats)
        _ = halfBuffer.initialize(from: halves)
        let f32 = try MLMultiArray(
            dataPointer: UnsafeMutableRawPointer(floatBuffer.baseAddress!), shape: [1, 2, 3], dataType: .float32, strides: strides)
        let readF32 = try CubeModel.readOutput(f32)
        XCTAssertEqual([readF32.rows, readF32.anchors], [2, 3])
        XCTAssertEqual(readF32.data, expected)
        let f16 = try MLMultiArray(
            dataPointer: UnsafeMutableRawPointer(halfBuffer.baseAddress!), shape: [1, 2, 3], dataType: .float16, strides: strides)
        let readF16 = try CubeModel.readOutput(f16)
        XCTAssertEqual([readF16.rows, readF16.anchors], [2, 3])
        XCTAssertEqual(readF16.data, expected)
    }

    /// The output is exactly `[1, rows, anchors]`, both positive, with a stride per dimension.
    /// Until 2026-09-21 any rank of two or more was read from its last two dimensions, so a
    /// `[2, rows, anchors]` came out as one batch of plausible numbers (audit finding 50).
    func testAnOutputThatIsNotOneBatchOfRowsByAnchorsIsRefused() throws {
        let refused: [(shape: [Int], strides: [Int], why: String)] = [
            ([2, 3], [3, 1], "rank 2"),
            ([2, 2, 3], [6, 3, 1], "a batch of two"),
            ([1, 2, 3, 4], [24, 12, 4, 1], "rank 4"),
            ([1, 0, 3], [3, 3, 1], "zero rows"),
            ([1, 2, 0], [0, 0, 1], "zero anchors"),
            ([1, 2, 3], [3, 1], "two strides for three dimensions"),
            ([1, 2, 3], [6, 0, 1], "a zero stride"),
        ]
        for (shape, strides, why) in refused {
            XCTAssertThrowsError(try CubeModel.outputLayout(shape: shape, strides: strides), why) { error in
                XCTAssertTrue("\(error)".contains("model:"), "\(why): not a model error: \(error)")
            }
        }
        XCTAssertEqual(
            try CubeModel.outputLayout(shape: [1, 2, 3], strides: [16, 8, 2]),
            CubeModel.OutputLayout(rows: 2, anchors: 3, rowStride: 8, anchorStride: 2, extent: 13),
            "the extent is where the last element lies, plus one")
        // Through the array: a real [2, 2, 3] is refused before a byte is read.
        XCTAssertThrowsError(try CubeModel.readOutput(try MLMultiArray(shape: [2, 2, 3], dataType: .float32)))
    }

    /// The model has exactly one input and one output, by name; any other count is refused with
    /// the names, rather than answered with whichever a dictionary's order put first.
    func testTheModelMustHaveExactlyOneInputAndOneOutput() {
        XCTAssertEqual(try CubeModel.singleFeature(["image"], role: "input"), "image")
        XCTAssertThrowsError(try CubeModel.singleFeature([], role: "input")) { error in
            XCTAssertTrue("\(error)".contains("0 input"), "\(error)")
        }
        XCTAssertThrowsError(try CubeModel.singleFeature(["var_1", "aux"], role: "output")) { error in
            let said = "\(error)"
            XCTAssertTrue(said.contains("2 output") && said.contains("aux, var_1"), said)
        }
    }

    /// The binary16 pattern of a small exact value: sign 0, and 0 itself; otherwise exponent rebiased
    /// and the top ten mantissa bits. Only the values above are asked for, all of them exact in half.
    private static func half(_ value: Float) -> UInt16 {
        if value == 0 { return 0 }
        let bits = value.bitPattern
        let exp = Int((bits >> 23) & 0xFF) - 127 + 15
        let mant = (bits >> 13) & 0x3FF
        return UInt16(exp << 10) | UInt16(mant)
    }
}

final class ModelInputTests: XCTestCase {
    /// The input is exactly `3 * imgsz * imgsz` floats: fewer, more or none is refused before a
    /// pointer is formed. Until 2026-09-21 an oversized array wrote past CoreML's allocation and an
    /// empty one unwrapped a nil base address (audit finding 49).
    func testATensorOfTheWrongLengthIsRefused() throws {
        XCTAssertEqual(try CubeModel.inputCount(imgsz: 640), 3 * 640 * 640)
        XCTAssertThrowsError(try CubeModel.inputCount(imgsz: 0))
        XCTAssertThrowsError(try CubeModel.inputCount(imgsz: Int.max), "an overflow is a refusal, not a wrap")
        XCTAssertTrue(FileManager.default.fileExists(atPath: modelURL.path), "no model at \(modelURL.path) — run ml/export.py")
        let model = try CubeModel(mlpackageURL: modelURL, computeUnits: .cpuOnly)
        XCTAssertThrowsError(try model.infer(chw: [])) { error in
            let said = "\(error)"
            XCTAssertTrue(said.contains("image:") && said.contains("0 floats"), said)
        }
        XCTAssertThrowsError(try model.infer(chw: [Float](repeating: 0, count: 3 * 640 * 640 + 1)))
        XCTAssertThrowsError(try model.infer(chw: [Float](repeating: 0, count: 3 * 640 * 640 - 1)))
        XCTAssertNoThrow(try model.infer(chw: [Float](repeating: Letterbox.pad, count: 3 * 640 * 640)))
    }
}

final class CompiledModelCacheTests: XCTestCase {
    /// The test's own cache directory, fresh for every case, so what the app's cache holds — or
    /// another test run in flight — cannot decide a case here.
    private var cache: URL!

    override func setUpWithError() throws {
        try super.setUpWithError()
        XCTAssertTrue(FileManager.default.fileExists(atPath: modelURL.path), "no model at \(modelURL.path) — run ml/export.py")
        cache = FileManager.default.temporaryDirectory.appendingPathComponent("cube-vision-cache-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try FileManager.default.removeItem(at: cache)
        try super.tearDownWithError()
    }

    private func entries() throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: cache.path).sorted()
    }

    /// The `.mlmodelc` directories at the top of the temporary directory — where `compileModel(at:)`
    /// writes, and where 213 of them (2.8 GB) had accumulated on the dev Mac by 2026-09-20.
    private func compiledInTemp() -> Int {
        let tmp = NSTemporaryDirectory()
        return ((try? FileManager.default.contentsOfDirectory(atPath: tmp)) ?? []).filter { $0.hasSuffix(".mlmodelc") }.count
    }

    /// The cache's entry for the committed model, found or made, with no load — the identity loader.
    private func compiled() throws -> (url: URL, compiledNow: Bool) {
        let found = try CubeModel.compiledModel(for: modelURL, in: cache) { $0 }
        return (found.url, found.compiledNow)
    }

    /// A first load compiles into the cache and leaves nothing in the temporary directory; a second
    /// load of the same source finds the entry and compiles nothing; an entry for the same source
    /// under another fingerprint — a re-exported model's, an earlier OS's — is swept.
    func testASecondLoadFindsTheCacheAndStaleEntriesAreSwept() throws {
        let key = try CubeModel.CacheKey(for: modelURL)
        XCTAssertTrue(key.name.hasPrefix(key.prefix + "-") && key.name.hasSuffix(".mlmodelc"), key.name)
        let stale = cache.appendingPathComponent("\(key.prefix)-0000000000000000.mlmodelc", isDirectory: true)
        try FileManager.default.createDirectory(at: stale, withIntermediateDirectories: false)
        // An entry for ANOTHER source shares the directory and is nobody's to sweep.
        let other = cache.appendingPathComponent("other-deadbeef-0000000000000000.mlmodelc", isDirectory: true)
        try FileManager.default.createDirectory(at: other, withIntermediateDirectories: false)

        let inTempBefore = compiledInTemp()
        let first = try compiled()
        XCTAssertTrue(first.compiledNow, "an empty cache did not compile")
        XCTAssertEqual(first.url.lastPathComponent, key.name)
        XCTAssertEqual(first.url.deletingLastPathComponent().standardizedFileURL, cache.standardizedFileURL, "the compiled model is not in the cache")
        XCTAssertTrue(FileManager.default.fileExists(atPath: first.url.path), "the cache entry is not there")
        XCTAssertEqual(compiledInTemp(), inTempBefore, "the compile left its .mlmodelc in the temporary directory")
        let kept = [CubeModel.lockName, key.name, "other-deadbeef-0000000000000000.mlmodelc"].sorted()
        XCTAssertEqual(try entries(), kept, "the stale entry was not swept, or the other source's was")

        let second = try compiled()
        XCTAssertFalse(second.compiledNow, "a second load of the same source compiled again")
        XCTAssertEqual(second.url, first.url)
        XCTAssertEqual(compiledInTemp(), inTempBefore)
        XCTAssertEqual(try entries(), kept)
    }

    /// The whole runner, twice, against the app's real cache directory: the second instance finds
    /// what the first left and the entry is where the app will look — the case the probe and the
    /// FFI's `cube_vision_load` take. The app's cache is shared with any dev app and Rust test on
    /// this machine, so this asserts only what a shared cache guarantees: the second build is a hit.
    func testTheRunnerFindsItsOwnCacheOnTheSecondBuild() throws {
        let dir = try CubeModel.compiledCacheDirectory()
        let first = try CubeModel(mlpackageURL: modelURL, computeUnits: .cpuOnly)
        XCTAssertEqual(first.compiledURL.deletingLastPathComponent().standardizedFileURL, dir.standardizedFileURL)
        let second = try CubeModel(mlpackageURL: modelURL, computeUnits: .cpuOnly)
        XCTAssertFalse(second.compiledNow, "the runner did not find the cache it had just filled")
        XCTAssertEqual(second.compiledURL, first.compiledURL)
    }

    /// A cache entry CoreML cannot load — a directory with the right name and nothing in it, which is
    /// what a process killed between the two moves would leave if the rename were not atomic — is
    /// replaced by a fresh compile rather than reported as a broken model, through `compiledModel`
    /// with the real loader and through the runner itself.
    func testAnUnloadableCacheEntryIsCompiledAgain() throws {
        let key = try CubeModel.CacheKey(for: modelURL)
        let broken = cache.appendingPathComponent(key.name, isDirectory: true)
        try FileManager.default.createDirectory(at: broken, withIntermediateDirectories: false)
        XCTAssertThrowsError(try MLModel(contentsOf: broken), "an empty directory loaded as a model — the case proves nothing")
        let found = try CubeModel.compiledModel(for: modelURL, in: cache) { try MLModel(contentsOf: $0) }
        XCTAssertTrue(found.compiledNow, "the unloadable entry was not replaced")
        XCTAssertEqual(found.url, broken)
        XCTAssertFalse(try FileManager.default.contentsOfDirectory(atPath: broken.path).isEmpty, "the replacement is empty too")

        try FileManager.default.removeItem(at: broken)
        try FileManager.default.createDirectory(at: broken, withIntermediateDirectories: false)
        let model = try CubeModel(mlpackageURL: modelURL, computeUnits: .cpuOnly, cache: cache)
        XCTAssertTrue(model.compiledNow, "the runner did not replace the unloadable entry")
        XCTAssertEqual(model.compiledURL, broken)
    }

    /// An unloadable entry that cannot be removed is an error naming both failures — never the same
    /// entry handed back to fail again (audit finding 107). The entry is made immutable, which
    /// refuses its removal to everyone, root included.
    func testAnUnloadableEntryThatCannotBeRemovedIsAnErrorNamingBoth() throws {
        let key = try CubeModel.CacheKey(for: modelURL)
        let broken = cache.appendingPathComponent(key.name, isDirectory: true)
        try FileManager.default.createDirectory(at: broken, withIntermediateDirectories: false)
        try FileManager.default.setAttributes([.immutable: true], ofItemAtPath: broken.path)
        defer { try? FileManager.default.setAttributes([.immutable: false], ofItemAtPath: broken.path) }
        XCTAssertThrowsError(try CubeModel.compiledModel(for: modelURL, in: cache) { try MLModel(contentsOf: $0) }) { error in
            let said = "\(error)"
            XCTAssertTrue(said.contains("cannot be loaded") && said.contains("cannot be removed"), said)
        }
    }

    /// The key follows the BYTES: a source whose one file has a byte changed under the same size
    /// and the same modification date gets another key, and the same source twice gets the same.
    /// Until 2026-09-21 the key was size and date, and that source answered from the old compiled
    /// model (audit finding 47).
    func testTheKeyFollowsTheBytesNotTheSizeAndDate() throws {
        let copy = cache.appendingPathComponent("copy.mlpackage", isDirectory: true)
        try FileManager.default.copyItem(at: modelURL, to: copy)
        let before = try CubeModel.CacheKey(for: copy)
        XCTAssertEqual(try CubeModel.CacheKey(for: copy).name, before.name, "the same bytes twice keyed differently")
        let weights = copy.appendingPathComponent("Data/com.apple.CoreML/weights/weight.bin")
        let attributes = try FileManager.default.attributesOfItem(atPath: weights.path)
        let size = attributes[.size] as! Int
        let modified = attributes[.modificationDate] as! Date
        let handle = try FileHandle(forUpdating: weights)
        try handle.seek(toOffset: UInt64(size / 2))
        let byte = try XCTUnwrap(try handle.read(upToCount: 1)?.first)
        try handle.seek(toOffset: UInt64(size / 2))
        try handle.write(contentsOf: Data([byte ^ 0xFF]))
        try handle.close()
        try FileManager.default.setAttributes([.modificationDate: modified], ofItemAtPath: weights.path)
        let after = try FileManager.default.attributesOfItem(atPath: weights.path)
        XCTAssertEqual(after[.size] as? Int, size, "the byte flip changed the size — the case proves nothing")
        XCTAssertEqual(after[.modificationDate] as? Date, modified, "the date was not put back — the case proves nothing")
        let changed = try CubeModel.CacheKey(for: copy)
        XCTAssertEqual(changed.prefix, before.prefix, "the same path keyed under another prefix")
        XCTAssertNotEqual(changed.name, before.name, "a changed byte under the same size and date kept the old key")
    }

    /// A file the key cannot read is an error, not a key that skipped it.
    func testAFileTheKeyCannotReadIsAnError() throws {
        if getuid() == 0 { throw XCTSkip("root reads a file with no permissions; the refusal cannot be staged") }
        let copy = cache.appendingPathComponent("copy.mlpackage", isDirectory: true)
        try FileManager.default.copyItem(at: modelURL, to: copy)
        let manifest = copy.appendingPathComponent("Manifest.json")
        try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: manifest.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: manifest.path) }
        XCTAssertThrowsError(try CubeModel.CacheKey(for: copy)) { error in
            XCTAssertTrue("\(error)".contains("Manifest.json"), "the error does not name the file: \(error)")
        }
    }

    /// A subtree the walk cannot enter is refused by name, not skipped: the enumerator's default is to
    /// leave out what it cannot read, and a key over the rest would call a model missing a directory
    /// the same model (audit finding 47, on verification).
    func testAnUnreadableSubtreeIsAnErrorNotASilentGap() throws {
        if getuid() == 0 { throw XCTSkip("root reads a directory with no permissions; the refusal cannot be staged") }
        let copy = cache.appendingPathComponent("copy.mlpackage", isDirectory: true)
        try FileManager.default.copyItem(at: modelURL, to: copy)
        let data = copy.appendingPathComponent("Data", isDirectory: true)
        XCTAssertTrue(FileManager.default.fileExists(atPath: data.path), "the package has no Data directory to stage with")
        try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: data.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: data.path) }
        XCTAssertThrowsError(try CubeModel.CacheKey(for: copy)) { error in
            XCTAssertTrue("\(error)".contains("Data"), "the error does not name the subtree: \(error)")
        }
    }

    /// The cache lock is HELD while the model loads, not merely taken before: from inside the load
    /// closure a second open file description cannot take it without blocking (audit finding 48,
    /// on verification — the waiting test above proves acquisition, this proves the hold).
    func testTheLockIsHeldWhileTheModelLoads() throws {
        let lock = cache.appendingPathComponent(CubeModel.lockName).path
        var heldDuringLoad: Bool?
        _ = try CubeModel.compiledModel(for: modelURL, in: cache) { url in
            let fd = open(lock, O_RDWR)
            XCTAssertGreaterThanOrEqual(fd, 0, "cannot open the lock file from inside the load")
            defer { close(fd) }
            let refused = flock(fd, LOCK_EX | LOCK_NB) != 0
            heldDuringLoad = refused && errno == EWOULDBLOCK
            return url
        }
        XCTAssertEqual(heldDuringLoad, true, "the lock was not held while the loader ran")
    }

    /// A staging directory a killed process left behind is swept once it is old enough to be
    /// abandoned; one young enough to be a compile in flight is kept (audit finding 110).
    func testAbandonedStagingDirectoriesAreSweptAndFreshOnesKept() throws {
        let old = cache.appendingPathComponent("\(CubeModel.stagingPrefix)old", isDirectory: true)
        let fresh = cache.appendingPathComponent("\(CubeModel.stagingPrefix)fresh", isDirectory: true)
        try FileManager.default.createDirectory(at: old, withIntermediateDirectories: false)
        try FileManager.default.createDirectory(at: fresh, withIntermediateDirectories: false)
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSinceNow: -CubeModel.stagingAbandonedAfter - 60)], ofItemAtPath: old.path)
        _ = try compiled()
        let after = try entries()
        XCTAssertFalse(after.contains(old.lastPathComponent), "the abandoned staging directory was kept: \(after)")
        XCTAssertTrue(after.contains(fresh.lastPathComponent), "a staging directory young enough to be in flight was swept: \(after)")
    }

    /// A load waits for the cache's lock while another holder has it — another process compiling,
    /// installing or loading — and proceeds when it is released (audit finding 48). `flock` contends
    /// between two descriptors in one process as it does between processes, so the test holds it.
    func testALoadWaitsForTheCacheLockAnotherHolderHas() throws {
        _ = try compiled()
        let lock = cache.appendingPathComponent(CubeModel.lockName).path
        let fd = open(lock, O_RDWR | O_CREAT, 0o644)
        XCTAssertGreaterThanOrEqual(fd, 0, "cannot open the lock file")
        XCTAssertEqual(flock(fd, LOCK_EX), 0, "cannot take the lock")
        let finished = DispatchSemaphore(value: 0)
        var result: Result<Bool, Error>?
        Thread {
            result = Result { try self.compiled().compiledNow }
            finished.signal()
        }.start()
        XCTAssertEqual(finished.wait(timeout: .now() + 0.5), .timedOut, "the load did not wait for the lock")
        XCTAssertEqual(flock(fd, LOCK_UN), 0)
        close(fd)
        XCTAssertEqual(finished.wait(timeout: .now() + 30), .success, "the load did not proceed once the lock was released")
        XCTAssertEqual(try result?.get(), false, "the load did not find the entry that was already there")
    }
}
