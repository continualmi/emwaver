import SwiftUI
import JavaScriptCore

// MARK: - Models

struct Remote: Codable, Identifiable {
    var id: String { name }
    var name: String
    var buttons: [Button]
    
    struct Button: Codable, Identifiable {
        var id: String { name }
        var name: String
        var color: String
        var script: String
    }
}

// MARK: - ButtonsView

struct ButtonsView: View {
    @EnvironmentObject private var bleManager: BLEManager
    @State private var remotes: [Remote] = []
    @State private var selectedRemote: Remote?
    @State private var showingAddRemoteSheet = false
    @State private var showingAddButtonSheet = false
    @State private var showingActionSheet = false
    @State private var actionSheetRemote: Remote?
    @State private var showingEditButtonSheet = false
    @State private var editingButton: Remote.Button?
    @State private var editingButtonIndex: Int?
    @State private var showingExportSheet = false
    @State private var exportContent: String = ""
    
    // Collapsible sections state
    @State private var isRemoteListExpanded = true
    @State private var isButtonGridExpanded = true
    
    // JavaScript Engine
    private let jsEngine = JavaScriptEngine(bleManager: BLEManager())
    
    var body: some View {
        VStack(spacing: 0) {
            // Remotes Section
            sectionHeader("Remotes", isExpanded: $isRemoteListExpanded)
            
            if isRemoteListExpanded {
                List {
                    ForEach(remotes) { remote in
                        Text(remote.name)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                selectedRemote = remote
                            }
                            .onLongPressGesture {
                                actionSheetRemote = remote
                                showingActionSheet = true
                            }
                            .listRowBackground(
                                selectedRemote?.id == remote.id ? Color.blue.opacity(0.2) : Color.clear
                            )
                    }
                }
                .frame(height: 150)
                .listStyle(PlainListStyle())
            }
            
            // Buttons Grid Section
            sectionHeader(selectedRemote != nil ? "Remote: \(selectedRemote!.name)" : "No remote selected", 
                          isExpanded: $isButtonGridExpanded)
            
            if isButtonGridExpanded {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        if let selectedRemote = selectedRemote {
                            ForEach(Array(selectedRemote.buttons.enumerated()), id: \.element.id) { index, button in
                                Button(action: {
                                    executeScript(button.script)
                                }) {
                                    Text(button.name)
                                        .frame(minWidth: 0, maxWidth: .infinity)
                                        .frame(height: 60)
                                        .background(colorFromString(button.color))
                                        .foregroundColor(.white)
                                        .cornerRadius(8)
                                }
                                .contextMenu {
                                    Button("Edit") {
                                        editingButton = button
                                        editingButtonIndex = index
                                        showingEditButtonSheet = true
                                    }
                                }
                            }
                        }
                    }
                    .padding()
                }
                .frame(maxWidth: .infinity)
            }
        }
        .navigationTitle("Buttons")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button("Add Remote", action: { showingAddRemoteSheet = true })
                    if selectedRemote != nil {
                        Button("Add Key", action: { showingAddButtonSheet = true })
                    }
                    Divider()
                    Button("Load from Storage", action: loadFromStorage)
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        // Sheets
        .sheet(isPresented: $showingAddRemoteSheet) {
            AddRemoteView { remoteName in
                createNewRemote(name: remoteName)
                showingAddRemoteSheet = false
            }
        }
        .sheet(isPresented: $showingAddButtonSheet) {
            AddButtonView { name, color, script in
                addButtonToRemote(name: name, color: color, script: script)
                showingAddButtonSheet = false
            }
        }
        .sheet(isPresented: $showingEditButtonSheet) {
            if let button = editingButton {
                EditButtonView(button: button) { name, color, script in
                    updateButton(index: editingButtonIndex ?? 0, name: name, color: color, script: script)
                    showingEditButtonSheet = false
                }
            }
        }
        .sheet(isPresented: $showingExportSheet) {
            ExportView(content: exportContent)
        }
        .actionSheet(isPresented: $showingActionSheet) {
            ActionSheet(
                title: Text("Remote Options"),
                message: Text(actionSheetRemote?.name ?? ""),
                buttons: [
                    .default(Text("View JSON")) {
                        if let remote = actionSheetRemote {
                            exportRemote(remote)
                        }
                    },
                    .default(Text("Rename")) {
                        // Show rename dialog
                    },
                    .destructive(Text("Delete")) {
                        if let remote = actionSheetRemote {
                            deleteRemote(remote)
                        }
                    },
                    .cancel()
                ]
            )
        }
        .onAppear {
            loadRemotes()
            setupJavaScriptEngine()
        }
    }
    
    // MARK: - Custom Views
    
    func sectionHeader(_ title: String, isExpanded: Binding<Bool>) -> some View {
        Button(action: {
            isExpanded.wrappedValue.toggle()
        }) {
            HStack {
                Text(title)
                    .font(.headline)
                    .foregroundColor(.primary)
                Spacer()
                Image(systemName: isExpanded.wrappedValue ? "chevron.up" : "chevron.down")
                    .foregroundColor(.gray)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(Color(.systemBackground))
            .overlay(
                Rectangle()
                    .frame(height: 1)
                    .foregroundColor(Color.gray.opacity(0.3)),
                alignment: .bottom
            )
        }
    }
    
    // MARK: - Remote Management
    
    func loadRemotes() {
        let fileManager = FileManager.default
        guard let documentsURL = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        
        do {
            let fileURLs = try fileManager.contentsOfDirectory(at: documentsURL, includingPropertiesForKeys: nil)
            let jsonURLs = fileURLs.filter { $0.pathExtension == "json" }
            
            remotes = try jsonURLs.compactMap { url in
                let data = try Data(contentsOf: url)
                let decoder = JSONDecoder()
                return try decoder.decode(Remote.self, from: data)
            }
        } catch {
            print("Error loading remotes: \(error)")
        }
    }
    
    func createNewRemote(name: String) {
        let newRemote = Remote(name: name, buttons: [])
        saveRemote(newRemote)
        remotes.append(newRemote)
        selectedRemote = newRemote
    }
    
    func saveRemote(_ remote: Remote) {
        guard let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let fileURL = documentsURL.appendingPathComponent("\(remote.name).json")
        
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = .prettyPrinted
            let data = try encoder.encode(remote)
            try data.write(to: fileURL)
        } catch {
            print("Error saving remote: \(error)")
        }
    }
    
    func deleteRemote(_ remote: Remote) {
        guard let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let fileURL = documentsURL.appendingPathComponent("\(remote.name).json")
        
        do {
            try FileManager.default.removeItem(at: fileURL)
            if let index = remotes.firstIndex(where: { $0.id == remote.id }) {
                remotes.remove(at: index)
            }
            if selectedRemote?.id == remote.id {
                selectedRemote = nil
            }
        } catch {
            print("Error deleting remote: \(error)")
        }
    }
    
    func exportRemote(_ remote: Remote) {
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = .prettyPrinted
            let data = try encoder.encode(remote)
            exportContent = String(data: data, encoding: .utf8) ?? ""
            showingExportSheet = true
        } catch {
            print("Error exporting remote: \(error)")
        }
    }
    
    // MARK: - Button Management
    
    func addButtonToRemote(name: String, color: String, script: String) {
        guard var selectedRemote = selectedRemote else { return }
        
        let newButton = Remote.Button(name: name, color: color, script: script)
        selectedRemote.buttons.append(newButton)
        
        if let index = remotes.firstIndex(where: { $0.id == selectedRemote.id }) {
            remotes[index] = selectedRemote
        }
        
        saveRemote(selectedRemote)
        self.selectedRemote = selectedRemote
    }
    
    func updateButton(index: Int, name: String, color: String, script: String) {
        guard var selectedRemote = selectedRemote else { return }
        
        if index < selectedRemote.buttons.count {
            selectedRemote.buttons[index] = Remote.Button(name: name, color: color, script: script)
            
            if let remoteIndex = remotes.firstIndex(where: { $0.id == selectedRemote.id }) {
                remotes[remoteIndex] = selectedRemote
            }
            
            saveRemote(selectedRemote)
            self.selectedRemote = selectedRemote
        }
    }
    
    // MARK: - Script Execution
    
    func setupJavaScriptEngine() {
        jsEngine.setupContext { message in
            print("JS: \(message)")
        }
        
        if let docDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
            jsEngine.registerLoadFunction(scriptDirectoryURL: docDir)
        }
    }
    
    func executeScript(_ script: String) {
        jsEngine.evaluateScript(script)
    }
    
    // MARK: - Utilities
    
    func colorFromString(_ colorString: String) -> Color {
        switch colorString.lowercased() {
        case "red":
            return Color.red
        case "green":
            return Color.green
        default:
            return Color.gray
        }
    }
    
    func loadFromStorage() {
        // Implement document picker to import JSON files
    }
}

