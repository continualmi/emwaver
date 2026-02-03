import Foundation

// DFU implementation for STM32 ROM DFU (0483:DF11) backed by libusb (loaded dynamically).
// Mirrors crates/emwaver-dfu/src/lib.rs.

final class Dfu {
    static let vendorId: UInt16 = 0x0483
    static let productId: UInt16 = 0xDF11

    // Requests
    private static let DFU_DNLOAD: UInt8 = 0x01
    private static let DFU_UPLOAD: UInt8 = 0x02
    private static let DFU_GETSTATUS: UInt8 = 0x03
    private static let DFU_CLRSTATUS: UInt8 = 0x04
    private static let DFU_ABORT: UInt8 = 0x06

    // States
    private static let STATE_DFU_IDLE: UInt8 = 0x02
    private static let STATE_DFU_DNLOAD_SYNC: UInt8 = 0x03
    private static let STATE_DFU_DOWNLOAD_BUSY: UInt8 = 0x04
    private static let STATE_DFU_DOWNLOAD_IDLE: UInt8 = 0x05
    private static let STATE_DFU_MANIFEST_SYNC: UInt8 = 0x06
    private static let STATE_DFU_MANIFEST: UInt8 = 0x07
    private static let STATE_DFU_MANIFEST_WAIT_RESET: UInt8 = 0x08
    private static let STATE_DFU_UPLOAD_IDLE: UInt8 = 0x09
    private static let STATE_DFU_ERROR: UInt8 = 0x0A

    private static let STATUS_OK: UInt8 = 0x00

    static let blockSize: Int = 2048

    enum DfuError: Error, CustomStringConvertible {
        case libusb(String)
        case notFound
        case openFailed
        case protocolError(String)
        case timeout(String)

        var description: String {
            switch self {
            case .libusb(let s): return s
            case .notFound: return "No DFU device found (0483:DF11)."
            case .openFailed: return "Failed to open DFU device (0483:DF11)."
            case .protocolError(let s): return "DFU protocol error: \(s)"
            case .timeout(let s): return "Timeout: \(s)"
            }
        }
    }

    static func isConnected() -> Bool {
        do {
            let lib = try Libusb()
            var ctx: Libusb.libusb_context? = nil
            let rc = lib.libusb_init(&ctx)
            if rc != 0 { return false }
            defer { lib.libusb_exit(ctx) }
            let h = lib.libusb_open_device_with_vid_pid(ctx, vendorId, productId)
            if h != nil {
                lib.libusb_close(h)
                return true
            }
            return false
        } catch {
            return false
        }
    }

    static func openFirst() throws -> Dfu {
        let lib = try Libusb()
        var ctx: Libusb.libusb_context? = nil
        let rcInit = lib.libusb_init(&ctx)
        guard rcInit == 0 else { throw DfuError.libusb("libusb_init failed: \(rcInit)") }

        guard let handle = lib.libusb_open_device_with_vid_pid(ctx, Self.vendorId, Self.productId) else {
            lib.libusb_exit(ctx)
            throw DfuError.notFound
        }

        // Auto detach kernel driver where supported.
        _ = lib.libusb_set_auto_detach_kernel_driver(handle, 1)

        // STM32 ROM DFU typically uses interface 0. We can make this smarter later by scanning descriptors.
        let iface: Int32 = 0
        let rcClaim = lib.libusb_claim_interface(handle, iface)
        guard rcClaim == 0 else {
            lib.libusb_close(handle)
            lib.libusb_exit(ctx)
            throw DfuError.libusb("libusb_claim_interface(\(iface)) failed: \(rcClaim)")
        }

        let dfu = Dfu(lib: lib, ctx: ctx, handle: handle, interfaceNumber: UInt16(iface))

        // Best-effort clear error state like Rust.
        do {
            let st = try dfu.getStatus()
            if st.count >= 5, st[4] == STATE_DFU_ERROR {
                try? dfu.clearStatus()
            }
        } catch { }

        return dfu
    }

    private let lib: Libusb
    private var ctx: Libusb.libusb_context?
    private var handle: Libusb.libusb_device_handle?
    private let interfaceNumber: UInt16

    private init(lib: Libusb, ctx: Libusb.libusb_context?, handle: Libusb.libusb_device_handle, interfaceNumber: UInt16) {
        self.lib = lib
        self.ctx = ctx
        self.handle = handle
        self.interfaceNumber = interfaceNumber
    }

    func close() {
        if let h = handle {
            _ = lib.libusb_release_interface(h, Int32(interfaceNumber))
            lib.libusb_close(h)
        }
        handle = nil
        if let c = ctx {
            lib.libusb_exit(c)
        }
        ctx = nil
    }

