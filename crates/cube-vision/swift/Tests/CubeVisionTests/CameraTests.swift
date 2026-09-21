// The camera's seams that need no lens (2026-09-20, audit §2.9; 2026-09-21, audit findings 42–45
// and 102). `Camera.open` cannot be driven here — it needs a device and the permission — so each
// part of it is a seam of its own: the configuration transaction, balanced on every exit and taking
// its steps back on a throw; the output step of `install`, against a real session; the rotation,
// against a connection that refuses; the lifecycle — generations, interruption — through the same
// entries the observers and the sink use. A physical device is still owed the end-to-end check.
import AVFoundation
import XCTest
@testable import CubeVision

/// An `AVCaptureSession` that counts the transaction calls it receives, and still makes them.
private final class CountingSession: AVCaptureSession {
    var begun = 0
    var committed = 0

    override func beginConfiguration() {
        begun += 1
        super.beginConfiguration()
    }

    override func commitConfiguration() {
        committed += 1
        super.commitConfiguration()
    }
}

private struct Refused: Error {}

private final class RecordingDelegate: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {}

/// A connection that supports the angles it was told to, and remembers what was set on it.
private final class FakeConnection: RotatableConnection {
    private let supported: Set<CGFloat>
    var videoRotationAngle: CGFloat = 0

    init(supporting: Set<CGFloat>) {
        supported = supporting
    }

    func isVideoRotationAngleSupported(_ angle: CGFloat) -> Bool {
        supported.contains(angle)
    }
}

/// An orientation source the test turns by hand. Handlers are kept for the life of the source, so
/// a test can deliver a change to a handler whose open has already ended.
private final class DrivenOrientation: InterfaceOrientationSource {
    var now: InterfaceOrientation? = .portrait
    private var handlers: [(InterfaceOrientation) -> Void] = []

    func current() throws -> InterfaceOrientation {
        guard let now else { throw CubeVisionError.capture("no window scene") }
        return now
    }

    func observe(_ onChange: @escaping (InterfaceOrientation) -> Void) -> AnyObject {
        handlers.append(onChange)
        return NSObject()
    }

    func turn(_ orientation: InterfaceOrientation) {
        handlers.forEach { $0(orientation) }
    }
}

private let frame = (bytes: [UInt8](repeating: 0, count: 2 * 2 * 4), width: 2, height: 2)

final class CameraConfigurationTests: XCTestCase {
    /// A step that throws still commits: before the seam, the mirroring refusal threw between
    /// `beginConfiguration` and `commitConfiguration`, so the next `open` nested inside the
    /// transaction the last one had left open and `startRunning()` ran on a configuration the
    /// session had never been handed.
    func testAThrowingStepStillCommitsTheConfiguration() {
        let session = CountingSession()
        XCTAssertThrowsError(try Camera.configure(session) { _ in throw Refused() })
        XCTAssertEqual(session.begun, 1, "the transaction was not begun")
        XCTAssertEqual(session.committed, 1, "a step that threw left the configuration open")
        // The error is the step's own, not swallowed on the way out.
        do {
            try Camera.configure(session) { _ in throw Refused() }
            XCTFail("the step's error did not come out")
        } catch is Refused {
        } catch {
            XCTFail("a different error came out: \(error)")
        }
        XCTAssertEqual([session.begun, session.committed], [2, 2])
    }

    /// The ordinary path is one begin and one commit around the steps, and the steps run inside.
    func testACompletingStepIsOneBeginAndOneCommitAroundIt() {
        let session = CountingSession()
        var seen = (begun: -1, committed: -1)
        Camera.configure(session) { _ in
            seen = (session.begun, session.committed)
        }
        XCTAssertEqual(seen.begun, 1, "the steps ran before the transaction began")
        XCTAssertEqual(seen.committed, 0, "the steps ran after the commit")
        XCTAssertEqual([session.begun, session.committed], [1, 1])
    }

    /// A step that throws takes back every step before it, last first, and then the transaction
    /// commits; a transaction that completes takes nothing back. Until 2026-09-21 `open` committed
    /// whatever its steps had added before the one that refused, so a failed open kept the camera.
    func testAThrowingStepUndoesEveryStepBeforeItInReverse() {
        let session = CountingSession()
        var undone: [String] = []
        XCTAssertThrowsError(try Camera.configure(session) { rollback in
            rollback.onThrow { undone.append("input") }
            rollback.onThrow { undone.append("output") }
            throw Refused()
        })
        XCTAssertEqual(undone, ["output", "input"], "the steps were not taken back, or not in reverse")
        XCTAssertEqual([session.begun, session.committed], [1, 1], "the rollback ran outside the transaction")
        undone = []
        Camera.configure(session) { rollback in
            rollback.onThrow { undone.append("input") }
        }
        XCTAssertEqual(undone, [], "a completing transaction took its steps back")
    }