// MARK: - Supporting Views

struct AddRemoteView: View {
    @State private var remoteName: String = ""
    @Environment(\.presentationMode) var presentationMode
    var onSave: (String) -> Void
    
    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Remote Details")) {
                    TextField("Remote Name", text: $remoteName)
                }
            }
            .navigationTitle("Add Remote")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        presentationMode.wrappedValue.dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        if !remoteName.isEmpty {
                            onSave(remoteName)
                        }
                    }
                    .disabled(remoteName.isEmpty)
                }
            }
        }
    }
}

struct AddButtonView: View {
    @State private var buttonName: String = ""
    @State private var selectedColor: String = "red"
    @State private var script: String = """
// Better error reporting in JavaScriptEngine could be implemented by:
// 1. Adding a try-catch in JavaScriptEngine.evaluateScript that captures line numbers
// 2. Modifying the exceptionHandler in setupContext to include line information
// 3. Adding a debug mode to show more detailed error information

try {
    // This is a simple script to toggle GPIO1 
    // Since we can't create NSData directly, let's try with a different approach
    
    print("Toggling GPIO1");
    
    // Create byte arrays directly
    var highCommand = new Uint8Array([
        103, 112, 105, 111,  // ASCII for "gpio"
        1,                   // Pin 1
        87,                  // ASCII for "W" (write)
        1                    // HIGH value
    ]);
    
    print("Sending HIGH command to GPIO1");
    
    // Use the BLEService.sendPacket method directly
    // Use the array buffer as the parameter instead of the array itself
    BLEService.sendPacket(highCommand.buffer);
    
    print("GPIO1 set to HIGH");
    
    // Wait for 1 second
    Utils.delay(1000);
    
    var lowCommand = new Uint8Array([
        103, 112, 105, 111,  // ASCII for "gpio"
        1,                   // Pin 1
        87,                  // ASCII for "W" (write)
        0                    // LOW value
    ]);
    
    print("Sending LOW command to GPIO1");
    BLEService.sendPacket(lowCommand.buffer);
    
    print("GPIO1 set to LOW");
    print("Toggle completed successfully");
} catch (e) {
    print("Error at line: " + (e.line || "unknown"));
    print("Error message: " + e.message);
    print("Stack trace: " + (e.stack || "not available"));
}
"""
    @Environment(\.presentationMode) var presentationMode
    var onSave: (String, String, String) -> Void
    
    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Button Details")) {
                    TextField("Button Name", text: $buttonName)
                    