    deinit { close() }

    // MARK: - DFU operations

    func flash(firmware: Data, address: UInt32, onProgress: @escaping (String, Double) -> Void) throws {
        try? clearStatus()

        let totalBlocks = Int(ceil(Double(firmware.count) / Double(Self.blockSize)))
        let totalSteps = max(1, totalBlocks * 2 + 2)
        var step: Int = 0
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

        let bytes = [UInt8](firmware)
        var blockNum: UInt16 = 2
        var readBuf = [UInt8](repeating: 0, count: Self.blockSize)

        for blockIndex in 0..<totalBlocks {
            let start = blockIndex * Self.blockSize
            let len = min(Self.blockSize, bytes.count - start)
            let chunk = Array(bytes[start..<(start + len)])

            emit("Writing block \(blockNum) (\(blockIndex + 1)/\(totalBlocks))...")
            try writeBlock(blockNum, chunk)
            step += 1

            emit("Verifying block \(blockNum) (\(blockIndex + 1)/\(totalBlocks))...")
            try waitUploadIdle()
            let n = try readBlock(blockNum, out: &readBuf, count: len)
            if n != len { throw DfuError.protocolError("Verification failed for block \(blockNum): read \(n) bytes, expected \(len)") }
            if !zip(readBuf.prefix(len), chunk).allSatisfy({ $0 == $1 }) {
                throw DfuError.protocolError("Error verifying block \(blockNum - 2)")
            }

            step += 1
            blockNum &+= 1
        }

        step = totalSteps
        emit("Flash write completed successfully.")
    }

    private func pollTimeoutMs(_ status: [UInt8]) -> UInt32 {
        if status.count < 4 { return 0 }
        return (UInt32(status[3]) << 16) | (UInt32(status[2]) << 8) | UInt32(status[1])
    }

    private func formatStatus(_ st: [UInt8]) -> String {
        if st.count < 6 { return "<short status len=\(st.count)>" }
        return String(format: "bStatus=0x%02X bState=0x%02X bwPollTimeout=%u iString=%u", st[0], st[4], pollTimeoutMs(st), st[5])
    }

    private func controlOut(_ request: UInt8, _ value: UInt16, _ data: [UInt8], timeoutMs: UInt32) throws {
        guard let h = handle else { throw DfuError.openFailed }

        // bmRequestType: 0x21 = Host->Device | Class | Interface
        var tmp = data
        let rc: Int32 = tmp.withUnsafeMutableBufferPointer { buf in
            let p = buf.baseAddress
            return lib.libusb_control_transfer(h, 0x21, request, value, interfaceNumber, p, UInt16(tmp.count), timeoutMs)
        }
        if rc < 0 {
            throw DfuError.libusb("libusb_control_transfer(OUT req=0x\(String(format: "%02X", request)) value=0x\(String(format: "%04X", value))) failed: \(rc)")
        }
    }

    private func controlIn(_ request: UInt8, _ value: UInt16, _ length: Int, timeoutMs: UInt32) throws -> [UInt8] {
        guard let h = handle else { throw DfuError.openFailed }

        var out = [UInt8](repeating: 0, count: length)
        let rc: Int32 = out.withUnsafeMutableBufferPointer { buf in
            let p = buf.baseAddress
            return lib.libusb_control_transfer(h, 0xA1, request, value, interfaceNumber, p, UInt16(length), timeoutMs)
        }
        if rc < 0 {
            throw DfuError.libusb("libusb_control_transfer(IN req=0x\(String(format: "%02X", request)) value=0x\(String(format: "%04X", value))) failed: \(rc)")
        }
        // rc is number of bytes transferred
        let n = Int(rc)
        if n < out.count { out.removeSubrange(n..<out.count) }
        return out
    }

    private func getStatus() throws -> [UInt8] {
        try controlIn(Self.DFU_GETSTATUS, 0, 6, timeoutMs: 500)
    }

    private func clearStatus() throws {
        try controlOut(Self.DFU_CLRSTATUS, 0, [], timeoutMs: 500)
    }

    private func abort() throws {
        try controlOut(Self.DFU_ABORT, 0, [], timeoutMs: 500)
    }