    /// The output step of `install` against a real session: when a later step refuses, the output
    /// is off the session and its delegate is cleared — the same undo `install` registers for the
    /// input, which needs a device to run.
    func testAnOutputInstalledBeforeARefusalIsRemovedAndItsDelegateCleared() throws {
        let session = CountingSession()
        let output = AVCaptureVideoDataOutput()
        let delegate = RecordingDelegate()
        output.setSampleBufferDelegate(delegate, queue: DispatchQueue(label: "im.cubus.cube-vision.test"))
        var added = false
        XCTAssertThrowsError(try Camera.configure(session) { rollback in
            try Camera.installOutput(output, into: session, rollback)
            added = session.outputs.contains(output)
            throw Refused()
        })
        XCTAssertTrue(added, "the output was never added — the case proves nothing")
        XCTAssertTrue(session.outputs.isEmpty, "the output stayed on the session after the refusal")
        XCTAssertNil(output.sampleBufferDelegate, "the output's delegate stayed set after the refusal")
        // Balanced, not one: `addOutput` and `removeOutput` open and commit a transaction of
        // AVFoundation's own inside ours (measured 2026-09-21: three begins, three commits).
        XCTAssertEqual(session.begun, session.committed, "the transaction was left open")
        XCTAssertGreaterThanOrEqual(session.begun, 1)
        // The same step with nothing refusing after it keeps the output: the undo runs only on a throw.
        try Camera.configure(session) { rollback in
            try Camera.installOutput(output, into: session, rollback)
        }
        XCTAssertEqual(session.outputs.count, 1, "a completing install lost its output")
    }
}

final class CameraRotationTests: XCTestCase {
    /// The table is Apple's for the enum it retired, the sensor's offset shifts it by a turn's
    /// fraction, and an external camera is never turned (AVCaptureDevice.h: its mounting is unknown).
    func testTheInterfaceTableIsApplesAndTheOffsetAndExternalCorrectIt() {
        XCTAssertEqual(InterfaceOrientation.portrait.captureAngle, 90)
        XCTAssertEqual(InterfaceOrientation.portraitUpsideDown.captureAngle, 270)
        XCTAssertEqual(InterfaceOrientation.landscapeLeft.captureAngle, 180)
        XCTAssertEqual(InterfaceOrientation.landscapeRight.captureAngle, 0)
        XCTAssertEqual(Camera.captureAngle(.portrait, sensorOffset: 0, external: false), 90)
        XCTAssertEqual(Camera.captureAngle(.portrait, sensorOffset: 180, external: false), 270, "the Spring-2024 iPads' front camera")
        XCTAssertEqual(Camera.captureAngle(.landscapeLeft, sensorOffset: 180, external: false), 0, "wrapped past a turn")
        XCTAssertEqual(Camera.captureAngle(.portrait, sensorOffset: 180, external: true), 0, "an external camera is not turned")
    }

    /// An angle the connection does not support is a refusal naming the angle, and nothing is set;
    /// one it supports is set. Until 2026-09-21 the unsupported case was silence, and the scan read
    /// sideways frames (audit finding 102).
    func testAnUnsupportedAngleIsRefusedByNameAndASupportedOneIsSet() {
        let connection = FakeConnection(supporting: [0, 180])
        XCTAssertThrowsError(try Camera.rotate(connection, to: 90)) { error in
            let said = "\(error)"
            XCTAssertTrue(said.contains("90"), "the refusal does not name the angle: \(said)")
            XCTAssertTrue(said.contains("capture:"), "not a capture error: \(said)")
        }
        XCTAssertEqual(connection.videoRotationAngle, 0, "a refused angle was set anyway")
        XCTAssertNoThrow(try Camera.rotate(connection, to: 180))
        XCTAssertEqual(connection.videoRotationAngle, 180, "a supported angle was not set")
    }

    /// Following the interface: every turn the host reports is applied to the connection; one the
    /// connection refuses is recorded as a fault naming the angle, so the scan ends with the reason
    /// rather than reading frames turned the wrong way.
    func testFollowingTheInterfaceAppliesEachTurnAndRecordsARefusalAsAFault() {
        let source = DrivenOrientation()
        let camera = Camera(orientationSource: source)
        let generation = camera.openForTests(label: "iPad")
        let connection = FakeConnection(supporting: [0, 90])
        var applied: [InterfaceOrientation] = []
        camera.followRotation(from: source, generation: generation) { orientation in
            applied.append(orientation)
            try Camera.rotate(connection, to: orientation.captureAngle)
        }
        camera.injectForTests(frame)
        source.turn(.landscapeRight)
        XCTAssertEqual(applied, [.landscapeRight])
        XCTAssertEqual(connection.videoRotationAngle, 0)
        guard case .frame = camera.latestFrame() else { return XCTFail("a turn the connection took ended the scan") }
        source.turn(.landscapeLeft)
        guard case .stopped(let reason) = camera.latestFrame() else { return XCTFail("a turn the connection refused was not a fault") }
        XCTAssertTrue(reason.contains("180"), "the fault does not name the angle: \(reason)")
    }

