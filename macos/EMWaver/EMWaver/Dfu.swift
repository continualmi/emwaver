import Foundation
import IOKit
import IOKit.usb.IOUSBLib

// Minimal STM32 ROM DFU implementation (0483:DF11) using IOUSBLib.
// Mirrors the sequencing in crates/emwaver-dfu (Rust):
// - DFU_GETSTATUS/CLRSTATUS polling
// - Mass erase (DNLOAD 0, [0x41])
// - Set address pointer (DNLOAD 0, [0x21, addrLE])
// - Write blocks (DNLOAD blockNum, data)
// - Verify blocks (UPLOAD blockNum)
//
// Notes:
// - This is intentionally narrow: one VID/PID, DFU class interface.
// - IOUSBLib is legacy but works without bundling extra native deps.

final class Dfu: @unchecked Sendable {
    static let vendorId: Int32 = 0x0483
    static let productId: Int32 = 0xDF11

    // DFU class requests
    private static let DFU_DNLOAD: UInt8 = 0x01
    private static let DFU_UPLOAD: UInt8 = 0x02
    private static let DFU_GETSTATUS: UInt8 = 0x03
    private static let DFU_CLRSTATUS: UInt8 = 0x04
    private static let DFU_ABORT: UInt8 = 0x06

    // DFU states
    private static let STATE_DFU_IDLE: UInt8 = 0x02
    private static let STATE_DFU_DNLOAD_SYNC: UInt8 = 0x03
    private static let STATE_DFU_DNBUSY: UInt8 = 0x04
    private static let STATE_DFU_DNLOAD_IDLE: UInt8 = 0x05
    private static let STATE_DFU_UPLOAD_IDLE: UInt8 = 0x09
    private static let STATE_DFU_ERROR: UInt8 = 0x0A
    private static let STATE_DFU_MANIFEST_SYNC: UInt8 = 0x06
    private static let STATE_DFU_MANIFEST: UInt8 = 0x07
    private static let STATE_DFU_MANIFEST_WAIT_RESET: UInt8 = 0x08

    static let blockSize: Int = 2048

    enum DfuError: LocalizedError {
        case notFound
        case openFailed(kern_return_t)
        case usbError(kern_return_t, String)
        case timeout(String)
        case protocolError(String)

        var errorDescription: String? {
            switch self {
            case .notFound:
                return "No DFU device found (0483:DF11)."
            case .openFailed(let kr):
                return "Failed to open DFU device (kern_return_t=\(kr))."
            case .usbError(let kr, let msg):
                return "USB error: \(msg) (kern_return_t=\(kr))."
            case .timeout(let msg):
                return "Timeout: \(msg)"
            case .protocolError(let msg):
                return "DFU protocol error: \(msg)"
            }
        }
    }

    // MARK: - Public API

    static func isConnected() -> Bool {
        (try? findFirstDevice()) != nil
    }

    static func openFirst() throws -> Dfu {
        let service = try findFirstDevice()
        return try Dfu(service: service)
    }

    func close() {
        if let intf = interface {
            _ = intf.pointee.USBInterfaceClose(intf)
            _ = intf.pointee.Release(intf)
        }
        if let dev = device {
            _ = dev.pointee.USBDeviceClose(dev)
            _ = dev.pointee.Release(dev)
        }
        interface = nil
        device = nil
        service = 0
    }

    deinit { close() }

