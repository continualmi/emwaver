import Foundation

/**
 * A simple wrapper class to provide access to the static IrEncoder.encodeIR method
 * as an instance method, allowing it to be passed via constructor like other dependencies.
 */
class IrEncoderWrapper {
    
    /**
     * Calls the static IrEncoder.encodeIR method.
     *
     * - Parameters:
     *   - protocol: The name of the IR protocol.
     *   - device: The device code (D).
     *   - subdevice: The subdevice code (S).
     *   - function: The function code (F).
     * - Returns: An array of Doubles representing the pulse/gap sequence, or nil if encoding fails.
     */
    func encodeIR(protocol: String, device: Int, subdevice: Int, function: Int) -> [Double]? {
        // Delegate the call to the static method in IrEncoder
        return IrEncoder.encodeIR(protocol: `protocol`, device: device, subdevice: subdevice, function: function)
    }
} 