    /// A turn reported to an open that has ended — the observation raced the close — says nothing
    /// about the open that replaced it.
    func testATurnReportedAfterTheOpenEndedSaysNothing() {
        let source = DrivenOrientation()
        let camera = Camera(orientationSource: source)
        let first = camera.openForTests(label: "first")
        var applied = 0
        camera.followRotation(from: source, generation: first) { _ in
            applied += 1
            throw Refused()
        }
        camera.openForTests(label: "second")
        camera.injectForTests(frame)
        source.turn(.landscapeLeft)
        XCTAssertEqual(applied, 0, "the first open's rotation was applied to the second")
        guard case .frame = camera.latestFrame() else { return XCTFail("a stale turn's refusal faulted the next open") }
    }
}

final class CameraLifecycleTests: XCTestCase {
    /// A disconnect reported for the camera the last open opened, arriving after the next open —
    /// the notification was in flight — does not fault the camera now open, and the label is the
    /// one captured at the time, never the current one (audit finding 43).
    func testALateDisconnectFromTheLastCameraDoesNotFaultTheNext() {
        let camera = Camera(orientationSource: nil)
        let a = camera.openForTests(label: "A")
        let b = camera.openForTests(label: "B")
        camera.injectForTests(frame)
        camera.deviceWasDisconnected(label: "A", generation: a)
        guard case .frame = camera.latestFrame() else { return XCTFail("camera A's late disconnect faulted camera B") }
        XCTAssertEqual(camera.current?.label, "B")
        camera.deviceWasDisconnected(label: "B", generation: b)
        guard case .stopped(let reason) = camera.latestFrame() else { return XCTFail("camera B's own disconnect was not a fault") }
        XCTAssertTrue(reason.contains("camera B was disconnected"), reason)
        // The first reason is kept; a later report for the same open does not rewrite it.
        camera.deviceWasDisconnected(label: "B again", generation: b)
        guard case .stopped(let kept) = camera.latestFrame() else { return XCTFail("the fault was lost") }
        XCTAssertEqual(kept, reason)
    }

    /// A frame published under a generation that is no longer live — a sample callback still queued
    /// when the open ended — is dropped, not served as the next camera's picture; after `close()`
    /// nothing is served at all.
    func testAFramePublishedUnderAnEndedGenerationIsDropped() {
        let camera = Camera(orientationSource: nil)
        let a = camera.openForTests(label: "A")
        let b = camera.openForTests(label: "B")
        camera.injectForTests(frame, generation: a)
        guard case .none = camera.latestFrame() else { return XCTFail("camera A's queued frame was served as camera B's") }
        camera.injectForTests(frame)
        guard case .frame = camera.latestFrame() else { return XCTFail("camera B's own frame was not served") }
        camera.close()
        XCTAssertNil(camera.current)
        camera.injectForTests(frame, generation: b)
        guard case .none = camera.latestFrame() else { return XCTFail("a closed camera served a frame") }
    }

    /// An interruption is a state, not a dropped frame: a frame published while it lasts — a sample
    /// callback that was already queued when the OS spoke — is not served, and frames are served
    /// again only once `AVCaptureSessionInterruptionEnded` arrives (audit finding 45).
    func testAFramePublishedDuringAnInterruptionIsNotServedUntilItEnds() {
        let camera = Camera(orientationSource: nil)
        camera.openForTests()
        camera.injectForTests(frame)
        let center = NotificationCenter.default
        center.post(name: .AVCaptureSessionWasInterrupted, object: camera.sessionForTests)
        guard case .none = camera.latestFrame() else { return XCTFail("an interrupted session served its last frame") }
        camera.injectForTests(frame)
        guard case .none = camera.latestFrame() else { return XCTFail("a frame published during the interruption was served") }
        center.post(name: .AVCaptureSessionInterruptionEnded, object: camera.sessionForTests)
        guard case .none = camera.latestFrame() else { return XCTFail("the interruption's end served a frame published during it") }
        camera.injectForTests(frame)
        guard case .frame = camera.latestFrame() else { return XCTFail("a frame after the interruption ended was not served") }
        // Another camera's session says nothing about this one.
        let other = Camera(orientationSource: nil)
        center.post(name: .AVCaptureSessionWasInterrupted, object: other.sessionForTests)
        guard case .frame = camera.latestFrame() else { return XCTFail("another session's interruption paused this camera") }
    }

    /// A stopped camera stays stopped through an interruption and its end: the fault is the answer.
    func testAnInterruptionDoesNotUnstopAStoppedCamera() {
        let camera = Camera(orientationSource: nil)
        let generation = camera.openForTests(label: "gone")
        camera.deviceWasDisconnected(label: "gone", generation: generation)
        let center = NotificationCenter.default
        center.post(name: .AVCaptureSessionWasInterrupted, object: camera.sessionForTests)
        center.post(name: .AVCaptureSessionInterruptionEnded, object: camera.sessionForTests)
        camera.injectForTests(frame)
        guard case .stopped = camera.latestFrame() else { return XCTFail("an interruption un-stopped a stopped camera") }
    }
}
