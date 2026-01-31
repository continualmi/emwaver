import Foundation

#if canImport(Darwin)
import Darwin

public enum RustBufferCore {
    typealias LoadRxBytesFn = @convention(c) (UnsafePointer<UInt8>?, Int) -> Void
    typealias CompressDataBitsFn = @convention(c) (
        Int32,
        Int32,
        Int32,
        UnsafeMutablePointer<UnsafeMutablePointer<Float>?>,
        UnsafeMutablePointer<Int>,
        UnsafeMutablePointer<UnsafeMutablePointer<Float>?>,
        UnsafeMutablePointer<Int>
    ) -> Void
    typealias FreeF32Fn = @convention(c) (UnsafeMutablePointer<Float>?, Int) -> Void

    private static func sym<T>(_ name: String, as type: T.Type) -> T? {
        // Resolve from the main process symbol table; the host app force-loads the Rust static lib.
        guard let handle = dlopen(nil, RTLD_NOW) else { return nil }
        guard let addr = dlsym(handle, name) else { return nil }
        return unsafeBitCast(addr, to: type)
    }

    private static let loadRxBytes: LoadRxBytesFn? = sym("emw_buffer_load_rx_bytes", as: LoadRxBytesFn.self)
    private static let compressDataBits: CompressDataBitsFn? = sym("emw_buffer_compress_data_bits", as: CompressDataBitsFn.self)
    private static let freeF32: FreeF32Fn? = sym("emw_free_f32", as: FreeF32Fn.self)

    private static let lock = NSLock()

    public static func compressViewport(
        bufferBytes: Data,
        rangeStart: Int32,
        rangeEnd: Int32,
        numberBins: Int32
    ) -> (timeValues: [Double], dataValues: [Double])? {
        guard let loadRxBytes, let compressDataBits, let freeF32 else { return nil }

        lock.lock()
        defer { lock.unlock() }

        bufferBytes.withUnsafeBytes { raw in
            loadRxBytes(raw.bindMemory(to: UInt8.self).baseAddress, bufferBytes.count)
        }

        var timePtr: UnsafeMutablePointer<Float>? = nil
        var timeLen: Int = 0
        var dataPtr: UnsafeMutablePointer<Float>? = nil
        var dataLen: Int = 0

        compressDataBits(rangeStart, rangeEnd, numberBins, &timePtr, &timeLen, &dataPtr, &dataLen)

        let timeValues: [Double]
        if let timePtr, timeLen > 0 {
            timeValues = Array(UnsafeBufferPointer(start: timePtr, count: timeLen)).map { Double($0) }
            freeF32(timePtr, timeLen)
        } else {
            timeValues = []
        }

        let dataValues: [Double]
        if let dataPtr, dataLen > 0 {
            dataValues = Array(UnsafeBufferPointer(start: dataPtr, count: dataLen)).map { Double($0) }
            freeF32(dataPtr, dataLen)
        } else {
            dataValues = []
        }

        return (timeValues, dataValues)
    }
}
#endif
