// State matching the original RFID fragment exactly
let blockAddress = "00";
let authMode = 0; // 0 = Key A, 1 = Key B
let keyInputs = ["FF", "FF", "FF", "FF", "FF", "FF"];
let combinedData = "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00";
let resultText = "";

function isKeyComplete() {
    for (let i = 0; i < 6; i++) {
        if (!keyInputs[i] || keyInputs[i].trim().length === 0) {
            return false;
        }
    }
    return true;
}

function isCombinedDataComplete() {
    if (!combinedData || combinedData.trim().length === 0) {
        return false;
    }
    let dataBytes = combinedData.trim().split(/\s+/).filter(Boolean);
    return dataBytes.length === 16;
}

function processReadResponse(response) {
    if (!response || response.length === 0) {
        showError("No response received.");
        return;
    }
    
    // Check for text error messages first
    let responseString = "";
    try {
        for (let i = 0; i < response.length; i++) {
            responseString += String.fromCharCode(response[i]);
        }
    } catch (e) {
        responseString = "";
    }
    
    if (responseString.includes("No card detected")) {
        showError("Error: No card detected");
        return;
    }
    if (responseString.includes("RFID module not connected")) {
        showError("Error: RFID module not connected");
        return;
    }
    
    if (response.length >= 2) {
        let cardType = getTagType(response[0], response[1]);
        let result = "Card Type: " + cardType + "\n";
        
        // Extract UID if present
        if (response.length > 6) {
            let uid = "";
            for (let i = 2; i < 6; i++) {
                uid += ((response[i] & 0xFF).toString(16).toUpperCase().padStart(2, '0')) + " ";
            }
            result += "UID: " + uid.trim() + "\n";
        }
        
        if (response.length > 6) {
            if ((response[6] & 0xFF) === 0xFF) {
                // Error occurred
                let errorMsg = "";
                for (let i = 7; i < response.length; i++) {
                    errorMsg += String.fromCharCode(response[i]);
                }
                result += "Error: " + errorMsg;
                showError(result);
            } else if ((response[6] & 0xFF) === 0x00 && response.length >= 23) {
                // Successful read
                let data = "";
                for (let i = 7; i < 23; i++) {
                    data += ((response[i] & 0xFF).toString(16).toUpperCase().padStart(2, '0')) + " ";
                }
                result += "Data: " + data.trim();
                showResultDialog(result, data.trim());
            } else {
                showError("Unexpected response format. See logs for details.");
            }
        } else {
            showError("Incomplete response received (length: " + response.length + ")");
        }
    } else {
        showError("Invalid response format (length: " + response.length + ")");
    }
}

function getTagType(byte0, byte1) {
    // Simplified tag type detection
    if (byte0 === 0x44 && byte1 === 0x00) return "MIFARE Classic 1K";
    if (byte0 === 0x42 && byte1 === 0x00) return "MIFARE Classic 4K";
    if (byte0 === 0x44 && byte1 === 0x03) return "MIFARE DESFire";
    return "Unknown (" + ((byte0 & 0xFF).toString(16).toUpperCase().padStart(2, '0')) + " " + ((byte1 & 0xFF).toString(16).toUpperCase().padStart(2, '0')) + ")";
}

function showError(errorMessage) {
    resultText = errorMessage;
    render();
}

function showResultDialog(result, data) {
    resultText = ""; // Clear result text since we're showing dialog
    render();
    
    // Show dialog with "COPY to write" option for reads
    if (data && data.trim().length > 0) {
        // For reads with data - show dialog with copy option
        // Note: This is a simplified version - real implementation would need custom dialog with two buttons
        dialog("Result", result + "\n\nData has been copied to write field.");
        
        // Copy data to write field
        let dataBytes = data.trim().split(' ');
        while (dataBytes.length < 16) {
            dataBytes.push("00");
        }
        combinedData = dataBytes.slice(0, 16).join(" ");
        render();
    } else {
        // For writes or reads without data
        dialog("Result", result);
    }
}

function sendReadCommand() {
    if (!BLEService) {
        showError("BLE Service not bound. Please reconnect.");
        return;
    }
    
    if (blockAddress.trim().length === 0 || !isKeyComplete()) {
        showError("Please enter block address and complete key.");
        return;
    }
    
    try {
        // Create command exactly like the original fragment
        let command = new Array(21);
        let cmdPrefix = "mfrc522 read ";
        
        // Copy prefix
        for (let i = 0; i < cmdPrefix.length; i++) {
            command[i] = cmdPrefix.charCodeAt(i);
        }
        
        // Add block address
        command[cmdPrefix.length] = parseInt(blockAddress, 16);
        
        // Add auth mode byte (0x60 for Key A, 0x61 for Key B)
        command[cmdPrefix.length + 1] = authMode === 0 ? 0x60 : 0x61;
        
        // Add 6-byte key
        for (let i = 0; i < 6; i++) {
            command[cmdPrefix.length + 2 + i] = parseInt(keyInputs[i], 16);
        }
        
        // Convert to Java byte array
        let byteArray = createByteArray(command);
        let response = BLEService.sendCommand(byteArray, 2000);
        
        processReadResponse(response);
        
    } catch (error) {
        showError("Read error: " + error);
    }
}