                    Picker("Color", selection: $selectedColor) {
                        Text("Red").tag("red")
                        Text("Green").tag("green")
                    }
                    .pickerStyle(SegmentedPickerStyle())
                }
                
                Section(header: Text("Script")) {
                    TextEditor(text: $script)
                        .frame(minHeight: 200)
                        .font(.system(size: 14, design: .monospaced))
                }
            }
            .navigationTitle("Add Button")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        presentationMode.wrappedValue.dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        if !buttonName.isEmpty && !script.isEmpty {
                            onSave(buttonName, selectedColor, script)
                        }
                    }
                    .disabled(buttonName.isEmpty || script.isEmpty)
                }
            }
        }
    }
}

struct EditButtonView: View {
    let button: Remote.Button
    @State private var buttonName: String
    @State private var selectedColor: String
    @State private var script: String
    @Environment(\.presentationMode) var presentationMode
    var onSave: (String, String, String) -> Void
    
    init(button: Remote.Button, onSave: @escaping (String, String, String) -> Void) {
        self.button = button
        self._buttonName = State(initialValue: button.name)
        self._selectedColor = State(initialValue: button.color)
        self._script = State(initialValue: button.script)
        self.onSave = onSave
    }
    
    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Button Details")) {
                    TextField("Button Name", text: $buttonName)
                    
                    Picker("Color", selection: $selectedColor) {
                        Text("Red").tag("red")
                        Text("Green").tag("green")
                    }
                    .pickerStyle(SegmentedPickerStyle())
                }
                
                Section(header: Text("Script")) {
                    TextEditor(text: $script)
                        .frame(minHeight: 200)
                        .font(.system(size: 14, design: .monospaced))
                }
            }
            .navigationTitle("Edit Button")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        presentationMode.wrappedValue.dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        if !buttonName.isEmpty && !script.isEmpty {
                            onSave(buttonName, selectedColor, script)
                        }
                    }
                    .disabled(buttonName.isEmpty || script.isEmpty)
                }
            }
        }
    }
}

struct ExportView: View {
    let content: String
    @Environment(\.presentationMode) var presentationMode
    
    var body: some View {
        NavigationView {
            ScrollView {
                Text(content)
                    .font(.system(size: 14, design: .monospaced))
                    .padding()
            }
            .navigationTitle("Export JSON")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    ShareLink(item: content) {
                        Image(systemName: "square.and.arrow.up")
                    }
                }
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") {
                        presentationMode.wrappedValue.dismiss()
                    }
                }
            }
        }
    }
}

// MARK: - Preview

#Preview {
    NavigationView {
        ButtonsView()
            .environmentObject(BLEManager())
    }
} 