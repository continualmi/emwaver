package com.emwaver.emwaverandroidapp.ui.console;

import com.emwaver.emwaverandroidapp.BLEService;
import com.emwaver.emwaverandroidapp.ir.IrEncoderWrapper;
import com.emwaver.emwaverandroidapp.ui.ism.CC1101;
import com.emwaver.emwaverandroidapp.Utils;
import org.mozilla.javascript.*;
import java.util.function.Consumer;

/**
 * This class can be used to evaluate any string expression using the open source,
 * RHINO javascript engine.
 *
 * Add this line - compile 'org.mozilla:rhino:1.7R4'
 * To your module app dependency gradle to install the jar library.
 *
 * Follow my tutorial at
 * {@link} https://github.com/brionsilva/Android-Rhino-Example
 *
 * @author  Brion Mario
 * @version 1.0
 * @since   2017-03-08
 */

public class ScriptsEngine {

    private Context rhino;
    private Scriptable scope;
    private CC1101 cc1101;
    private Utils utils;
    private BLEService bleService;
    private IrEncoderWrapper irEncoderWrapper;
    private Consumer<String> printFunction;

    public ScriptsEngine(CC1101 cc1101, Utils utils, BLEService bleService, IrEncoderWrapper irEncoderWrapper, Consumer<String> printFunction) {
        this.cc1101 = cc1101;
        this.utils = utils;
        this.bleService = bleService;
        this.irEncoderWrapper = irEncoderWrapper;
        this.printFunction = printFunction;
    }

    public String executeJavaScript(String script) {
        String errorMessage = null;

        try {
            rhino = Context.enter();
            rhino.setOptimizationLevel(-1);
            scope = rhino.initStandardObjects();

            // Make CC1101 class accessible from JavaScript
            ScriptableObject.putProperty(scope, "CC1101", Context.javaToJS(cc1101, scope));

            // Make Utils class accessible from JavaScript
            ScriptableObject.putProperty(scope, "Utils", Context.javaToJS(utils, scope));

            // Make BLEService class accessible from JavaScript
            ScriptableObject.putProperty(scope, "BLEService", Context.javaToJS(bleService, scope));

            // Expose the IrEncoderWrapper instance received in the constructor
            ScriptableObject.putProperty(scope, "IrEncoder", Context.javaToJS(irEncoderWrapper, scope));

            // Make print function accessible from JavaScript
            Function printWrapper = new BaseFunction() {
                @Override
                public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                    if (args.length > 0) {
                        printFunction.accept(Context.toString(args[0]));
                    }
                    return Context.getUndefinedValue();
                }
            };
            ScriptableObject.putProperty(scope, "print", printWrapper);

            // Execute the JavaScript script
            rhino.evaluateString(scope, script, "JavaScript", 1, null);
        } catch (RhinoException e) {
            e.printStackTrace();
            errorMessage = e.getMessage();
        } finally {
            Context.exit();
        }

        // Return the error message, or null if there was no error
        return errorMessage;
    }
}

