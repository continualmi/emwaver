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

    final class ScanSession {
        private weak var central: CBCentralManager?
        private(set) var isScanning = false

        init(central: CBCentralManager) {
            self.central = central
        }

        func start() {
            guard !isScanning else { return }
            central?.scanForPeripherals(withServices: [BLETransport.serviceUUID], options: [
                CBCentralManagerScanOptionAllowDuplicatesKey: false
            ])
            isScanning = true
        }

        func stop() {
            guard isScanning else { return }
            central?.stopScan()
            isScanning = false
        }
    }

    struct PendingConnection {
        let peripheral: CBPeripheral
        let displayName: String

        var sessionKey: String {
            BLETransport.sessionKey(for: peripheral)
        }

        func matches(_ peripheral: CBPeripheral) -> Bool {
            self.peripheral.identifier == peripheral.identifier
        }
    }

    struct Connection: TransportDeviceConnection {
        let peripheral: CBPeripheral
        let commandCharacteristic: CBCharacteristic
        let notifyCharacteristic: CBCharacteristic?
        let sessionKey: String
        let displayName: String
        let session: TransportDeviceSession

        init(
            pending: PendingConnection,
            commandCharacteristic: CBCharacteristic,
            notifyCharacteristic: CBCharacteristic?,
            session: TransportDeviceSession? = nil
        ) {
            self.peripheral = pending.peripheral
            self.commandCharacteristic = commandCharacteristic
            self.notifyCharacteristic = notifyCharacteristic
            self.sessionKey = pending.sessionKey
            self.displayName = pending.displayName
            self.session = session ?? DeviceBufferSession()
        }

        func matches(_ peripheral: CBPeripheral) -> Bool {
            self.peripheral.identifier == peripheral.identifier
        }

        func writeSysex(_ sysex: Data) {
            BLETransport.writeSysex(sysex, peripheral: peripheral, characteristic: commandCharacteristic)
        }
    }

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

    static func pendingConnection(
        peripheral: CBPeripheral,
        advertisementData: [String: Any]
    ) -> PendingConnection {
        PendingConnection(
            peripheral: peripheral,
            displayName: displayName(peripheral: peripheral, advertisementData: advertisementData)
        )
    }

    static func matchesAdvertisementName(
        peripheral: CBPeripheral,
        advertisementData: [String: Any]
    ) -> Bool {
        let advertisedName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        let name = peripheral.name ?? advertisedName ?? ""
        return name.localizedCaseInsensitiveContains("emwaver") || advertisedName != nil
    }

    static func connect(_ pending: PendingConnection, using central: CBCentralManager, delegate: CBPeripheralDelegate) {
        pending.peripheral.delegate = delegate
        central.connect(pending.peripheral)
    }

    static func cancel(_ connection: Connection, using central: CBCentralManager?) {
        central?.cancelPeripheralConnection(connection.peripheral)
    }

    static func cancel(_ pending: PendingConnection, using central: CBCentralManager?) {
        central?.cancelPeripheralConnection(pending.peripheral)
    }

    static func closeHandles(
        scanSession: ScanSession?,
        connection: Connection?,
        pendingConnection: PendingConnection?,
        using central: CBCentralManager?
    ) {
        scanSession?.stop()
        if let connection {
            cancel(connection, using: central)
        } else if let pendingConnection {
            cancel(pendingConnection, using: central)
        }
    }

    static func discoverServices(on peripheral: CBPeripheral) {
        peripheral.discoverServices([serviceUUID])
    }

    static func service(on peripheral: CBPeripheral) -> CBService? {
        peripheral.services?.first { $0.uuid == serviceUUID }
    }

    static func discoverCharacteristics(on peripheral: CBPeripheral, for service: CBService) {
        peripheral.discoverCharacteristics([
            commandCharacteristicUUID,
            notifyCharacteristicUUID
        ], for: service)
    }

    static func characteristics(in service: CBService) -> (command: CBCharacteristic?, notify: CBCharacteristic?) {
        var command: CBCharacteristic?
        var notify: CBCharacteristic?
        for characteristic in service.characteristics ?? [] {
            if characteristic.uuid == commandCharacteristicUUID {
                command = characteristic
            } else if characteristic.uuid == notifyCharacteristicUUID {
                notify = characteristic
            }
        }
        return (command, notify)
    }

    static func enableNotifications(on peripheral: CBPeripheral, characteristic: CBCharacteristic?) {
        guard let characteristic else { return }
        peripheral.setNotifyValue(true, for: characteristic)
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
