// The native scanner's per-tick entry, end to end: the Swift letterbox and CoreML on an injected frame,
// with no camera — and the camera-position mapping behind the page's facing (2026-09-19,
// dev-docs/scan-guidance-plan.md 5; audit rounds 2 and 3), and what a camera that stops delivering
// answers (2026-09-20, audit §1.2): a stale frame is no frame, a disconnect or a failed session is an
// error naming the cause. Since 2026-09-21 also the load's transaction — a failed reload keeps the
// model that worked, a probe whose shape nothing can hold loads nothing — and the error channel, one
// slot per thread. The still entry's byte-count check is held from the Rust side, across the real
// boundary (`infer_rgba_refuses_a_byte_count_that_is_not_its_size` in src/apple.rs). Run with
// `swift test` from crates/cube-vision/swift; CI runs it in the golden-macos job.
import AVFoundation
import CoreML
import XCTest
@testable import CubeVision

final class FacingTests: XCTestCase {
    func testAPositionNamesItsFacingOrNothing() {
        XCTAssertEqual(CameraInfo.facing(for: .front), "user")
        XCTAssertEqual(CameraInfo.facing(for: .back), "environment")
        XCTAssertNil(CameraInfo.facing(for: .unspecified), "a Mac's camera reports no position and names no facing")
    }

    func testTheFacingCrossesAsJSONOnlyWhenThereIsOne() throws {
        let back = String(decoding: try JSONEncoder().encode(CameraInfo(deviceId: "b", label: "Back", facing: "environment")), as: UTF8.self)
        XCTAssertTrue(back.contains("\"facing\":\"environment\""), back)
        let mac = String(decoding: try JSONEncoder().encode(CameraInfo(deviceId: "m", label: "Mac", facing: nil)), as: UTF8.self)
        XCTAssertFalse(mac.contains("facing"), mac)
    }
}

final class NextDetectionTests: XCTestCase {
    /// The committed model, from this file's place in the repo: Tests/CubeVisionTests → swift →
    /// cube-vision → crates → the repo root.
    private static let modelPath: String = {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<6 { url.deleteLastPathComponent() }
        return url.appendingPathComponent("ml/models/cubedet.mlpackage").path
    }()

    /// A frame odd both ways, so a swapped or rounded dimension cannot pass, and varied, so its tensor
    /// is not the same for every picture.
    private static let (frameWidth, frameHeight) = (721, 479)
    private static let frameBytes: [UInt8] = (0..<(721 * 479 * 4)).map { UInt8(truncatingIfNeeded: $0 &* 31) }

    // Every test starts from, and leaves, nothing loaded and nothing open — the state is the process's.
    override func setUp() {
        super.setUp()
        resetStateForTests()
    }

    override func tearDown() {
        resetStateForTests()
        super.tearDown()
    }

    /// The committed model on the CPU alone, so two runs of one frame answer the same numbers.
    private func loadModel() -> Int32 {
        XCTAssertTrue(FileManager.default.fileExists(atPath: Self.modelPath), "no model at \(Self.modelPath) — run ml/export.py")
        let cap = Self.modelPath.withCString { cube_vision_load($0, 1) }
        XCTAssertGreaterThan(cap, 0, "the model did not load: \(lastError() ?? "no reason")")
        return cap
    }

    /// A camera opened with no lens, its latest frame `frame` when one is given, installed as the
    /// open one.
    @discardableResult
    private func openInjectedCamera(_ frame: (bytes: [UInt8], width: Int, height: Int)?) -> (camera: Camera, generation: Int) {
        let camera = Camera(orientationSource: nil)
        let generation = camera.openForTests()
        if let frame { camera.injectForTests(frame) }
        useCameraForTests(camera)
        return (camera, generation)
    }

    private static let frame = (bytes: frameBytes, width: frameWidth, height: frameHeight)

    /// The reason the last failing call left, consumed.
    private func lastError() -> String? {
        guard let why = cube_vision_last_error() else { return nil }
        defer { cube_vision_free_string(why) }
        return String(cString: why)
    }

    /// One call: the element count (or error), the buffer and shape it wrote, and the frame info —
    /// its picture size and its identity (D2).
    /// The buffer starts as NaN, so an element the entry did not write cannot pass for one it did.
    private func detect(cap: Int32) -> (n: Int32, tensor: [Float], rows: Int32, anchors: Int32, width: Int32, height: Int32, id: Int32) {
        var buf = [Float](repeating: .nan, count: Int(max(cap, 1)))
        var rows: Int32 = -1, anchors: Int32 = -1
        var info: [Int32] = [-1, -1, -1]
        let n = buf.withUnsafeMutableBufferPointer { out in
            info.withUnsafeMutableBufferPointer { cube_vision_next_detection(out.baseAddress!, cap, &rows, &anchors, $0.baseAddress!) }
        }
        return (n, buf, rows, anchors, info[0], info[1], info[2])
    }