    func flash(
        firmware: Data,
        address: UInt32,
        onProgress: @escaping (String, Double) -> Void
    ) throws {
        // Clear any prior error state best-effort.
        try? clearStatus()

        let totalBlocks = Int(ceil(Double(firmware.count) / Double(Self.blockSize)))
        let totalSteps = max(1, totalBlocks * 2 + 2)
        var step = 0
        func emit(_ msg: String) {
            let pct = min(100.0, (Double(step) * 100.0) / Double(totalSteps))
            onProgress(msg, pct)
        }

        emit("Starting mass erase...")
        try massErase()
        step += 1
        emit("Mass erase complete. Setting address pointer...")
        try setAddressPointer(address)
        step += 1
        emit("Address pointer set. Starting flash write...")

        var blockNum: UInt16 = 2
        var readBuf = [UInt8](repeating: 0, count: Self.blockSize)

        firmware.withUnsafeBytes { _ in }
        let bytes = [UInt8](firmware)

        for blockIndex in 0..<totalBlocks {
            let start = blockIndex * Self.blockSize
            let len = min(Self.blockSize, bytes.count - start)
            let chunk = Array(bytes[start..<(start + len)])

            emit("Writing block \(blockNum) (\(blockIndex + 1)/\(totalBlocks))...")
            try writeBlock(blockNum: blockNum, data: chunk)
            step += 1

            emit("Verifying block \(blockNum) (\(blockIndex + 1)/\(totalBlocks))...")
            try waitUploadIdle()
            let n = try readBlock(blockNum: blockNum, out: &readBuf, count: len)
            if n != len {
                throw DfuError.protocolError("Verification failed for block \(blockNum): read \(n) bytes, expected \(len)")
            }
            if !zip(readBuf.prefix(len), chunk).allSatisfy({ $0 == $1 }) {
                throw DfuError.protocolError("Error verifying block \(blockNum - 2)")
            }
            step += 1
            blockNum &+= 1
        }

        step = totalSteps
        emit("Flash write completed successfully.")
    }

    // MARK: - Internals

    private var service: io_service_t = 0
    private var device: UnsafeMutablePointer<IOUSBDeviceInterface320>? = nil
    private var interface: UnsafeMutablePointer<IOUSBInterfaceInterface300>? = nil
    private var interfaceNumber: UInt8 = 0

    private init(service: io_service_t) throws {
        self.service = service
        try openDeviceAndInterface(service: service)
    }

    private static func findFirstDevice() throws -> io_service_t {
        guard let matching = IOServiceMatching(kIOUSBDeviceClassName) else {
            throw DfuError.protocolError("IOServiceMatching returned nil")
        }
        let dict = matching as NSMutableDictionary
        dict[kUSBVendorID] = vendorId
        dict[kUSBProductID] = productId

        var iterator: io_iterator_t = 0
        let kr = IOServiceGetMatchingServices(kIOMasterPortDefault, dict, &iterator)
        guard kr == KERN_SUCCESS else { throw DfuError.usbError(kr, "IOServiceGetMatchingServices") }
        defer { IOObjectRelease(iterator) }

        let service = IOIteratorNext(iterator)
        guard service != 0 else { throw DfuError.notFound }
        // Caller owns service.
        return service
    }

