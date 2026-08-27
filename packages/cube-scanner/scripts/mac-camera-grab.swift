// mac-camera-grab: open ONE AVFoundation camera by name, grab a frame, write it as JPEG.
//
// Purpose: prove (or disprove) what a device actually delivers — in particular the
// Desk View camera, which macOS exposes to AVFoundation but Chromium does NOT enumerate,
// so it is invisible to getUserMedia/Electron. If a Swift sidecar can read it, the scanner
// can see the cube ON THE DESK instead of held up at the lens.
//
// Also reports mean luminance, so "did we get real pixels or a black frame?" is answered
// without anyone having to look at the image.
//
// Usage: swiftc -O -o mac-camera-grab mac-camera-grab.swift
//        ./mac-camera-grab "<name substring>" <out.jpg> [warmupSeconds] [WxH]
// Exits non-zero (and says why) when the device is missing or delivers no frame.

import AVFoundation
import CoreImage
import Foundation

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write(
        "usage: mac-camera-grab \"<name substring>\" <out.jpg> [warmupSeconds]\n".data(using: .utf8)!
    )
    exit(64)
}
let needle = args[1].lowercased()
let outPath = args[2]
let warmup = args.count > 3 ? (Double(args[3]) ?? 2.0) : 2.0
// Optional "WxH": pin the device to that capture format instead of the session preset.
// Aspect ratio is the whole point — a 4:3 or 1:1 format of the same sensor usually sees
// further DOWN than the 16:9 one, which is a vertical crop.
let wanted: (Int32, Int32)? = args.count > 4
    ? {
        let parts = args[4].lowercased().split(separator: "x")
        guard parts.count == 2, let w = Int32(parts[0]), let h = Int32(parts[1]) else { return nil }
        return (w, h)
    }() : nil

let types: [AVCaptureDevice.DeviceType] = [
    .builtInWideAngleCamera, .continuityCamera, .deskViewCamera, .external,
]
let devices = AVCaptureDevice.DiscoverySession(
    deviceTypes: types, mediaType: .video, position: .unspecified
).devices

// Match the uniqueID as well as the name. Two Studio Displays share one localizedName, so a
// name-only match can never reach the second of them — it silently returns the first and looks
// like it worked. The id is the only handle that is guaranteed to be unique.
let matches = devices.filter {
    $0.localizedName.lowercased().contains(needle) || $0.uniqueID.lowercased().contains(needle)
}
guard let device = matches.first else {
    let names = devices.map { "\($0.localizedName) [\($0.uniqueID)]" }.joined(separator: ", ")
    FileHandle.standardError.write("no device matching \"\(needle)\". have: \(names)\n".data(using: .utf8)!)
    exit(2)
}
if matches.count > 1 {
    // Ambiguity is reported, never resolved by silently taking the first.
    let ids = matches.map(\.uniqueID).joined(separator: ", ")
    let msg = "note: \(matches.count) devices match \"\(needle)\" — using \(device.uniqueID). "
        + "Pass an id to choose: \(ids)\n"
    FileHandle.standardError.write(msg.data(using: .utf8)!)
}

final class Sink: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let sem = DispatchSemaphore(value: 0)
    var buffer: CVPixelBuffer?
    // Skip the first frames: cameras deliver garbage/black while exposure settles.
    var skip = 10

    func captureOutput(
        _ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard buffer == nil else { return }
        if skip > 0 {
            skip -= 1
            return
        }
        guard let px = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        buffer = px
        sem.signal()
    }
}

let session = AVCaptureSession()
session.beginConfiguration()
// Only set a preset when we are NOT pinning a format: on macOS, assigning activeFormat
// switches the session to input priority by itself, and a preset would fight it.
if wanted == nil { session.sessionPreset = .high }
guard let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else {
    FileHandle.standardError.write("cannot open \(device.localizedName)\n".data(using: .utf8)!)
    exit(3)
}
session.addInput(input)
let output = AVCaptureVideoDataOutput()
output.alwaysDiscardsLateVideoFrames = true
// Force BGRA so the luminance sample below can assume 4 bytes per pixel.
output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
let sink = Sink()
// One serial queue owns every mutation of the sink's counters — the format switch below
// touches `skip` from the main thread, and that must not race the delegate callback.
let grabQueue = DispatchQueue(label: "grab")
output.setSampleBufferDelegate(sink, queue: grabQueue)
guard session.canAddOutput(output) else {
    FileHandle.standardError.write("cannot add output\n".data(using: .utf8)!)
    exit(3)
}
session.addOutput(output)
session.commitConfiguration()
session.startRunning()

// macOS has no AVCaptureSessionPresetInputPriority, so the session re-applies its preset
// over any activeFormat set before it starts. Pin the format AFTER startRunning, then let
// the sink resync (the skip counter drops the frames captured during the switch).
if let (w, h) = wanted {
    guard
        let fmt = device.formats.first(where: {
            let d = CMVideoFormatDescriptionGetDimensions($0.formatDescription)
            return d.width == w && d.height == h
        })
    else {
        let have = device.formats.map { f -> String in
            let d = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            return "\(d.width)x\(d.height)"
        }.joined(separator: " ")
        FileHandle.standardError.write("no \(w)x\(h) format. have: \(have)\n".data(using: .utf8)!)
        exit(6)
    }
    try device.lockForConfiguration()
    device.activeFormat = fmt
    device.unlockForConfiguration()
    let activeNow = CMVideoFormatDescriptionGetDimensions(device.activeFormat.formatDescription)
    FileHandle.standardError.write(
        "activeFormat=\(activeNow.width)x\(activeNow.height)\n".data(using: .utf8)!)
    grabQueue.sync { sink.skip = 20 }
}



let got = sink.sem.wait(timeout: .now() + warmup + 8.0)
session.stopRunning()
guard got == .success, let px = sink.buffer else {
    FileHandle.standardError.write("no frame from \(device.localizedName)\n".data(using: .utf8)!)
    exit(4)
}

let ci = CIImage(cvPixelBuffer: px)
let ctx = CIContext()
guard
    let jpeg = ctx.jpegRepresentation(
        of: ci, colorSpace: CGColorSpaceCreateDeviceRGB(), options: [:])
else {
    FileHandle.standardError.write("jpeg encode failed\n".data(using: .utf8)!)
    exit(5)
}
try jpeg.write(to: URL(fileURLWithPath: outPath))

// Sampling helper: step over the frame without importing anything heavier.
func stride_(_ from: Int, _ to: Int, _ by: Int) -> StrideTo<Int> { Swift.stride(from: from, to: to, by: by) }

// Mean luminance over the frame — a black/blank feed is the failure mode worth naming.
var mean: Double = 0
CVPixelBufferLockBaseAddress(px, .readOnly)
let w = CVPixelBufferGetWidth(px)
let h = CVPixelBufferGetHeight(px)
if let base = CVPixelBufferGetBaseAddress(px) {
    let stride = CVPixelBufferGetBytesPerRow(px)
    let bytes = base.assumingMemoryBound(to: UInt8.self)
    var sum = 0.0
    var n = 0.0
    for y in stride_(0, h, max(1, h / 64)) {
        for x in stride_(0, w, max(1, w / 64)) {
            sum += Double(bytes[y * stride + x * 4])
            n += 1
        }
    }
    mean = n > 0 ? sum / n : 0
}
CVPixelBufferUnlockBaseAddress(px, .readOnly)


print("device=\(device.localizedName) size=\(w)x\(h) meanChannel0=\(String(format: "%.1f", mean)) out=\(outPath)")
