/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

import SwiftUI

struct RFIDView: View {
    @EnvironmentObject private var bleManager: USBManager

    @State private var blockAddress = "00"
    @State private var authMode: AuthMode = .keyA
    @State private var keyBytes: [String] = Array(repeating: "FF", count: 6)
    @State private var dataBytes = "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00"

    @State private var resultText = ""
    @State private var isError = false
    @State private var isBusy = false

    @State private var showingResultDialog = false
    @State private var resultDialogMessage = ""
    @State private var resultDialogData = ""

    private enum AuthMode: String, CaseIterable, Identifiable {
        case keyA = "Key A"
        case keyB = "Key B"

        var id: String { rawValue }

        var authByte: UInt8 {
            switch self {
            case .keyA: return 0x60
            case .keyB: return 0x61
            }
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if !bleManager.isConnected {
                    HStack {
                        Circle().fill(.red).frame(width: 10, height: 10)
                        Text("Not Connected")
                            .font(.subheadline)
                        Spacer()
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(8)
                }

                GroupBox(label: Label("RFID", systemImage: "creditcard")) {
                    VStack(spacing: 12) {
                        LabeledContent("Block address") {
                            TextField("00", text: $blockAddress)
                                .textInputAutocapitalization(.characters)
                                .autocorrectionDisabled()
                                .multilineTextAlignment(.trailing)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 80)
                                .onChange(of: blockAddress) { _, newValue in
                                    blockAddress = sanitizeHexByte(newValue)
                                }
                        }

                        Picker("Auth", selection: $authMode) {
                            ForEach(AuthMode.allCases) { mode in
                                Text(mode.rawValue).tag(mode)
                            }
                        }
                        .pickerStyle(.segmented)

                        VStack(alignment: .leading, spacing: 8) {
                            Text("Key (6 bytes)")
                                .font(.subheadline)
                            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                                ForEach(0..<6, id: \.self) { index in
                                    TextField("FF", text: Binding(
                                        get: { keyBytes[index] },
                                        set: { keyBytes[index] = sanitizeHexByte($0) }
                                    ))
                                    .textInputAutocapitalization(.characters)
                                    .autocorrectionDisabled()
                                    .multilineTextAlignment(.center)
                                    .textFieldStyle(.roundedBorder)
                                }
                            }
                        }

                        VStack(alignment: .leading, spacing: 6) {
                            Text("Data (16 bytes)")
                                .font(.subheadline)
                            TextEditor(text: $dataBytes)
                                .font(.system(.body, design: .monospaced))
                                .frame(minHeight: 90)
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(.separator)))
                                .textInputAutocapitalization(.characters)
                                .autocorrectionDisabled()
                                .onChange(of: dataBytes) { _, newValue in
                                    dataBytes = newValue.uppercased().filter { ("0"..."9").contains($0) || ("A"..."F").contains($0) || $0 == " " }
                                }
                        }
                    }
                    .padding(.vertical, 4)
                }

                HStack(spacing: 12) {
                    Button("Read") { Task { await readBlock() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(isBusy || !bleManager.isConnected)
                    Button("Write") { Task { await writeBlock() } }
                        .buttonStyle(.bordered)
                        .disabled(isBusy || !bleManager.isConnected)
                }

                if !resultText.isEmpty {
                    Text(resultText)
                        .foregroundColor(isError ? .red : .green)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(isError ? Color.red.opacity(0.1) : Color.green.opacity(0.1))
                        .cornerRadius(8)
                }
            }
            .padding()
        }
        .navigationTitle("RFID")
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if isBusy {
                ProgressView()
                    .progressViewStyle(.circular)
                    .padding(24)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
        .alert("Result", isPresented: $showingResultDialog) {
            Button("Copy to write") {
                dataBytes = resultDialogData
            }
            Button("OK", role: .cancel) {}
        } message: {
            Text(resultDialogMessage)
        }
    }

    private func readBlock() async {
        guard await setBusy("Read") else { return }
        let result: Result<(message: String, data: String), Error> = await performInBackground {
            let response = try sendRfidRead()
            let payload = extractRfidReadPayload(response) ?? response
            guard payload.count >= 22 else {
                throw NSError(domain: "RFID", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unexpected response (\(response.count) bytes)."])
            }

            let cardType = tagTypeName(payload[0], payload[1])
            let uid = [payload[2], payload[3], payload[4], payload[5]].map { String(format: "%02X", $0) }.joined(separator: " ")
            let data = payload[6..<22].map { String(format: "%02X", $0) }.joined(separator: " ")
            let message = "Card Type: \(cardType)\nUID: \(uid)\nData: \(data)"
            return (message: message, data: data)
        }

        await MainActor.run {
            isBusy = false
            switch result {
            case .success(let output):
                resultText = output.message
                isError = false
                resultDialogMessage = output.message
                resultDialogData = output.data
                showingResultDialog = true
            case .failure(let error):
                resultText = "Read failed: \(error.localizedDescription)"
                isError = true
            }
        }
    }

    private func writeBlock() async {
        guard await setBusy("Write") else { return }
        let result: Result<Void, Error> = await performInBackground {
            _ = try sendRfidWrite()
            return ()
        }
        await MainActor.run {
            isBusy = false
            switch result {
            case .success:
                resultText = "Write successful"
                isError = false
            case .failure(let error):
                resultText = "Write failed: \(error.localizedDescription)"
                isError = true
            }
        }
    }

    private func setBusy(_ label: String) async -> Bool {
        guard bleManager.isConnected else {
            await MainActor.run {
                resultText = "Not connected"
                isError = true
            }
            return false
        }

        await MainActor.run {
            isBusy = true
            resultText = "\(label)…"
            isError = false
        }
        return true
    }

    private func performInBackground<T>(_ work: @escaping () throws -> T) async -> Result<T, Error> {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    continuation.resume(returning: .success(try work()))
                } catch {
                    continuation.resume(returning: .failure(error))
                }
            }
        }
    }

    // MARK: - Transport / Protocol

    private func sendCommand(_ data: Data, timeoutMs: Int) throws -> Data {
        guard let response = bleManager.sendCommand(data, timeout: timeoutMs) else {
            throw NSError(domain: "RFID", code: 2, userInfo: [NSLocalizedDescriptionKey: "No response from device."])
        }
        if USBManager.isPaddedErrFrame(response) || (response.count == 1 && response[0] == 0xFF) {
            throw NSError(domain: "RFID", code: 3, userInfo: [NSLocalizedDescriptionKey: "Device returned error (0xFF)."])
        }
        return response
    }

    private func sendRfidRead() throws -> Data {
        guard let block = UInt8(blockAddress, radix: 16) else {
            throw NSError(domain: "RFID", code: 10, userInfo: [NSLocalizedDescriptionKey: "Invalid block address."])
        }
        let key = try parseKeyBytes()

        // Preferred: Android-style ascii command (if firmware supports it)
        let keyCsv = key.map { String(format: "0x%02X", $0) }.joined(separator: ",")
        let ascii = String(format: "rfid read --block=0x%02X --auth=0x%02X --key=%@\n", block, authMode.authByte, keyCsv)
        if let response = bleManager.sendCommand(Data(ascii.utf8), timeout: 2000), !(USBManager.isPaddedErrFrame(response) || (response.count == 1 && response[0] == 0xFF)) {
            return response
        }

        // Fallback: legacy binary framing used by older scripts
        var bytes = Data()
        bytes.append(contentsOf: Array("mfrc522 read ".utf8))
        bytes.append(block)
        bytes.append(authMode.authByte)
        bytes.append(contentsOf: key)
        return try sendCommand(bytes, timeoutMs: 2000)
    }

    private func sendRfidWrite() throws -> Data {
        guard let block = UInt8(blockAddress, radix: 16) else {
            throw NSError(domain: "RFID", code: 11, userInfo: [NSLocalizedDescriptionKey: "Invalid block address."])
        }
        let key = try parseKeyBytes()
        let data = try parseDataBytes()

        // Preferred: Android-style ascii command (if firmware supports it)
        let keyCsv = key.map { String(format: "0x%02X", $0) }.joined(separator: ",")
        let dataCsv = data.map { String(format: "0x%02X", $0) }.joined(separator: ",")
        let ascii = String(format: "rfid write --block=0x%02X --auth=0x%02X --key=%@ --data=%@\n", block, authMode.authByte, keyCsv, dataCsv)
        if let response = bleManager.sendCommand(Data(ascii.utf8), timeout: 2000), !(USBManager.isPaddedErrFrame(response) || (response.count == 1 && response[0] == 0xFF)) {
            return response
        }

        // Fallback: legacy binary framing used by older scripts
        var bytes = Data()
        bytes.append(contentsOf: Array("mfrc522 write ".utf8))
        bytes.append(block)
        bytes.append(authMode.authByte)
        bytes.append(contentsOf: key)
        bytes.append(contentsOf: data)
        return try sendCommand(bytes, timeoutMs: 2000)
    }

    private func parseKeyBytes() throws -> [UInt8] {
        var out: [UInt8] = []
        out.reserveCapacity(6)
        for part in keyBytes {
            guard let value = UInt8(part, radix: 16) else {
                throw NSError(domain: "RFID", code: 12, userInfo: [NSLocalizedDescriptionKey: "Invalid key byte: \(part)"])
            }
            out.append(value)
        }
        return out
    }

    private func parseDataBytes() throws -> [UInt8] {
        let cleaned = dataBytes.uppercased().filter { ("0"..."9").contains($0) || ("A"..."F").contains($0) }
        guard cleaned.count == 32 else {
            throw NSError(domain: "RFID", code: 13, userInfo: [NSLocalizedDescriptionKey: "Data must be exactly 16 bytes (32 hex chars)."])
        }
        var out: [UInt8] = []
        out.reserveCapacity(16)
        var index = cleaned.startIndex
        while index < cleaned.endIndex {
            let next = cleaned.index(index, offsetBy: 2)
            let byteStr = String(cleaned[index..<next])
            guard let value = UInt8(byteStr, radix: 16) else {
                throw NSError(domain: "RFID", code: 14, userInfo: [NSLocalizedDescriptionKey: "Invalid data byte."])
            }
            out.append(value)
            index = next
        }
        return out
    }

    private func sanitizeHexByte(_ value: String) -> String {
        let cleaned = value.uppercased().filter { ("0"..."9").contains($0) || ("A"..."F").contains($0) }
        return String(cleaned.prefix(2))
    }

    private func extractRfidReadPayload(_ response: Data) -> Data? {
        if response.count == 22 { return response }
        if response.count < 22 { return nil }

        // Search for a plausible tag type prefix (matches Android behavior)
        for offset in 0...(response.count - 22) {
            let b0 = response[offset]
            let b1 = response[offset + 1]
            let tag = (UInt16(b0) << 8) | UInt16(b1)
            if tag == 0x4400 || tag == 0x0400 || tag == 0x0200 || tag == 0x0800 || tag == 0x4403 {
                return response.subdata(in: offset..<(offset + 22))
            }
        }
        return response.subdata(in: 0..<22)
    }

    private func tagTypeName(_ byte0: UInt8, _ byte1: UInt8) -> String {
        let tagType = (UInt16(byte0) << 8) | UInt16(byte1)
        switch tagType {
        case 0x4400: return "Mifare_UltraLight"
        case 0x0400: return "Mifare_One(S50)"
        case 0x0200: return "Mifare_One(S70)"
        case 0x0800: return "Mifare_Pro(X)"
        case 0x4403: return "Mifare_DESFire"
        default: return "Unknown"
        }
    }
}

#Preview {
    NavigationView {
        RFIDView()
            .environmentObject(USBManager())
    }
}