    private func openDeviceAndInterface(service: io_service_t) throws {
        defer { IOObjectRelease(service) }

        var plugIn: UnsafeMutablePointer<IOCFPlugInInterface>? = nil
        var score: Int32 = 0
        var kr = IOCreatePlugInInterfaceForService(
            service,
            kIOUSBDeviceUserClientTypeID,
            kIOCFPlugInInterfaceID,
            &plugIn,
            &score
        )
        guard kr == KERN_SUCCESS, let plugIn else {
            throw DfuError.openFailed(kr)
        }
        defer { _ = plugIn.pointee.Release(plugIn) }

        var devPtr: UnsafeMutablePointer<IOUSBDeviceInterface320>? = nil
        kr = withUnsafeMutablePointer(to: &devPtr) { devPtrPtr in
            let iid = CFUUIDGetUUIDBytes(kIOUSBDeviceInterfaceID320)
            return plugIn.pointee.QueryInterface(plugIn, iid, UnsafeMutableRawPointer(devPtrPtr).assumingMemoryBound(to: UnsafeMutableRawPointer?.self))
        }
        guard kr == KERN_SUCCESS, let devPtr else {
            throw DfuError.openFailed(kr)
        }
        self.device = devPtr

        kr = devPtr.pointee.USBDeviceOpen(devPtr)
        guard kr == KERN_SUCCESS else {
            throw DfuError.openFailed(kr)
        }

        // Discover first DFU interface (class 0xFE, subclass 0x01).
        // We do a simple scan over interfaces and open the first DFU one.
        var request = IOUSBFindInterfaceRequest(
            bInterfaceClass: UInt16(kUSBApplicationSpecificClass),
            bInterfaceSubClass: UInt16(0x01),
            bInterfaceProtocol: UInt16(kIOUSBFindInterfaceDontCare),
            bAlternateSetting: UInt16(kIOUSBFindInterfaceDontCare)
        )

        var iter: io_iterator_t = 0
        kr = devPtr.pointee.CreateInterfaceIterator(devPtr, &request, &iter)
        guard kr == KERN_SUCCESS else {
            throw DfuError.usbError(kr, "CreateInterfaceIterator")
        }
        defer { IOObjectRelease(iter) }

        let ifaceService = IOIteratorNext(iter)
        guard ifaceService != 0 else {
            throw DfuError.protocolError("No DFU interface found")
        }
        defer { IOObjectRelease(ifaceService) }

        var ifPlug: UnsafeMutablePointer<IOCFPlugInInterface>? = nil
        var ifScore: Int32 = 0
        kr = IOCreatePlugInInterfaceForService(
            ifaceService,
            kIOUSBInterfaceUserClientTypeID,
            kIOCFPlugInInterfaceID,
            &ifPlug,
            &ifScore
        )
        guard kr == KERN_SUCCESS, let ifPlug else {
            throw DfuError.openFailed(kr)
        }
        defer { _ = ifPlug.pointee.Release(ifPlug) }

        var intfPtr: UnsafeMutablePointer<IOUSBInterfaceInterface300>? = nil
        kr = withUnsafeMutablePointer(to: &intfPtr) { intfPtrPtr in
            let iid = CFUUIDGetUUIDBytes(kIOUSBInterfaceInterfaceID300)
            return ifPlug.pointee.QueryInterface(ifPlug, iid, UnsafeMutableRawPointer(intfPtrPtr).assumingMemoryBound(to: UnsafeMutableRawPointer?.self))
        }
        guard kr == KERN_SUCCESS, let intfPtr else {
            throw DfuError.openFailed(kr)
        }
        self.interface = intfPtr

        kr = intfPtr.pointee.USBInterfaceOpen(intfPtr)
        guard kr == KERN_SUCCESS else {
            throw DfuError.openFailed(kr)
        }

        var ifaceNum: UInt8 = 0
        _ = intfPtr.pointee.GetInterfaceNumber(intfPtr, &ifaceNum)
        self.interfaceNumber = ifaceNum

        // If we start in dfuERROR, clear it once (best-effort).
        if let st = try? getStatus(), st.count >= 5, st[4] == Self.STATE_DFU_ERROR {
            _ = try? clearStatus()
        }
    }

    private func bwPollTimeoutMs(_ status: [UInt8]) -> Int {
        guard status.count >= 4 else { return 0 }
        let v = (UInt32(status[3]) << 16) | (UInt32(status[2]) << 8) | UInt32(status[1])
        return Int(v)
    }

    private func formatStatus(_ st: [UInt8]) -> String {
        if st.count < 6 { return "<short status len=\(st.count)>" }
        return String(format: "bStatus=0x%02X bState=0x%02X bwPollTimeout=%d iString=%d", st[0], st[4], bwPollTimeoutMs(st), st[5])
    }

    private func controlOut(request: UInt8, value: UInt16, data: [UInt8], timeoutMs: UInt32) throws {
        guard let intf = interface else { throw DfuError.protocolError("No DFU interface") }

        var req = IOUSBDevRequest(
            bmRequestType: 0x21, // Class | Interface | Host->Device
            bRequest: request,
            wValue: value,
            wIndex: UInt16(interfaceNumber),
            wLength: UInt16(data.count),
            pData: nil,
            wLenDone: 0
        )

        var buffer = data
        return try buffer.withUnsafeMutableBytes { raw in
            req.pData = raw.baseAddress
            let kr = intf.pointee.ControlRequest(intf, 0, &req)
            if kr != KERN_SUCCESS {
                throw DfuError.usbError(kr, "ControlRequest OUT req=0x\(String(format: "%02X", request)) value=0x\(String(format: "%04X", value))")
            }
        }
    }

