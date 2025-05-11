import SwiftUI
import JavaScriptCore
import Combine

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
    @State private var editingButton: Remote.Button?
    @State private var editingButtonIndex: Int?
    @State private var showingExportSheet = false
    @State private var exportContent: String = ""
    
    // New states for alert-based editing
    @State private var showingEditButtonSheet = false
    @State private var editButtonName = ""
    @State private var editButtonColor = ""
    @State private var editButtonScript = ""
    @FocusState private var editButtonFocusField: Field?
    
    // Collapsible sections state
    @State private var isRemoteListExpanded = true
    @State private var isButtonGridExpanded = true
    
    // JavaScript Engine
    @State private var jsEngine: JavaScriptEngine? = nil
    
    enum Field {
        case name, script
    }
    
    var body: some View {
        NavigationView {
            VStack(spacing: 8) {
                remoteListDisclosureGroup
                buttonGridDisclosureGroup
                Spacer()
            }
            .padding()
            .navigationTitle("Buttons")
            .navigationBarTitleDisplayMode(.inline)
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
                NavigationView {
                    Form {
                        Section(header: Text("Button Details")) {
                            TextField("Button Name", text: $editButtonName)
                                .focused($editButtonFocusField, equals: .name)
                            
                            Text("Button Color")
                                .font(.headline)
                                .padding(.top, 10)
                            
                            HStack(spacing: 20) {
                                ColorOptionView(title: "Normal", color: .gray, 
                                               isSelected: editButtonColor == "normal", 
                                               action: { editButtonColor = "normal" })
                                
                                ColorOptionView(title: "Red", color: .red, 
                                               isSelected: editButtonColor == "red", 
                                               action: { editButtonColor = "red" })
                                
                                ColorOptionView(title: "Green", color: .green, 
                                               isSelected: editButtonColor == "green", 
                                               action: { editButtonColor = "green" })
                            }
                            .padding(.bottom, 10)
                        }
                        
                        Section(header: Text("Script")) {
                            ZStack(alignment: .topLeading) {
                                TextEditor(text: $editButtonScript)
                                    .frame(minHeight: 200)
                                    .font(.system(size: 14, design: .monospaced))
                                    .focused($editButtonFocusField, equals: .script)
                                
                                if editButtonScript.isEmpty {
                                    Text("Enter script here...")
                                        .foregroundColor(.gray)
                                        .font(.system(size: 14, design: .monospaced))
                                        .padding(.top, 8)
                                        .padding(.leading, 5)
                                        .allowsHitTesting(false)
                                }
                            }
                        }
                    }
                    .navigationTitle("Edit Button")
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") {
                                showingEditButtonSheet = false
                            }
                        }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Save") {
                                if let index = editingButtonIndex, !editButtonName.isEmpty, !editButtonScript.isEmpty {
                                    updateButton(index: index, name: editButtonName, color: editButtonColor, script: editButtonScript)
                                }
                                showingEditButtonSheet = false
                            }
                            .disabled(editButtonName.isEmpty || editButtonScript.isEmpty)
                        }
                        
                        ToolbarItemGroup(placement: .keyboard) {
                            Spacer()
                            Button("Done") {
                                editButtonFocusField = nil
                            }
                        }
                    }
                }
                .onAppear {
                    // Focus the name field when view appears
                    editButtonFocusField = .name
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
                // Add this code for opaque navigation bar
                let appearance = UINavigationBarAppearance()
                appearance.configureWithOpaqueBackground()
                UINavigationBar.appearance().standardAppearance = appearance
                UINavigationBar.appearance().compactAppearance = appearance
                UINavigationBar.appearance().scrollEdgeAppearance = appearance
                // End of added code

                loadRemotes()
                setupJavaScriptEngine()
            }
            .animation(.easeInOut, value: isRemoteListExpanded)
            .animation(.easeInOut, value: isButtonGridExpanded)
        }
    }
    
    // MARK: - UI Components
    
    private var remoteListDisclosureGroup: some View {
        DisclosureGroup(
            isExpanded: $isRemoteListExpanded,
            content: {
                if remotes.isEmpty {
                    Text("No remotes available")
                        .italic()
                        .foregroundColor(.gray)
                        .padding()
                } else {
                    List {
                        ForEach(remotes) { remote in
                            Button(action: {
                                withAnimation {
                                    selectedRemote = remote
                                    isButtonGridExpanded = true
                                }
                            }) {
                                HStack {
                                    Text(remote.name)
                                        .foregroundColor(.primary)
                                    Spacer()
                                    if selectedRemote?.id == remote.id {
                                        Image(systemName: "checkmark")
                                            .foregroundColor(.blue)
                                    }
                                }
                                .contentShape(Rectangle())
                                .padding(.vertical, 8)
                            }
                            .buttonStyle(PlainButtonStyle())
                            .background(
                                selectedRemote?.id == remote.id ? Color.blue.opacity(0.2) : Color.clear
                            )
                            .cornerRadius(8)
                            .contextMenu {
                                Button("View JSON") {
                                    exportRemote(remote)
                                }
                                Button("Delete") {
                                    actionSheetRemote = remote
                                    showingActionSheet = true
                                }
                            }
                        }
                    }
                    .frame(height: 150)
                    .listStyle(PlainListStyle())
                }
            },
            label: {
                HStack {
                    Text("Remotes")
                        .font(.headline)
                    if !remotes.isEmpty {
                        Text("(\(remotes.count))")
                            .foregroundColor(.secondary)
                    }
                }
            }
        )
        .padding(.horizontal)
    }
    
    private var buttonGridDisclosureGroup: some View {
        DisclosureGroup(
            isExpanded: $isButtonGridExpanded,
            content: {
                buttonGridContent
            },
            label: {
                Text(selectedRemote != nil ? "Remote: \(selectedRemote!.name)" : "No remote selected")
                    .font(.headline)
            }
        )
        .padding(.horizontal)
    }
    
    @ViewBuilder
    private var buttonGridContent: some View {
        if let selectedRemote = selectedRemote {
            if selectedRemote.buttons.isEmpty {
                VStack(spacing: 16) {
                    Image(systemName: "rectangle.fill.badge.plus")
                        .font(.system(size: 40))
                        .foregroundColor(.gray)
                    Text("No buttons yet")
                        .font(.headline)
                        .foregroundColor(.gray)
                    Text("Tap '+' to add a button")
                        .font(.subheadline)
                        .foregroundColor(.gray.opacity(0.8))
                    Button("Add Button") {
                        showingAddButtonSheet = true
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 10)
                    .background(Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(8)
                }
                .frame(maxWidth: .infinity, maxHeight: 200)
                .padding()
            } else {
                buttonGrid(for: selectedRemote)
            }
        } else {
            Text("Select a remote to view buttons")
                .italic()
                .foregroundColor(.gray)
                .padding()
        }
    }
    
    private func buttonGrid(for remote: Remote) -> some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(Array(remote.buttons.enumerated()), id: \.element.id) { index, button in
                    buttonView(for: button, at: index)
                }
            }
            .padding()
        }
        .frame(maxWidth: .infinity)
    }
    
    private func buttonView(for button: Remote.Button, at index: Int) -> some View {
        Button(action: {
            // Add haptic feedback
            let impactMed = UIImpactFeedbackGenerator(style: .medium)
            impactMed.impactOccurred()
            
            executeScript(button.script)
        }) {
            Text(button.name)
                .frame(minWidth: 0, maxWidth: .infinity)
                .frame(height: 60)
                .background(colorFromString(button.color))
                .foregroundColor(.white)
                .cornerRadius(8)
        }
        .buttonStyle(ButtonPressStyle())
        .contextMenu {
            Button("Edit") {
                editingButton = button
                editingButtonIndex = index
                
                // Initialize edit values
                editButtonName = button.name
                editButtonColor = button.color
                editButtonScript = button.script
                
                // Show the edit sheet
                showingEditButtonSheet = true
            }
            
            Button("Delete") {
                if var currentRemote = selectedRemote {
                    currentRemote.buttons.remove(at: index)
                    
                    if let remoteIndex = remotes.firstIndex(where: { $0.id == currentRemote.id }) {
                        remotes[remoteIndex] = currentRemote
                        saveRemote(currentRemote)
                        selectedRemote = currentRemote
                    }
                }
            }
        }
    }
    
    // MARK: - Custom Views
    
    func sectionHeader(_ title: String, isExpanded: Binding<Bool>) -> some View {
        Button(action: {
            withAnimation(.easeInOut) {
                isExpanded.wrappedValue.toggle()
            }
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
                do {
                    let data = try Data(contentsOf: url)
                    let decoder = JSONDecoder()
                    return try decoder.decode(Remote.self, from: data)
                } catch {
                    print("Error loading remote from \(url.lastPathComponent): \(error)")
                    return nil
                }
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
        jsEngine = JavaScriptEngine(bleManager: bleManager)
        jsEngine?.setupContext { message in
            print("JS: \(message)")
        }
        
        if let docDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
            jsEngine?.registerLoadFunction(scriptDirectoryURL: docDir)
        }
    }
    
    func executeScript(_ script: String) {
        guard !script.isEmpty else {
            print("Warning: Attempted to execute empty script")
            return
        }
        
        // Run script evaluation on a background thread to prevent UI freezing
        DispatchQueue.global(qos: .userInitiated).async {
            self.jsEngine?.evaluateScript(script)
        }
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
    @FocusState private var isNameFieldFocused: Bool
    var onSave: (String) -> Void
    
    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Remote Details")) {
                    TextField("Remote Name", text: $remoteName)
                        .focused($isNameFieldFocused)
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
                
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") {
                        isNameFieldFocused = false
                    }
                }
            }
            .onAppear {
                // Focus the name field when view appears
                isNameFieldFocused = true
            }
        }
    }
}

