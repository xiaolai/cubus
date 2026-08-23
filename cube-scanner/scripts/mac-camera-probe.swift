// mac-camera-probe: dump what every camera on this Mac ACTUALLY supports, per AVFoundation.
//
// Purpose: the scanner needs to know, per machine, (a) whether a camera can focus at all
// (most built-in Mac cameras are fixed-focus), (b) how close it can focus (a cube held
// 20 cm away is useless if the minimum focus distance is 30 cm), (c) whether focus can be
// aimed at a REGION (focusPointOfInterest — "autofocus on the cube"), and (d) whether a
// Continuity Camera exposes a companion Desk View camera (the only OS-provided way to see
// the desk instead of the user's face).
//
// This only enumerates and reads capability flags — it never opens a session, so it does
// not trigger the camera permission prompt and no LED turns on.
//
// Usage: swiftc -O -o mac-camera-probe mac-camera-probe.swift && ./mac-camera-probe
// Output: one JSON object on stdout.

import AVFoundation
import Foundation

func focusModes(_ d: AVCaptureDevice) -> [String] {
    var out: [String] = []
    if d.isFocusModeSupported(.locked) { out.append("locked") }
    if d.isFocusModeSupported(.autoFocus) { out.append("autoFocus") }
    if d.isFocusModeSupported(.continuousAutoFocus) { out.append("continuousAutoFocus") }
    return out
}

func exposureModes(_ d: AVCaptureDevice) -> [String] {
    var out: [String] = []
    if d.isExposureModeSupported(.locked) { out.append("locked") }
    if d.isExposureModeSupported(.autoExpose) { out.append("autoExpose") }
    if d.isExposureModeSupported(.continuousAutoExposure) { out.append("continuousAutoExposure") }
    return out
}

func whiteBalanceModes(_ d: AVCaptureDevice) -> [String] {
    var out: [String] = []
    if d.isWhiteBalanceModeSupported(.locked) { out.append("locked") }
    if d.isWhiteBalanceModeSupported(.autoWhiteBalance) { out.append("autoWhiteBalance") }
    if d.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) {
        out.append("continuousAutoWhiteBalance")
    }
    return out
}

/// Distinct resolutions the device offers, with the max frame rate for each.
func formats(_ d: AVCaptureDevice) -> [[String: Any]] {
    var seen = Set<String>()
    var out: [[String: Any]] = []
    for f in d.formats {
        let dim = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
        let fps = f.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 0
        let key = "\(dim.width)x\(dim.height)"
        if seen.insert(key).inserted {
            out.append([
                "size": key,
                "aspect": String(format: "%.3f", Double(dim.width) / Double(max(dim.height, 1))),
                "maxFps": Int(fps.rounded()),
            ])
        }
    }
    return out
}

func describe(_ d: AVCaptureDevice) -> [String: Any] {
    let active = CMVideoFormatDescriptionGetDimensions(d.activeFormat.formatDescription)
    var info: [String: Any] = [
        "name": d.localizedName,
        "uniqueID": d.uniqueID,
        "modelID": d.modelID,
        "manufacturer": d.manufacturer,
        "deviceType": d.deviceType.rawValue,
        "isContinuityCamera": d.isContinuityCamera,
        "isConnected": d.isConnected,
        // -1 means "unknown"; otherwise millimetres — how close an object can be and still focus.
        "minimumFocusDistanceMm": d.minimumFocusDistance,
        "focusModes": focusModes(d),
        "focusPointOfInterestSupported": d.isFocusPointOfInterestSupported,
        "exposureModes": exposureModes(d),
        "exposurePointOfInterestSupported": d.isExposurePointOfInterestSupported,
        "whiteBalanceModes": whiteBalanceModes(d),
        "activeFormat": "\(active.width)x\(active.height)",
        "formats": formats(d),
        "hasCompanionDeskViewCamera": d.companionDeskViewCamera != nil,
        "centerStageEnabled": AVCaptureDevice.isCenterStageEnabled,
        "centerStageActive": d.isCenterStageActive,
        "portraitEffectActive": d.isPortraitEffectActive,
    ]
    if let desk = d.companionDeskViewCamera {
        info["companionDeskViewCameraUniqueID"] = desk.uniqueID
    }
    return info
}

let types: [AVCaptureDevice.DeviceType] = [
    .builtInWideAngleCamera,
    .continuityCamera,
    .deskViewCamera,
    .external,
]
let session = AVCaptureDevice.DiscoverySession(
    deviceTypes: types, mediaType: .video, position: .unspecified)

let report: [String: Any] = [
    "macOS": ProcessInfo.processInfo.operatingSystemVersionString,
    "centerStageControlMode": AVCaptureDevice.centerStageControlMode.rawValue,
    "authorizationStatus": AVCaptureDevice.authorizationStatus(for: .video).rawValue,
    "devices": session.devices.map(describe),
]

let data = try JSONSerialization.data(
    withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)