    private func controlIn(request: UInt8, value: UInt16, length: Int, timeoutMs: UInt32) throws -> [UInt8] {
        guard let intf = interface else { throw DfuError.protocolError("No DFU interface") }

        var out = [UInt8](repeating: 0, count: length)
        var req = IOUSBDevRequest(
            bmRequestType: 0xA1, // Class | Interface | Device->Host
            bRequest: request,
            wValue: value,
            wIndex: UInt16(interfaceNumber),
            wLength: UInt16(length),
            pData: nil,
            wLenDone: 0
        )

        try out.withUnsafeMutableBytes { raw in
            req.pData = raw.baseAddress
            let kr = intf.pointee.ControlRequest(intf, 0, &req)
            if kr != KERN_SUCCESS {
                throw DfuError.usbError(kr, "ControlRequest IN req=0x\(String(format: "%02X", request)) value=0x\(String(format: "%04X", value))")
            }
        }

        return out
    }

    private func getStatus() throws -> [UInt8] {
        try controlIn(request: Self.DFU_GETSTATUS, value: 0, length: 6, timeoutMs: 500)
    }

    private func clearStatus() throws {
        try controlOut(request: Self.DFU_CLRSTATUS, value: 0, data: [], timeoutMs: 500)
    }

    private func abort() throws {
        try controlOut(request: Self.DFU_ABORT, value: 0, data: [], timeoutMs: 500)
    }