    private func waitDownloadIdle(timeout: TimeInterval = 5.0) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while true {
            let st = try getStatus()
            let state = st.count >= 5 ? st[4] : 0
            if state == Self.STATE_DFU_IDLE || state == Self.STATE_DFU_DOWNLOAD_IDLE { return }
            if Date() > deadline {
                throw DfuError.timeout("waiting for download idle (status=\(formatStatus(st)))")
            }
            if state == Self.STATE_DFU_ERROR { try? clearStatus() }
            Thread.sleep(forTimeInterval: 0.05)
        }
    }

    private func waitUploadIdle(timeout: TimeInterval = 5.0) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while true {
            let st = try getStatus()
            let state = st.count >= 5 ? st[4] : 0
            if state == Self.STATE_DFU_IDLE || state == Self.STATE_DFU_UPLOAD_IDLE { return }
            if Date() > deadline {
                throw DfuError.timeout("waiting for upload idle (status=\(formatStatus(st)))")
            }
            if state == Self.STATE_DFU_ERROR { try? clearStatus() }
            Thread.sleep(forTimeInterval: 0.05)
        }
    }

    private func massErase() throws {
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
        try controlOut(Self.DFU_DNLOAD, 0, [0x41], timeoutMs: 50)

        let deadline = Date().addingTimeInterval(60.0)
        while true {
            let st = try getStatus()
            let bStatus = st[0]
            let state = st[4]

            if bStatus != Self.STATUS_OK || state == Self.STATE_DFU_ERROR {
                throw DfuError.protocolError("Mass erase failed (status=\(formatStatus(st)))")
            }

            switch state {
            case Self.STATE_DFU_IDLE, Self.STATE_DFU_DOWNLOAD_IDLE:
                return

            case Self.STATE_DFU_DNLOAD_SYNC, Self.STATE_DFU_DOWNLOAD_BUSY,
                 Self.STATE_DFU_MANIFEST_SYNC, Self.STATE_DFU_MANIFEST, Self.STATE_DFU_MANIFEST_WAIT_RESET:
                if Date() > deadline {
                    throw DfuError.timeout("waiting for mass erase (status=\(formatStatus(st)))")
                }
                let sleepMs = max(10, Int(pollTimeoutMs(st)))
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

        try controlOut(Self.DFU_DNLOAD, 0, buf, timeoutMs: 50)

        let deadline = Date().addingTimeInterval(5.0)
        while true {
            let st = try getStatus()
            let bStatus = st[0]
            let state = st[4]

            if bStatus != Self.STATUS_OK || state == Self.STATE_DFU_ERROR {
                throw DfuError.protocolError("Set address pointer failed (status=\(formatStatus(st)))")
            }

            switch state {
            case Self.STATE_DFU_IDLE, Self.STATE_DFU_DOWNLOAD_IDLE:
                return
            case Self.STATE_DFU_DNLOAD_SYNC, Self.STATE_DFU_DOWNLOAD_BUSY:
                if Date() > deadline {
                    throw DfuError.timeout("setting address pointer (status=\(formatStatus(st)))")
                }
                let sleepMs = max(10, Int(pollTimeoutMs(st)))
                Thread.sleep(forTimeInterval: Double(sleepMs) / 1000.0)
            default:
                throw DfuError.protocolError(String(format: "Set address pointer failed (unexpected DFU state 0x%02X, status=%@)", state, formatStatus(st)))
            }
        }
    }

    private func writeBlock(_ blockNum: UInt16, _ data: [UInt8]) throws {
        try waitDownloadIdle(timeout: 5.0)
        try controlOut(Self.DFU_DNLOAD, blockNum, data, timeoutMs: 500)

        let deadline = Date().addingTimeInterval(5.0)
        while true {
            let st = try getStatus()
            let bStatus = st[0]
            let state = st[4]

            if bStatus != Self.STATUS_OK || state == Self.STATE_DFU_ERROR {
                throw DfuError.protocolError("Write block \(blockNum) failed (status=\(formatStatus(st)))")
            }

            switch state {
            case Self.STATE_DFU_IDLE, Self.STATE_DFU_DOWNLOAD_IDLE:
                return
            case Self.STATE_DFU_DNLOAD_SYNC, Self.STATE_DFU_DOWNLOAD_BUSY:
                if Date() > deadline {
                    throw DfuError.timeout("writing block \(blockNum) (status=\(formatStatus(st)))")
                }
                let sleepMs = max(10, Int(pollTimeoutMs(st)))
                Thread.sleep(forTimeInterval: Double(sleepMs) / 1000.0)
            default:
                throw DfuError.protocolError(String(format: "Write block failed (unexpected DFU state 0x%02X, status=%@)", state, formatStatus(st)))
            }
        }
    }

    private func readBlock(_ blockNum: UInt16, out: inout [UInt8], count: Int) throws -> Int {
        try waitUploadIdle(timeout: 5.0)
        let data = try controlIn(Self.DFU_UPLOAD, blockNum, count, timeoutMs: 500)
        if out.count < count { out = [UInt8](repeating: 0, count: count) }
        for i in 0..<min(count, data.count) { out[i] = data[i] }
        return data.count
    }
}
