import Foundation
import Darwin

// Minimal dynamic loader for libusb-1.0.
// This avoids brittle Swift↔IOKit vtable interop and lets us mirror the working Rust DFU flow.
//
// NOTE: For now we dlopen the system/brew/bundled dylib. For App Store shipping we should
// bundle a signed copy in the app and load from Bundle.main.privateFrameworksURL.

enum LibusbError: Error, CustomStringConvertible {
    case notLoaded(String)
    case symbolMissing(String)
    case callFailed(String, Int32)

    var description: String {
        switch self {
        case .notLoaded(let s): return "libusb not loaded: \(s)"
        case .symbolMissing(let s): return "libusb missing symbol: \(s)"
        case .callFailed(let fn, let code): return "libusb call failed: \(fn) => \(code)" // libusb error codes are negative
        }
    }
}

final class Libusb {
    // Opaque types
    typealias libusb_context = OpaquePointer
    typealias libusb_device_handle = OpaquePointer

    // Function signatures (subset)
    typealias libusb_init_fn = @convention(c) (UnsafeMutablePointer<libusb_context?>?) -> Int32
    typealias libusb_exit_fn = @convention(c) (libusb_context?) -> Void
    typealias libusb_open_device_with_vid_pid_fn = @convention(c) (libusb_context?, UInt16, UInt16) -> libusb_device_handle?
    typealias libusb_close_fn = @convention(c) (libusb_device_handle?) -> Void
    typealias libusb_set_auto_detach_kernel_driver_fn = @convention(c) (libusb_device_handle?, Int32) -> Int32
    typealias libusb_claim_interface_fn = @convention(c) (libusb_device_handle?, Int32) -> Int32
    typealias libusb_release_interface_fn = @convention(c) (libusb_device_handle?, Int32) -> Int32
    typealias libusb_control_transfer_fn = @convention(c) (libusb_device_handle?, UInt8, UInt8, UInt16, UInt16, UnsafeMutablePointer<UInt8>?, UInt16, UInt32) -> Int32

    private let handle: UnsafeMutableRawPointer

    let libusb_init: libusb_init_fn
    let libusb_exit: libusb_exit_fn
    let libusb_open_device_with_vid_pid: libusb_open_device_with_vid_pid_fn
    let libusb_close: libusb_close_fn
    let libusb_set_auto_detach_kernel_driver: libusb_set_auto_detach_kernel_driver_fn
    let libusb_claim_interface: libusb_claim_interface_fn
    let libusb_release_interface: libusb_release_interface_fn
    let libusb_control_transfer: libusb_control_transfer_fn

    static let shared: Libusb = {
        do { return try Libusb() }
        catch {
            // Keep a hard failure noisy in dev; runtime caller can handle by catching when used.
            fatalError("Failed to load libusb: \(error)")
        }
    }()

    init() throws {
        let candidates: [String] = {
            var out: [String] = []
            // Bundled
            if let fw = Bundle.main.privateFrameworksURL {
                out.append(fw.appendingPathComponent("libusb-1.0.0.dylib").path)
                out.append(fw.appendingPathComponent("libusb-1.0.dylib").path)
            }
            // Homebrew (Apple Silicon)
            out.append("/opt/homebrew/lib/libusb-1.0.0.dylib")
            out.append("/opt/homebrew/lib/libusb-1.0.dylib")
            // Homebrew (Intel)
            out.append("/usr/local/lib/libusb-1.0.0.dylib")
            out.append("/usr/local/lib/libusb-1.0.dylib")
            // Fallback to dyld search paths
            out.append("libusb-1.0.0.dylib")
            out.append("libusb-1.0.dylib")
            return out
        }()

        var dl: UnsafeMutableRawPointer? = nil
        var lastErr: String = ""
        for p in candidates {
            dl = dlopen(p, RTLD_NOW | RTLD_LOCAL)
            if dl != nil { break }
            if let e = dlerror() { lastErr = String(cString: e) }
        }
        guard let handle = dl else {
            throw LibusbError.notLoaded(lastErr)
        }
        self.handle = handle

        func sym<T>(_ name: String, _ type: T.Type) throws -> T {
            guard let raw = dlsym(handle, name) else {
                throw LibusbError.symbolMissing(name)
            }
            return unsafeBitCast(raw, to: type)
        }

        self.libusb_init = try sym("libusb_init", libusb_init_fn.self)
        self.libusb_exit = try sym("libusb_exit", libusb_exit_fn.self)
        self.libusb_open_device_with_vid_pid = try sym("libusb_open_device_with_vid_pid", libusb_open_device_with_vid_pid_fn.self)
        self.libusb_close = try sym("libusb_close", libusb_close_fn.self)
        self.libusb_set_auto_detach_kernel_driver = try sym("libusb_set_auto_detach_kernel_driver", libusb_set_auto_detach_kernel_driver_fn.self)
        self.libusb_claim_interface = try sym("libusb_claim_interface", libusb_claim_interface_fn.self)
        self.libusb_release_interface = try sym("libusb_release_interface", libusb_release_interface_fn.self)
        self.libusb_control_transfer = try sym("libusb_control_transfer", libusb_control_transfer_fn.self)
    }

    deinit {
        dlclose(handle)
    }
}