    private func waitDownloadIdle(timeout: TimeInterval = 5.0) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while true {
            let st = try getStatus()
            let state = st[4]
            if state == Self.STATE_DFU_IDLE || state == Self.STATE_DFU_DNLOAD_IDLE {
                return
            }
            if Date() > deadline {
                throw DfuError.timeout("waiting for download idle (status=\(formatStatus(st)))")
            }
            // Best-effort recovery if we're in error.
            if state == Self.STATE_DFU_ERROR {
                _ = try? clearStatus()
            }
            Thread.sleep(forTimeInterval: 0.05)
        }
    }

    private func waitUploadIdle(timeout: TimeInterval = 5.0) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while true {
            let st = try getStatus()
            let state = st[4]
            if state == Self.STATE_DFU_IDLE || state == Self.STATE_DFU_UPLOAD_IDLE {
                return
            }
            if Date() > deadline {
                throw DfuError.timeout("waiting for upload idle (status=\(formatStatus(st)))")
            }
            if state == Self.STATE_DFU_ERROR {
                _ = try? clearStatus()
            }
            Thread.sleep(forTimeInterval: 0.05)
        }
    }

    private func massErase() throws {
        // Best-effort: retry once with abort/clear if needed, like Rust.
        do {
            try massEraseOnce()
        } catch {
            _ = try? abort()
            _ = try? clearStatus()
            _ = try? waitDownloadIdle(timeout: 5.0)
            try massEraseOnce()
        }
    }

    private func massEraseOnce() throws {
        try waitDownloadIdle(timeout: 5.0)
        try controlOut(request: Self.DFU_DNLOAD, value: 0, data: [0x41], timeoutMs: 500)

        let deadline = Date().addingTimeInterval(60.0)
        while true {
            let st = try getStatus()
            let bStatus = st[0]
            let state = st[4]

            if bStatus != 0x00 || state == Self.STATE_DFU_ERROR {
                throw DfuError.protocolError("Mass erase failed (status=\(formatStatus(st)))")
            }

            switch state {
            case Self.STATE_DFU_IDLE, Self.STATE_DFU_DNLOAD_IDLE:
                return

            case Self.STATE_DFU_DNLOAD_SYNC, Self.STATE_DFU_DNBUSY,
                 Self.STATE_DFU_MANIFEST_SYNC, Self.STATE_DFU_MANIFEST, Self.STATE_DFU_MANIFEST_WAIT_RESET:
                if Date() > deadline {
                    throw DfuError.timeout("waiting for mass erase (status=\(formatStatus(st)))")
                }
                let sleepMs = max(10, bwPollTimeoutMs(st))
                Thread.sleep(forTimeInterval: Double(sleepMs) / 1000.0)

            default:
                throw DfuError.protocolError(String(format: "Mass erase failed (unexpected DFU state 0x%02X, status=%@)", state, formatStatus(st)))
            }
        }
    }

    private func setAddressPointer(_ address: UInt32) throws {
        try waitDownloadIdle(timeout: 5.0)
        let buf: [UInt8] = [
            0x21,
            UInt8(address & 0xFF),
            UInt8((address >> 8) & 0xFF),
            UInt8((address >> 16) & 0xFF),
            UInt8((address >> 24) & 0xFF),
        ]
        try controlOut(request: Self.DFU_DNLOAD, value: 0, data: buf, timeoutMs: 500)

        let deadline = Date().addingTimeInterval(5.0)
        while true {
            let st = try getStatus()
            let bStatus = st[0]
            let state = st[4]

            if bStatus != 0x00 || state == Self.STATE_DFU_ERROR {
                throw DfuError.protocolError("Set address pointer failed (status=\(formatStatus(st)))")
            }

            switch state {
            case Self.STATE_DFU_IDLE, Self.STATE_DFU_DNLOAD_IDLE:
                return
            case Self.STATE_DFU_DNLOAD_SYNC, Self.STATE_DFU_DNBUSY:
                if Date() > deadline {
                    throw DfuError.timeout("setting address pointer (status=\(formatStatus(st)))")
                }
                let sleepMs = max(10, bwPollTimeoutMs(st))
                Thread.sleep(forTimeInterval: Double(sleepMs) / 1000.0)
            default:
                throw DfuError.protocolError(String(format: "Set address pointer failed (unexpected DFU state 0x%02X, status=%@)", state, formatStatus(st)))
            }
        }
    }

    private func writeBlock(blockNum: UInt16, data: [UInt8]) throws {
        try waitDownloadIdle(timeout: 5.0)
        try controlOut(request: Self.DFU_DNLOAD, value: blockNum, data: data, timeoutMs: 3000)

        let deadline = Date().addingTimeInterval(5.0)
        while true {
            let st = try getStatus()
            let bStatus = st[0]
            let state = st[4]

            if bStatus != 0x00 || state == Self.STATE_DFU_ERROR {
                throw DfuError.protocolError("Write block \(blockNum) failed (status=\(formatStatus(st)))")
            }

            switch state {
            case Self.STATE_DFU_IDLE, Self.STATE_DFU_DNLOAD_IDLE:
                return
            case Self.STATE_DFU_DNLOAD_SYNC, Self.STATE_DFU_DNBUSY:
                if Date() > deadline {
                    throw DfuError.timeout("writing block \(blockNum) (status=\(formatStatus(st)))")
                }
                let sleepMs = max(10, bwPollTimeoutMs(st))
                Thread.sleep(forTimeInterval: Double(sleepMs) / 1000.0)
            default:
                throw DfuError.protocolError(String(format: "Write block failed (unexpected DFU state 0x%02X, status=%@)", state, formatStatus(st)))
            }
        }
    }

    private func readBlock(blockNum: UInt16, out: inout [UInt8], count: Int) throws -> Int {
        try waitUploadIdle(timeout: 5.0)
        let data = try controlIn(request: Self.DFU_UPLOAD, value: blockNum, length: count, timeoutMs: 3000)
        if out.count < count {
            out = [UInt8](repeating: 0, count: max(out.count, count))
        }
        for i in 0..<count { out[i] = data[i] }
        return data.count
    }
}