    /// THE CLAIM D2 RESTS ON (dev-docs/scan-pipeline-audit-2026-09-23.md §3): the id repeats for
    /// every tick that is served one physical frame, and changes when a new frame arrives.
    ///
    /// This is the defect stated exactly. `latestFrame()` serves its cached frame on every tick for
    /// up to `frameStaleAfter` — a full second, sixteen ticks at the native rate — and nothing on
    /// the page could tell that from sixteen new frames. The stillness gate asks for three
    /// identical reads spanning 500 ms, which ONE frame re-served can satisfy on its own, so a
    /// "settled" side could rest on a single observation. Asserted as a NEGATIVE too: three ticks
    /// with no new frame must not produce three identities, because that is the reading that was
    /// wrong and it would look perfectly healthy.
    func testOnePhysicalFrameKeepsOneIdentityAcrossEveryTickItIsServedTo() {
        let cap = loadModel()
        let camera = openInjectedCamera(Self.frame).camera
        let first = detect(cap: cap)
        XCTAssertEqual(first.n, cap, "the injected frame was not served")
        // Two more ticks with nothing new injected: the SAME frame, so the same identity.
        let again = [detect(cap: cap), detect(cap: cap)]
        for (i, got) in again.enumerated() {
            XCTAssertEqual(got.n, cap, "tick \(i + 2) was not served the cached frame")
            XCTAssertEqual(got.id, first.id, "a re-served frame was given a new identity on tick \(i + 2)")
        }
        XCTAssertEqual(Set([first.id] + again.map(\.id)).count, 1,
                       "three ticks on one frame reported more than one identity")
        // A frame that actually arrives is a different one, and says so.
        camera.injectForTests(Self.frame)
        let next = detect(cap: cap)
        XCTAssertEqual(next.n, cap, "the second frame was not served")
        XCTAssertNotEqual(next.id, first.id, "a new frame reused the previous frame's identity")
    }

    /// A tick with no frame reports no identity — zero, with the size. An id left standing from the
    /// previous tick beside a zero size would name a frame that never arrived, and the Rust side
    /// reads the three words as one unit.
    func testATickWithNoFrameLeavesNoIdentityBehind() {
        let cap = loadModel()
        let camera = openInjectedCamera(Self.frame).camera
        XCTAssertNotEqual(detect(cap: cap).id, 0, "the served frame had no identity")
        camera.injectForTests(Self.frame, age: Camera.frameStaleAfter)
        let stale = detect(cap: cap)
        XCTAssertEqual(stale.n, 0, "a stale frame was served")
        XCTAssertEqual([stale.width, stale.height, stale.id], [0, 0, 0],
                       "a tick with no frame left a size or an identity behind")
    }

    func testNoModelNoCameraAndNoFrameEachWriteNoPicture() {
        var got = detect(cap: 1)
        XCTAssertEqual(got.n, -3, "no model")
        XCTAssertEqual([got.width, got.height], [0, 0], "a failed call left a size behind")
        let cap = loadModel()
        got = detect(cap: cap)
        XCTAssertEqual(got.n, -4, "no camera")
        XCTAssertEqual([got.width, got.height], [0, 0])
        openInjectedCamera(nil)
        got = detect(cap: cap)
        XCTAssertEqual(got.n, 0, "no frame yet")
        XCTAssertEqual([got.width, got.height], [0, 0])
    }

