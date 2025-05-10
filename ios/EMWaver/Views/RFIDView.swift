import SwiftUI

struct RFIDView: View {
    @EnvironmentObject var bleManager: BLEManager
    
    // State variables for input fields
    @State private var blockAddress: String = "00"
    @State private var keyInputs: [String] = Array(repeating: "FF", count: 6)
    @State private var combinedData: String = "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00"
    @State private var authMode: Int = 0 // 0 = Key A, 1 = Key B
    @State private var resultText: String = ""
    @State private var resultColor: Color = .primary
    
    // Alert states
    @State private var showingResultAlert = false
    @State private var alertTitle = ""
    @State private var alertMessage = ""
    @State private var alertHasDataToCopy = false
    @State private var dataForCopy = ""
    
    // Card types
    let cardTypes: [UInt16: String] = [
        0x4400: "Mifare_UltraLight",
        0x0400: "Mifare_One(S50)",
        0x0200: "Mifare_One(S70)",
        0x0800: "Mifare_Pro(X)",
        0x4403: "Mifare_DESFire"
    ]
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Block Address
                VStack(alignment: .leading) {
                    Text("Block Address")
                        .font(.headline)
                    TextField("Block Address", text: $blockAddress)
                        .keyboardType(.asciiCapable)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                        .onChange(of: blockAddress) { newValue in
                            blockAddress = formatHexInput(newValue, maxLength: 2)
                        }
                }
                
                // Authentication Mode
                VStack(alignment: .leading) {
                    Text("Authentication Mode")
                        .font(.headline)
                    Picker("Auth Mode", selection: $authMode) {
                        Text("Key A").tag(0)
                        Text("Key B").tag(1)
                    }
                    .pickerStyle(SegmentedPickerStyle())
                }
                
