/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import CoreBluetooth
import Foundation

enum BLETransport {
    static let serviceUUID = CBUUID(string: "45C7158E-0C3B-4E90-A847-452A15B14191")
    static let commandCharacteristicUUID = CBUUID(string: "46C7158E-0C3B-4E90-A847-452A15B14191")
    static let notifyCharacteristicUUID = CBUUID(string: "47C7158E-0C3B-4E90-A847-452A15B14191")

    static func sessionKey(for peripheral: CBPeripheral) -> String {
        "ble:\(peripheral.identifier.uuidString)"
    }

    static func displayName(
        peripheral: CBPeripheral,
        advertisementData: [String: Any]
    ) -> String {
        let advertisedName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        return peripheral.name ?? advertisedName ?? "EMWaver BLE"
    }

    static func matchesAdvertisementName(
        peripheral: CBPeripheral,
        advertisementData: [String: Any]
    ) -> Bool {
        let advertisedName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        let name = peripheral.name ?? advertisedName ?? ""
        return name.localizedCaseInsensitiveContains("emwaver") || advertisedName != nil
    }

    static func writeSysex(
        _ sysex: Data,
        peripheral: CBPeripheral,
        characteristic: CBCharacteristic
    ) {
        let maxWriteLength = max(20, peripheral.maximumWriteValueLength(for: .withResponse))
        var offset = 0
        while offset < sysex.count {
            let end = min(offset + maxWriteLength, sysex.count)
            let chunk = sysex.subdata(in: offset..<end)
            peripheral.writeValue(chunk, for: characteristic, type: .withResponse)
            offset = end
        }
    }
}
