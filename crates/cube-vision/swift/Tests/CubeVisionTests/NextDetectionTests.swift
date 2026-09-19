// The native scanner's per-tick entry, end to end: the Swift letterbox and CoreML on an injected frame,
// with no camera — and the camera-position mapping behind the page's facing (2026-09-19,
// dev-docs/scan-guidance-plan.md 5; audit rounds 2 and 3). The still entry's byte-count check is held
// from the Rust side, across the real boundary (`infer_rgba_refuses_a_byte_count_that_is_not_its_size`
// in src/apple.rs). Run with `swift test` from crates/cube-vision/swift; CI runs it in the golden-macos
// job.
import AVFoundation
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
        return url.appendingPathComponent("ml/models/cube-yolo.mlpackage").path
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
        XCTAssertGreaterThan(cap, 0, "the model did not load")
        return cap
    }

    /// A camera whose latest frame is `frame`, installed as the open one.
    private func openInjectedCamera(_ frame: (bytes: [UInt8], width: Int, height: Int)?) {
        let camera = Camera()
        camera.injectForTests(frame)
        useCameraForTests(camera)
    }

    /// One call: the element count (or error), the buffer and shape it wrote, and the picture size.
    /// The buffer starts as NaN, so an element the entry did not write cannot pass for one it did.
    private func detect(cap: Int32) -> (n: Int32, tensor: [Float], rows: Int32, anchors: Int32, width: Int32, height: Int32) {
        var buf = [Float](repeating: .nan, count: Int(max(cap, 1)))
        var rows: Int32 = -1, anchors: Int32 = -1
        var picture: [Int32] = [-1, -1]
        let n = buf.withUnsafeMutableBufferPointer { out in
            picture.withUnsafeMutableBufferPointer { cube_vision_next_detection(out.baseAddress!, cap, &rows, &anchors, $0.baseAddress!) }
        }
        return (n, buf, rows, anchors, picture[0], picture[1])
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
        openInjectedCamera((bytes: Self.frameBytes, width: Self.frameWidth, height: Self.frameHeight))
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
        openInjectedCamera((bytes: Self.frameBytes, width: Self.frameWidth, height: Self.frameHeight))
        let got = detect(cap: cap - 1)
        XCTAssertEqual(got.n, -2, "an undersized buffer was written into")
        XCTAssertEqual([got.width, got.height], [0, 0], "a frame that was not written out left its size behind")
    }

    /// A frame whose inference fails is not a frame either: -1, no size, and the reason left for the
    /// caller. The committed model cannot be made to fail, so a stand-in does.
    func testAFrameWhoseInferenceFailsLeavesNoPictureAndSaysWhy() {
        useModelForTests(FailingModel(), rows: 10, anchors: 8400)
        openInjectedCamera((bytes: Self.frameBytes, width: Self.frameWidth, height: Self.frameHeight))
        let got = detect(cap: 10 * 8400)
        XCTAssertEqual(got.n, -1, "a failed inference was not reported as one")
        XCTAssertEqual([got.width, got.height], [0, 0], "a frame that was not inferred left its size behind")
        guard let why = cube_vision_last_error() else { return XCTFail("the failure left no reason") }
        defer { cube_vision_free_string(why) }
        XCTAssertTrue(String(cString: why).contains("cube_vision_next_detection"), String(cString: why))
    }
}

/// A model whose every inference fails.
private final class FailingModel: FrameInferring {
    struct Refused: Error {}
    func infer(chw: [Float], imgsz: Int) throws -> Inference { throw Refused() }
}