function processWriteResponse(response) {
    if (!response || response.length === 0) {
        showError("No response received.");
        return;
    }
    
    // Check for text error messages first
    let responseString = "";
    try {
        for (let i = 0; i < response.length; i++) {
            responseString += String.fromCharCode(response[i]);
        }
    } catch (e) {
        responseString = "";
    }
    
    if (responseString.includes("No card detected")) {
        showError("Error: No card detected");
        return;
    }
    if (responseString.includes("RFID module not connected")) {
        showError("Error: RFID module not connected");
        return;
    }
    
    if (responseString.includes("Success")) {
        showResultDialog("Write successful", "");
        resultText = ""; // Clear any previous error message
        render();
    } else {
        // More detailed error reporting
        let errorDetails = "Error: " + responseString + "\nRaw response size: " + response.length + " bytes";
        showError(errorDetails);
    }
}

function sendWriteCommand() {
    if (!BLEService) {
        showError("BLE Service not bound. Please reconnect.");
        return;
    }
    
    if (blockAddress.trim().length === 0 || !isKeyComplete() || !isCombinedDataComplete()) {
        showError("Please enter block address, complete key, and data.");
        return;
    }
    
    try {
        // Parse combined data - remove spaces and validate length
        let cleanData = combinedData.replace(/\s/g, "");
        if (cleanData.length !== 32) {
            showError("Data must be exactly 16 bytes (32 hex characters)");
            return;
        }
        
        // Create command exactly like the original fragment
        let command = new Array(38);
        let cmdPrefix = "mfrc522 write ";
        
        // Copy prefix  
        for (let i = 0; i < cmdPrefix.length; i++) {
            command[i] = cmdPrefix.charCodeAt(i);
        }
        
        // Add block address
        command[cmdPrefix.length] = parseInt(blockAddress, 16);
        
        // Add auth mode byte
        command[cmdPrefix.length + 1] = authMode === 0 ? 0x60 : 0x61;
        
        // Add 6-byte key
        for (let i = 0; i < 6; i++) {
            command[cmdPrefix.length + 2 + i] = parseInt(keyInputs[i], 16);
        }
        
        // Add 16-byte data (parse from hex string)
        for (let i = 0; i < 16; i++) {
            let hexByte = cleanData.substring(i * 2, i * 2 + 2);
            command[cmdPrefix.length + 8 + i] = parseInt(hexByte, 16);
        }
        
        // Convert to Java byte array
        let byteArray = createByteArray(command);
        let response = BLEService.sendCommand(byteArray, 2000);
        
        processWriteResponse(response);
        
    } catch (error) {
        showError("Write error: " + error);
    }
}

function render() {
    UI.render(UI.scroll({
        padding: 16,
        spacing: 16,
        children: [
            UI.column({
                spacing: 16,
                children: [
                    UI.text({ text: "RFID Tools", font: "title2", fontWeight: "semibold" }),
                    
                    // Block Address
                    UI.textField({
                        label: "Block Address",
                        placeholder: "00",
                        value: blockAddress,
                        onChange: function(value) { 
                            blockAddress = value.toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 2);
                            render(); 
                        }
                    }),
                    
                    // Authentication Mode
                    UI.picker({
                        label: "Authentication Mode",
                        style: "segmented",
                        selected: authMode,
                        options: [
                            { label: "Key A", value: 0 },
                            { label: "Key B", value: 1 }
                        ],
                        onChange: function(value) {
                            authMode = value;
                            render();
                        }
                    }),
                    
                    // Key inputs (6 fields)
                    UI.column({
                        spacing: 8,
                        children: [
                            UI.text({ text: "Key (6 bytes)", fontWeight: "medium" }),
                            UI.grid({
                                columns: 3,
                                spacing: 8,
                                children: keyInputs.map(function(keyValue, index) {
                                    return UI.textField({
                                        placeholder: "FF",
                                        value: keyValue,
                                        onChange: function(value) {
                                            keyInputs[index] = value.toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 2);
                                            render();
                                        }
                                    });
                                })
                            })
                        ]
                    }),
                    
                    // Combined data input
                    UI.textEditor({
                        label: "Data (16 bytes)",
                        placeholder: "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
                        value: combinedData,
                        onChange: function(value) {
                            combinedData = value.toUpperCase().replace(/[^0-9A-F ]/g, "");
                            render();
                        }
                    }),
                    
                    // Read and Write buttons
                    UI.row({
                        spacing: 12,
                        children: [
                            UI.button({
                                label: "Read",
                                backgroundColor: "#2563EB",
                                foregroundColor: "#FFFFFF",
                                onTap: sendReadCommand
                            }),
                            UI.button({
                                label: "Write", 
                                backgroundColor: "#DC2626",
                                foregroundColor: "#FFFFFF",
                                onTap: sendWriteCommand
                            })
                        ]
                    }),
                    
                    // Result display
                    resultText ? UI.text({
                        text: resultText,
                        backgroundColor: resultText.includes("successful") ? "#DCFCE7" : "#FEE2E2",
                        foregroundColor: resultText.includes("successful") ? "#166534" : "#DC2626",
                        padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
                        cornerRadius: 8
                    }) : null
                ]
            })
        ]
    }));
}

render();
