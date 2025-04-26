package com.emwaver.emwaverandroidapp.ir;

import java.util.List;

/**
 * A simple wrapper class to provide access to the static IrEncoder.encodeIR method
 * as an instance method, allowing it to be passed via constructor like other dependencies.
 */
public class IrEncoderWrapper {

    /**
     * Calls the static IrEncoder.encodeIR method.
     *
     * @param protocol   The name of the IR protocol.
     * @param device     The device code (D).
     * @param subdevice  The subdevice code (S).
     * @param function   The function code (F).
     * @return A List of Doubles representing the pulse/gap sequence, or null if encoding fails.
     */
    public List<Double> encodeIR(String protocol, int device, int subdevice, int function) {
        // Delegate the call to the static method in IrEncoder
        return IrEncoder.encodeIR(protocol, device, subdevice, function);
    }
} 