    func testAFrameIsInferredWholeAndCarriesItsPictureSize() {
        let cap = loadModel()
        openInjectedCamera(Self.frame)
        let got = detect(cap: cap)
        XCTAssertEqual(got.n, cap, "the frame was not inferred")
        XCTAssertEqual([got.rows, got.anchors], [10, 8400], "rows = 4 box coords + 6 colour classes; 8400 anchors at 640")
        XCTAssertEqual(Int(got.n), Int(got.rows) * Int(got.anchors), "the count is not the shape it reported")
        XCTAssertTrue(got.tensor.allSatisfy { $0.isFinite }, "an element was not written, or is not a number")
        XCTAssertTrue(got.tensor.contains { $0 != 0 }, "the tensor is all zeros")
        XCTAssertEqual([got.width, got.height], [Int32(Self.frameWidth), Int32(Self.frameHeight)], "the size is not the frame's")
        // The same frame through the still entry: the per-tick path is that one plus the camera, so the
        // two must read it identically.
        var still = [Float](repeating: .nan, count: Int(cap))
        var rows: Int32 = 0, anchors: Int32 = 0
        let m = Self.frameBytes.withUnsafeBufferPointer { p in
            still.withUnsafeMutableBufferPointer {
                cube_vision_infer_rgba(p.baseAddress!, p.count, Int32(Self.frameWidth), Int32(Self.frameHeight), $0.baseAddress!, cap, &rows, &anchors)
            }
        }
        XCTAssertEqual(m, cap)
        XCTAssertEqual(got.tensor, still, "the per-tick entry and the still entry read one frame differently")
    }

    /// A frame that arrived but could not be written out is not a frame: no size.
    func testAFrameTheBufferCannotHoldLeavesNoPicture() {
        let cap = loadModel()
        openInjectedCamera(Self.frame)
        let got = detect(cap: cap - 1)
        XCTAssertEqual(got.n, -2, "an undersized buffer was written into")
        XCTAssertEqual([got.width, got.height], [0, 0], "a frame that was not written out left its size behind")
    }

    /// A frame whose inference fails is not a frame either: -1, no size, and the reason left for the
    /// caller. The committed model cannot be made to fail, so a stand-in does.
    func testAFrameWhoseInferenceFailsLeavesNoPictureAndSaysWhy() {
        useModelForTests(FailingModel(), rows: 10, anchors: 8400)
        openInjectedCamera(Self.frame)
        let got = detect(cap: 10 * 8400)
        XCTAssertEqual(got.n, -1, "a failed inference was not reported as one")
        XCTAssertEqual([got.width, got.height], [0, 0], "a frame that was not inferred left its size behind")
        guard let why = lastError() else { return XCTFail("the failure left no reason") }
        XCTAssertTrue(why.contains("cube_vision_next_detection"), why)
    }

    /// A frame is served while it is younger than the window and refused once it is older
    /// (2026-09-20, audit §1.2): the camera used to keep its last frame until a new one or `close()`,
    /// so a webcam unplugged mid-scan was re-inferred every tick as a perfectly still cube and the
    /// Rust side's no-frame clock — which starts only on a 0 — never started. Injected with an age
    /// rather than waited for, so the case is exact and costs no time.
    func testAFrameIsServedFreshAndRefusedOnceStale() {
        let cap = loadModel()
        let camera = openInjectedCamera(nil).camera
        camera.injectForTests(Self.frame, age: Camera.frameStaleAfter / 2)
        XCTAssertEqual(detect(cap: cap).n, cap, "a frame inside the window was not served")
        camera.injectForTests(Self.frame, age: Camera.frameStaleAfter)
        let got = detect(cap: cap)
        XCTAssertEqual(got.n, 0, "a frame older than the window was served as the latest")
        XCTAssertEqual([got.width, got.height], [0, 0], "a refused frame left its size behind")
        XCTAssertNil(lastError(), "no frame is not a failure, and must leave no reason")
        // A frame that arrives afterwards is served: the window is about age, not about history.
        camera.injectForTests(Self.frame)
        XCTAssertEqual(detect(cap: cap).n, cap, "a fresh frame after a stale one was not served")
    }

    /// The OS said the device went away: -6, no picture, and a reason naming the device — and the
    /// fault outranks a frame in hand, because that frame is from a camera that is not there. Until
    /// 2026-09-20 nothing observed the disconnect and the last frame was served forever.
    func testADisconnectedCameraIsAnErrorNamingTheDevice() {
        let cap = loadModel()
        let (camera, generation) = openInjectedCamera(Self.frame)
        XCTAssertEqual(detect(cap: cap).n, cap)
        camera.deviceWasDisconnected(label: "Injected frame", generation: generation)
        let got = detect(cap: cap)
        XCTAssertEqual(got.n, -6, "a disconnected camera was not reported as one")
        XCTAssertEqual([got.width, got.height], [0, 0], "a disconnect left a size behind")
        guard let why = lastError() else { return XCTFail("the disconnect left no reason") }
        XCTAssertTrue(why.contains("Injected frame") && why.contains("disconnected"), why)
        camera.injectForTests(Self.frame)
        XCTAssertEqual(detect(cap: cap).n, -6, "a frame injected after the disconnect was served")
        XCTAssertNotNil(lastError(), "every -6 carries its reason, not only the first")
    }