struct AddButtonView: View {
    @State private var buttonName: String = ""
    @State private var selectedColor: String = "normal"
    @State private var script: String = """
try {
    // This is a simple script to toggle GPIO1 
    print("Toggling GPIO1");
    
    // Send command in correct binary format:
    // "gpio" (ASCII) + placeholder (0) + pin (raw byte) + 'W' (ASCII) + value (raw byte)
    var highCommand = new Uint8Array([
        103, 112, 105, 111,  // ASCII for "gpio"
        0,                   // Placeholder byte (needed by firmware)
        1,                   // Pin 1 as raw byte (0x01)
        87,                  // ASCII for "W"
        1                    // HIGH value as raw byte (0x01)
    ]);
    
    print("Sending HIGH command to GPIO1");
    BLEService.sendPacket(highCommand);
    
    print("GPIO1 set to HIGH");
    
    // Wait for 1 second
    Utils.sleep(1000);
    
    // ASCII for "gpio" + placeholder + raw pin + 'W' + raw value
    var lowCommand = new Uint8Array([
        103, 112, 105, 111,  // ASCII for "gpio"
        0,                   // Placeholder byte (needed by firmware)
        1,                   // Pin 1 as raw byte (0x01)
        87,                  // ASCII for "W"
        0                    // LOW value as raw byte (0x00)
    ]);
    
    print("Sending LOW command to GPIO1");
    BLEService.sendPacket(lowCommand);
    
    print("GPIO1 set to LOW");
    print("Toggle completed successfully");
} catch (e) {
    print("Error at line: " + (e.line || "unknown"));
    print("Error message: " + e.message);
    print("Stack trace: " + (e.stack || "not available"));
}
"""
    @Environment(\.presentationMode) var presentationMode
    @FocusState private var focusedField: Field?
    var onSave: (String, String, String) -> Void
    
