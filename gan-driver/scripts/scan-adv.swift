// scan-adv: BLE advertisement scanner that dumps ALL advertisement fields as JSON lines.
// Purpose: recover fields CoreBluetooth exposes but generic tools may omit —
// in particular kCBAdvDataManufacturerData, which GAN cubes use to broadcast
// their MAC address (needed for AES key/IV salting).
//
// Usage: swiftc -o scan-adv scan-adv.swift && ./scan-adv [seconds] [nameFilter]
// Output: one JSON object per advertisement event on stdout.

import Foundation
import CoreBluetooth

final class Scanner: NSObject, CBCentralManagerDelegate {
    let duration: TimeInterval
    let nameFilter: String?
    var central: CBCentralManager!

    init(duration: TimeInterval, nameFilter: String?) {
        self.duration = duration
        self.nameFilter = nameFilter
        super.init()
        central = CBCentralManager(delegate: self, queue: nil)
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard central.state == .poweredOn else {
            FileHandle.standardError.write("bluetooth state: \(central.state.rawValue) (need poweredOn=5)\n".data(using: .utf8)!)
            if central.state == .unauthorized || central.state == .unsupported || central.state == .poweredOff {
                exit(2)
            }
            return
        }
        FileHandle.standardError.write("scanning for \(duration)s...\n".data(using: .utf8)!)
        central.scanForPeripherals(withServices: nil,
                                   options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
        DispatchQueue.main.asyncAfter(deadline: .now() + duration) {
            self.central.stopScan()
            exit(0)
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = peripheral.name ?? (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? ""
        if let filter = nameFilter, !filter.isEmpty {
            if !name.lowercased().contains(filter.lowercased()) { return }
        }
        var obj: [String: Any] = [
            "ts": ISO8601DateFormatter().string(from: Date()),
            "id": peripheral.identifier.uuidString,
            "name": name,
            "rssi": RSSI.intValue,
        ]
        if let mfg = advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data {
            obj["manufacturerData"] = mfg.map { String(format: "%02x", $0) }.joined()
        }
        if let svcs = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] {
            obj["services"] = svcs.map { $0.uuidString }
        }
        if let svcData = advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data] {
            var m: [String: String] = [:]
            for (k, v) in svcData { m[k.uuidString] = v.map { String(format: "%02x", $0) }.joined() }
            obj["serviceData"] = m
        }
        if let txPower = advertisementData[CBAdvertisementDataTxPowerLevelKey] as? NSNumber {
            obj["txPower"] = txPower.intValue
        }
        if let connectable = advertisementData[CBAdvertisementDataIsConnectable] as? NSNumber {
            obj["connectable"] = connectable.boolValue
        }
        if let data = try? JSONSerialization.data(withJSONObject: obj),
           let line = String(data: data, encoding: .utf8) {
            print(line)
            fflush(stdout)
        }
    }
}

let args = CommandLine.arguments
let seconds = args.count > 1 ? (TimeInterval(args[1]) ?? 15) : 15
let filter = args.count > 2 ? args[2] : nil
let scanner = Scanner(duration: seconds, nameFilter: filter)
RunLoop.main.run()