    /// The session's own notifications, posted the way AVFoundation posts them, reach the same
    /// answers through the observers `init` installs — the real wiring, not a hook. A runtime error
    /// is the session stopping: -6 with its reason. An interruption is a pause the OS ends (a call,
    /// another app taking the device, the background): the tick answers "no frame" until the end
    /// arrives, so the Rust clock bounds it, and the next frame after the end is served as ever.
    func testASessionErrorAndAnInterruptionArriveThroughTheNotifications() {
        let cap = loadModel()
        let camera = openInjectedCamera(Self.frame).camera
        let center = NotificationCenter.default
        center.post(name: .AVCaptureSessionWasInterrupted, object: camera.sessionForTests)
        XCTAssertEqual(detect(cap: cap).n, 0, "an interrupted session served its last frame")
        XCTAssertNil(lastError(), "an interruption is not a failure")
        camera.injectForTests(Self.frame)
        XCTAssertEqual(detect(cap: cap).n, 0, "a frame published during the interruption was served")
        center.post(name: .AVCaptureSessionInterruptionEnded, object: camera.sessionForTests)
        camera.injectForTests(Self.frame)
        XCTAssertEqual(detect(cap: cap).n, cap, "a frame after the interruption ended was not served")

        let error = NSError(
            domain: AVFoundationErrorDomain, code: AVError.Code.deviceWasDisconnected.rawValue,
            userInfo: [NSLocalizedDescriptionKey: "the media services were reset"])
        center.post(name: .AVCaptureSessionRuntimeError, object: camera.sessionForTests, userInfo: [AVCaptureSessionErrorKey: error])
        let got = detect(cap: cap)
        XCTAssertEqual(got.n, -6, "a failed session was not reported as one")
        guard let why = lastError() else { return XCTFail("the failure left no reason") }
        XCTAssertTrue(why.contains("the media services were reset"), why)

        // Another camera's session says nothing about this one: the observers are keyed to the object.
        let other = Camera(orientationSource: nil)
        other.openForTests()
        center.post(name: .AVCaptureSessionRuntimeError, object: other.sessionForTests, userInfo: [AVCaptureSessionErrorKey: error])
        camera.injectForTests(Self.frame)
        XCTAssertEqual(detect(cap: cap).n, -6, "the fault was lost")
        useCameraForTests(other)
        other.injectForTests(Self.frame)
        XCTAssertEqual(detect(cap: cap).n, -6, "the other camera's own session error was not recorded")
    }

    /// The reason a call failed stays with the thread that made the call: a failure on another
    /// thread in between — another Tauri worker's command — neither overwrites nor consumes it
    /// (audit finding 105). Ordered with semaphores, so the interleaving is the one described.
    func testAFailureOnOneThreadKeepsItsReasonWhileAnotherThreadFails() {
        let failedOnA = DispatchSemaphore(value: 0)
        let fetchedOnB = DispatchSemaphore(value: 0)
        let finished = DispatchSemaphore(value: 0)
        var codeOnA: Int32 = 0
        var reasonOnA: String?
        Thread {
            var buf: Float = .nan
            var rows: Int32 = 0, anchors: Int32 = 0
            var picture: [Int32] = [0, 0]
            codeOnA = picture.withUnsafeMutableBufferPointer { cube_vision_next_detection(&buf, 1, &rows, &anchors, $0.baseAddress!) }
            failedOnA.signal()
            fetchedOnB.wait()
            reasonOnA = self.lastError()
            finished.signal()
        }.start()
        failedOnA.wait()
        XCTAssertEqual(codeOnA, -3, "thread A's call did not fail as expected")
        let bytes = [UInt8](repeating: 0, count: 4)
        var out: Float = .nan
        var rows: Int32 = 0, anchors: Int32 = 0
        let codeOnB = bytes.withUnsafeBufferPointer { cube_vision_infer_rgba($0.baseAddress!, 3, 1, 1, &out, 1, &rows, &anchors) }
        XCTAssertEqual(codeOnB, -5, "thread B's call did not fail as expected")
        let reasonOnB = lastError()
        XCTAssertTrue(reasonOnB?.contains("is not 3 bytes") == true, "thread B did not get its own reason: \(reasonOnB ?? "nil")")
        fetchedOnB.signal()
        XCTAssertEqual(finished.wait(timeout: .now() + 10), .success)
        XCTAssertEqual(reasonOnA, "no model loaded", "thread A's reason was overwritten or consumed by thread B's failure")
        XCTAssertNil(lastError(), "a reason was left on the main thread")
    }