                // Key Input
                VStack(alignment: .leading) {
                    Text("Key (6 bytes)")
                        .font(.headline)
                    
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                        ForEach(0..<6, id: \.self) { index in
                            TextField("", text: $keyInputs[index])
                                .keyboardType(.asciiCapable)
                                .multilineTextAlignment(.center)
                                .textFieldStyle(RoundedBorderTextFieldStyle())
                                .onChange(of: keyInputs[index]) { newValue in
                                    keyInputs[index] = formatHexInput(newValue, maxLength: 2)
                                }
                        }
                    }
                }
                
                // Combined Data
                VStack(alignment: .leading) {
                    Text("Data (16 bytes)")
                        .font(.headline)
                    TextEditor(text: $combinedData)
                        .frame(height: 80)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.gray.opacity(0.2), lineWidth: 1)
                        )
                        .onChange(of: combinedData) { newValue in
                            combinedData = formatHexInput(newValue, maxLength: 47) // 16 bytes with spaces
                        }
                }
                
                // Buttons
                HStack {
                    Button(action: sendReadCommand) {
                        HStack {
                            Image(systemName: "arrow.down.doc.fill")
                            Text("Read")
                        }
                        .frame(minWidth: 0, maxWidth: .infinity)
                        .padding()
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(8)
                    }
                    
                    Button(action: sendWriteCommand) {
                        HStack {
                            Image(systemName: "arrow.up.doc.fill")
                            Text("Write")
                        }
                        .frame(minWidth: 0, maxWidth: .infinity)
                        .padding()
                        .background(Color.green)
                        .foregroundColor(.white)
                        .cornerRadius(8)
                    }
                }
                
                // Results
                if !resultText.isEmpty {
                    Text(resultText)
                        .padding()
                        .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
                        .background(Color(.systemGray6))
                        .cornerRadius(8)
                        .foregroundColor(resultColor)
                }
            }
            .padding()
            .navigationTitle("RFID")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                // Add this code for opaque navigation bar
                let appearance = UINavigationBarAppearance()
                appearance.configureWithOpaqueBackground()
                UINavigationBar.appearance().standardAppearance = appearance
                UINavigationBar.appearance().compactAppearance = appearance
                UINavigationBar.appearance().scrollEdgeAppearance = appearance
                // End of added code
            }
            .alert(alertTitle, isPresented: $showingResultAlert) {
                Button("OK", role: .cancel) { }
                if alertHasDataToCopy {
                    Button("Copy to Write") {
                        combinedData = dataForCopy
                    }
                }
            } message: {
                Text(alertMessage)
            }
        }
    }
    
    // MARK: - Helper Functions
    
    /// Formats hex input to ensure it only contains valid hex characters and spaces
    func formatHexInput(_ input: String, maxLength: Int) -> String {
        // Remove non-hex characters
        let filtered = input.uppercased().filter { "0123456789ABCDEF ".contains($0) }
        
        // Limit length if needed
        if filtered.count > maxLength {
            return String(filtered.prefix(maxLength))
        }
        return filtered
    }
    
    /// Checks if all key inputs are complete
    func isKeyComplete() -> Bool {
        for key in keyInputs {
            if key.isEmpty || key.count < 2 {
                return false
            }
        }
        return true
    }
    
    /// Checks if combined data is complete
    func isCombinedDataComplete() -> Bool {
        let cleanData = combinedData.replacingOccurrences(of: " ", with: "")
        return cleanData.count == 32 // 16 bytes = 32 hex chars
    }
    
    /// Parses the card type from response bytes
    func getTagType(_ b1: UInt8, _ b2: UInt8) -> String {
        let tagType = (UInt16(b1) << 8) | UInt16(b2)
        return cardTypes[tagType] ?? "Unknown"
    }
    
    // MARK: - RFID Commands
    
    func sendReadCommand() {
        guard bleManager.isConnected else {
            showError("Not connected to device")
            return
        }
        
        if blockAddress.isEmpty || !isKeyComplete() {
            showError("Please enter block address and complete key")
            return
        }
        
        // Parse block address
        guard let blockAddressByte = UInt8(blockAddress, radix: 16) else {
            showError("Invalid block address")
            return
        }
        
        // Create command buffer
        // Format should be: "mfrc522 read [blockAddr] [authMode] [6 bytes key]"
        var command = Data("mfrc522 read ".utf8)
        
        // Block address
        command.append(blockAddressByte)
        
        // Auth mode: 0x60 for Key A, 0x61 for Key B
        command.append(authMode == 0 ? 0x60 : 0x61)
        
        // Key bytes (6 bytes)
        for keyInput in keyInputs {
            if let keyByte = UInt8(keyInput, radix: 16) {
                command.append(keyByte)
            } else {
                showError("Invalid key format")
                return
            }
        }
        
        // Send command and wait for response
        if let response = bleManager.sendCommand(command, timeout: 2000) {
            processReadResponse(response)
        } else {
            showError("No response received")
        }
    }
    
    func sendWriteCommand() {
        guard bleManager.isConnected else {
            showError("Not connected to device")
            return
        }
        
        if blockAddress.isEmpty || !isKeyComplete() || !isCombinedDataComplete() {
            showError("Please enter block address, complete key, and data")
            return
        }
        
        // Parse block address
        guard let blockAddressByte = UInt8(blockAddress, radix: 16) else {
            showError("Invalid block address")
            return
        }
        
        // Create command buffer
        // Format should be: "mfrc522 write [blockAddr] [authMode] [6 bytes key] [16 bytes data]"
        var command = Data("mfrc522 write ".utf8)
        
        // Block address
        command.append(blockAddressByte)
        
        // Auth mode: 0x60 for Key A, 0x61 for Key B
        command.append(authMode == 0 ? 0x60 : 0x61)
        
        // Key bytes (6 bytes)
        for keyInput in keyInputs {
            if let keyByte = UInt8(keyInput, radix: 16) {
                command.append(keyByte)
            } else {
                showError("Invalid key format")
                return
            }
        }
        
        // Data bytes (16 bytes)
        let cleanData = combinedData.replacingOccurrences(of: " ", with: "")
        
        if cleanData.count != 32 {
            showError("Data must be exactly 16 bytes (32 hex characters)")
            return
        }
        
        for i in stride(from: 0, to: cleanData.count, by: 2) {
            let index = cleanData.index(cleanData.startIndex, offsetBy: i)
            let endIndex = cleanData.index(index, offsetBy: 2, limitedBy: cleanData.endIndex) ?? cleanData.endIndex
            let byteString = String(cleanData[index..<endIndex])
            
            if let dataByte = UInt8(byteString, radix: 16) {
                command.append(dataByte)
            } else {
                showError("Invalid data format")
                return
            }
        }
        
        // Send command and wait for response
        if let response = bleManager.sendCommand(command, timeout: 2000) {
            processWriteResponse(response)
        } else {
            showError("No response received")
        }
    }
    
    // MARK: - Response Processing
    
    func processReadResponse(_ response: Data) {
        if response.isEmpty {
            showError("No response received")
            return
        }
        
        // Check for "No card detected" response
        if let responseString = String(data: response, encoding: .ascii), 
           responseString == "No card detected" {
            showError("Error: No card detected")
            return
        }
        
        // Process response data
        if response.count >= 2 {
            let cardType = getTagType(response[0], response[1])
            var result = "Card Type: \(cardType)\n"
            
            if response.count >= 6 {
                let uid = String(format: "%02X %02X %02X %02X", response[2], response[3], response[4], response[5])
                result += "UID: \(uid)\n"
            }
            
            if response.count > 6 {
                if response[6] == 0xFF {
                    // Error occurred
                    if let errorMsg = String(data: response.subdata(in: 7..<response.count), encoding: .ascii) {
                        result += "Error: \(errorMsg)"
                        showError(result)
                    }
                } else if response[6] == 0x00 && response.count >= 23 {
                    // Successful read
                    var data = ""
                    for i in 7..<23 {
                        data += String(format: "%02X ", response[i])
                    }
                    data = data.trimmingCharacters(in: .whitespaces)
                    result += "Data: \(data)"
                    
                    // Show result with option to copy
                    alertTitle = "Result"
                    alertMessage = result
                    alertHasDataToCopy = true
                    dataForCopy = data
                    showingResultAlert = true
                    
                    // Also update the result text
                    resultText = result
                    resultColor = .primary
                } else {
                    showError("Unexpected response format")
                }
            } else {
                showError("Incomplete response received")
            }
        } else {
            showError("Invalid response format")
        }
        
        // Log response for debugging
        logResponse("read", response)
    }
    
    func processWriteResponse(_ response: Data) {
        if response.isEmpty {
            showError("No response received")
            return
        }
        
        if let responseString = String(data: response, encoding: .ascii) {
            if responseString == "No card detected" {
                showError("Error: No card detected")
            } else if responseString == "Success" {
                alertTitle = "Success"
                alertMessage = "Write operation successful"
                alertHasDataToCopy = false
                showingResultAlert = true
                
                resultText = "Write successful"
                resultColor = .green
            } else {
                showError("Error: \(responseString)")
            }
        } else {
            showError("Unreadable response")
        }
        
        // Log response for debugging
        logResponse("write", response)
    }
    
    // MARK: - UI Helpers
    
    func showError(_ error: String) {
        resultText = error
        resultColor = .red
    }
    
    func logResponse(_ operation: String, _ response: Data) {
        print("\(operation) Response: \(response.map { String(format: "%02X ", $0) }.joined())")
    }
}

// Preview
struct RFIDView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationView {
            RFIDView()
                .environmentObject(BLEManager())
        }
    }
} 