    enum Field {
        case name, script
    }
    
    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Button Details")) {
                    TextField("Button Name", text: $buttonName)
                        .focused($focusedField, equals: .name)
                    
                    Text("Button Color")
                        .font(.headline)
                        .padding(.top, 10)
                    
                    HStack(spacing: 20) {
                        ColorOptionView(title: "Normal", color: .gray, 
                                       isSelected: selectedColor == "normal", 
                                       action: { selectedColor = "normal" })
                        
                        ColorOptionView(title: "Red", color: .red, 
                                       isSelected: selectedColor == "red", 
                                       action: { selectedColor = "red" })
                        
                        ColorOptionView(title: "Green", color: .green, 
                                       isSelected: selectedColor == "green", 
                                       action: { selectedColor = "green" })
                    }
                    .padding(.bottom, 10)
                }
                
                Section(header: Text("Script")) {
                    ZStack(alignment: .topLeading) {
                        TextEditor(text: $script)
                            .frame(minHeight: 200)
                            .font(.system(size: 14, design: .monospaced))
                            .focused($focusedField, equals: .script)
                        
                        if script.isEmpty {
                            Text("Enter script here...")
                                .foregroundColor(.gray)
                                .font(.system(size: 14, design: .monospaced))
                                .padding(.top, 8)
                                .padding(.leading, 5)
                                .allowsHitTesting(false)
                        }
                    }
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
                
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") {
                        focusedField = nil
                    }
                }
            }
            .onAppear {
                // Focus the name field when view appears
                focusedField = .name
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

// MARK: - Custom ButtonStyle for better tap feedback

struct ButtonPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(.easeInOut(duration: 0.1), value: configuration.isPressed)
    }
}

// MARK: - Helper Views

struct ColorOptionView: View {
    let title: String
    let color: Color
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        VStack {
            ZStack {
                Circle()
                    .fill(color)
                    .frame(width: 60, height: 60)
                    .overlay(
                        Circle()
                            .stroke(isSelected ? Color.blue : Color.gray, lineWidth: isSelected ? 3 : 1)
                    )
                
                if isSelected {
                    Image(systemName: "checkmark")
                        .foregroundColor(.white)
                        .font(.system(size: 20, weight: .bold))
                }
            }
            .onTapGesture {
                action()
            }
            
            Text(title)
                .font(.caption)
                .foregroundColor(isSelected ? .primary : .secondary)
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