    /// A load that fails leaves the model that was working exactly as it was: the next tick still
    /// infers with the count the Rust side sized from, and a repeat load of the working pair is
    /// answered without a build. Until 2026-09-21 the failure cleared the model while the Rust side
    /// kept the count (audit finding 104).
    func testAFailedReloadKeepsTheWorkingModel() {
        let cap = loadModel()
        XCTAssertEqual(cube_vision_compile_count(), 1)
        openInjectedCamera(Self.frame)
        let rc = "/no/such/place/cubedet.mlpackage".withCString { cube_vision_load($0, 1) }
        XCTAssertEqual(rc, -1, "a load from a path that does not exist did not fail")
        guard let why = lastError() else { return XCTFail("the failed load left no reason") }
        XCTAssertTrue(why.contains("no model at"), why)
        XCTAssertEqual(detect(cap: cap).n, cap, "the working model was cleared by the failed reload")
        XCTAssertEqual(Self.modelPath.withCString { cube_vision_load($0, 1) }, cap, "the working pair was not answered")
        XCTAssertEqual(cube_vision_compile_count(), 1, "the working pair was built again after the failed reload")

        // A build that fails AFTER construction — the probe — keeps it too.
        useModelBuilderForTests { _, _ in FailingModel() }
        XCTAssertEqual(Self.modelPath.withCString { cube_vision_load($0, 2) }, -1, "a model whose probe fails loaded")
        XCTAssertNotNil(lastError())
        XCTAssertEqual(detect(cap: cap).n, cap, "the working model was cleared by a probe that failed")
    }

    /// A probe's output that nothing can hold — a zero dimension, a count the ABI's Int32 cannot
    /// return, data that is not the shape it claims — is a refused load with the reason, and no
    /// model is loaded by it (audit finding 103). A zero used to be returned as a success of 0
    /// elements; an overflow as a wrapped count.
    func testAProbeWhoseShapeCannotBeHeldIsRefusedAndLoadsNothing() throws {
        XCTAssertEqual(try outputCount(of: Inference(data: [Float](repeating: 0, count: 6), rows: 2, anchors: 3)), 6)
        let refused: [(Inference, String)] = [
            (Inference(data: [], rows: 0, anchors: 8400), "positive"),
            (Inference(data: [], rows: 10, anchors: 0), "positive"),
            (Inference(data: [], rows: 1 << 20, anchors: 1 << 12), "Int32"),
            (Inference(data: [], rows: Int.max, anchors: 2), "Int32"),
            (Inference(data: [Float](repeating: 0, count: 5), rows: 2, anchors: 3), "holds 5"),
        ]
        for (probe, word) in refused {
            XCTAssertThrowsError(try outputCount(of: probe), "\(probe.rows)×\(probe.anchors)") { error in
                let said = "\(error)"
                XCTAssertTrue(said.contains("model:") && said.contains(word), said)
            }
        }
        // Through the load: the refusal is the load's, and nothing is loaded.
        useModelBuilderForTests { _, _ in ShapedModel(Inference(data: [], rows: 0, anchors: 8400)) }
        XCTAssertEqual("shaped.mlpackage".withCString { cube_vision_load($0, 0) }, -1, "a probe with zero rows loaded")
        XCTAssertTrue(lastError()?.contains("positive") == true)
        XCTAssertEqual(detect(cap: 1).n, -3, "a model whose probe was refused is loaded")
        // A probe that holds up loads, with its count, and the same pair is then answered from it.
        useModelBuilderForTests { _, _ in ShapedModel(Inference(data: [Float](repeating: 1, count: 6), rows: 2, anchors: 3)) }
        XCTAssertEqual("shaped.mlpackage".withCString { cube_vision_load($0, 0) }, 6)
        XCTAssertEqual(cube_vision_compile_count(), 2)
        XCTAssertEqual("shaped.mlpackage".withCString { cube_vision_load($0, 0) }, 6)
        XCTAssertEqual(cube_vision_compile_count(), 2, "the same pair was built again")
    }
}

/// A model whose every inference fails.
private final class FailingModel: FrameInferring {
    struct Refused: Error {}
    func infer(chw: [Float], imgsz: Int) throws -> Inference { throw Refused() }
}

/// A model whose every inference answers the same tensor, whatever its shape claims.
private final class ShapedModel: FrameInferring {
    private let answer: Inference
    init(_ answer: Inference) { self.answer = answer }
    func infer(chw: [Float], imgsz: Int) throws -> Inference { answer }
}
