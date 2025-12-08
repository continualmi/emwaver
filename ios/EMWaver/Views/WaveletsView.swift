import SwiftUI

struct WaveletsView: View {
    @EnvironmentObject var bleManager: BLEManager
    @StateObject private var viewModel = WaveletsViewModel()
    @StateObject private var previewManager = WaveletPreviewManager()
    @State private var showingEditor = false
    @State private var showingPreview = false
    @State private var currentScriptId: String?
    @State private var editorContent: String = ""
    @State private var lineWrapEnabled = false
    @State private var consoleExpanded = false
    @State private var namePrompt: NamePrompt?
    @State private var deleteTarget: DeletionTarget?
    @State private var showingDeleteConfirmation = false

    var body: some View {
        NavigationStack {
            ZStack {
                if showingEditor {
                    editorView
                } else {
                    mainView
                }
                
                if viewModel.isPerformingAction {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .padding(24)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .shadow(radius: 12)
                }
            }
            .navigationTitle(showingEditor ? (currentScriptName ?? "Wavelet") : (showingPreview ? (currentScriptName ?? "Wavelet Preview") : "Wavelets"))
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(showingPreview)
            .toolbar { toolbarContent() }
            .alert(item: $viewModel.notice) { notice in
                Alert(title: Text(notice.title), message: Text(notice.message), dismissButton: .default(Text("OK")))
            }
            .alert(item: $previewManager.dialog) { dialog in
                Alert(title: Text(dialog.title), message: Text(dialog.message), dismissButton: .default(Text("OK")))
            }
            .sheet(item: $namePrompt) { prompt in
                NamePromptSheet(prompt: prompt)
            }
            .confirmationDialog(
                "Delete script?",
                isPresented: $showingDeleteConfirmation,
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    guard let target = deleteTarget else { return }
                    Task {
                        await viewModel.deleteScript(id: target.id)
                    }
                    deleteTarget = nil
                }
                Button("Cancel", role: .cancel) {
                    deleteTarget = nil
                }
            } message: {
                if let target = deleteTarget {
                    Text("Are you sure you want to delete \(target.name)?")
                }
            }
            .onAppear {
                previewManager.attach(bleManager: bleManager)
                loadScripts()
            }
            .onChange(of: bleManager.isConnected) { connected in
                previewManager.updateConnectionState(isConnected: connected)
            }
        }
    }
    
    private var mainView: some View {
        Group {
            if showingPreview {
                // Preview mode: full screen preview with console at bottom
                VStack(spacing: 0) {
                    // Wavelet preview fills available space
                    ZStack {
                        WaveletRenderView(tree: previewManager.waveletTree) { token, args in
                            previewManager.invoke(token: token, arguments: args)
                        }
                        .opacity(previewManager.waveletTree == nil ? 0 : 1)
                        
                        if previewManager.waveletTree == nil {
                            VStack {
                                if previewManager.isRendering {
                                    ProgressView("Rendering…")
                                } else {
                                    Text("Render a wavelet to preview it here.")
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(uiColor: .secondarySystemBackground))
                    
                    // Console section at bottom
                    VStack(spacing: 0) {
                        HStack {
                            Text("Console Output")
                                .font(.headline)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 8)
                            Spacer()
                            Button(action: { consoleExpanded.toggle() }) {
                                Image(systemName: consoleExpanded ? "chevron.up" : "chevron.down")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            .padding(.trailing, 8)
                        }
                        .background(Color(uiColor: .secondarySystemBackground))
                        .onTapGesture {
                            consoleExpanded.toggle()
                        }
                        
                        if consoleExpanded {
                            Divider()
                            
                            ScrollViewReader { proxy in
                                ScrollView {
                                    VStack(alignment: .leading, spacing: 4) {
                                        if previewManager.consoleLines.isEmpty {
                                            Text("Console is empty.")
                                                .foregroundColor(.secondary)
                                                .padding()
                                        } else {
                                            ForEach(Array(previewManager.consoleLines.enumerated()), id: \.offset) { index, line in
                                                Text(line)
                                                    .font(.system(.caption, design: .monospaced))
                                                    .frame(maxWidth: .infinity, alignment: .leading)
                                                    .id(index)
                                            }
                                            .padding(.horizontal, 12)
                                            .padding(.vertical, 12)
                                        }
                                    }
                                }
                                .frame(maxHeight: 200)
                                .background(Color(uiColor: .systemBackground))
                                .onChange(of: previewManager.consoleLines.count) { _, _ in
                                    if !previewManager.consoleLines.isEmpty {
                                        withAnimation {
                                            proxy.scrollTo(previewManager.consoleLines.count - 1, anchor: .bottom)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    .background(Color(uiColor: .secondarySystemBackground))
                }
            } else {
                // Normal mode: scripts list fills the view
                if viewModel.scripts.isEmpty {
                    VStack(spacing: 8) {
                        Text("No scripts available")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        Button(action: openNewScriptEditor) {
                            Label("New Script", systemImage: "plus")
                                .font(.caption)
                        }
                        .buttonStyle(.bordered)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        ForEach(viewModel.scripts) { script in
                            ScriptRow(
                                script: script,
                                isSelected: script.id == viewModel.selectedScriptId,
                                onTap: { previewScript(script.id) },
                                onEdit: { openEditor(for: script.id) }
                            )
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
        }
    }
    
    private var editorView: some View {
        VStack(spacing: 0) {
            if lineWrapEnabled {
                ScrollView {
                    TextEditor(text: $editorContent)
                        .font(.system(.body, design: .monospaced))
                        .frame(minHeight: 300)
                        .padding()
                        .onChange(of: editorContent) { _, newValue in
                            if let id = currentScriptId {
                                viewModel.updateDraft(for: id, content: newValue)
                            }
                        }
                }
            } else {
                ScrollView(.horizontal) {
                    TextEditor(text: $editorContent)
                        .font(.system(.body, design: .monospaced))
                        .frame(minWidth: 300, minHeight: 300)
                        .padding()
                        .onChange(of: editorContent) { _, newValue in
                            if let id = currentScriptId {
                                viewModel.updateDraft(for: id, content: newValue)
                            }
                        }
                }
            }
            
            if let id = currentScriptId, viewModel.isScriptDirty(id) {
                HStack {
                    Label("Changes not yet saved", systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundColor(.orange)
                    Spacer()
                }
                .padding(.horizontal)
                .padding(.bottom, 8)
            }
        }
        .background(Color(uiColor: .systemBackground))
    }
    
    private var currentScriptName: String? {
        guard let id = currentScriptId else { return nil }
        return viewModel.scriptName(for: id)
    }
    
    private func loadScripts() {
        Task {
            await viewModel.loadScripts()
        }
    }
    
    private func previewScript(_ id: String) {
        // Save current editor content if editing
        if showingEditor, let currentId = currentScriptId {
            viewModel.updateDraft(for: currentId, content: editorContent)
        }
        
        viewModel.selectScript(id: id)
        currentScriptId = id
        Task {
            await viewModel.ensureContent(for: id)
            await MainActor.run {
                let script = viewModel.scriptDraft(for: id)
                let name = viewModel.scriptName(for: id)
                let modules = viewModel.moduleSources()
                previewManager.render(script: script, name: name, moduleSources: modules)
                showingPreview = true
                showingEditor = false
                consoleExpanded = false
            }
        }
    }
    
    private func openEditor(for id: String) {
        viewModel.selectScript(id: id)
        currentScriptId = id
        Task {
            await viewModel.ensureContent(for: id)
            await MainActor.run {
                editorContent = viewModel.scriptDraft(for: id)
                showingEditor = true
                showingPreview = false
            }
        }
    }
    
    private func openNewScriptEditor() {
        viewModel.selectScript(id: viewModel.unsavedIdentifier)
        currentScriptId = viewModel.unsavedIdentifier
        editorContent = viewModel.scriptDraft(for: viewModel.unsavedIdentifier)
        showingEditor = true
        showingPreview = false
    }
    
    private func exitEditor() {
        showingEditor = false
        currentScriptId = nil
        editorContent = ""
    }
    
    private func exitPreview() {
        showingPreview = false
        currentScriptId = nil
        previewManager.exitPreview()
        consoleExpanded = false
    }
    
    private func saveCurrentScript() {
        guard let id = currentScriptId else { return }
        if viewModel.isExistingScript(id) {
            Task {
                await viewModel.saveScript(id: id)
            }
        } else {
            presentNamePrompt(context: .create)
        }
    }
    
    private func presentNamePrompt(context: NamePromptContext) {
        let initial: String
        switch context {
        case .create:
            initial = "wavelet_script.js"
        case .rename(let id):
            initial = viewModel.scriptName(for: id)
        case .copy(let id):
            initial = viewModel.scriptName(for: id)
        }
        namePrompt = NamePrompt(
            context: context,
            title: context.title,
            message: context.message,
            initialValue: initial
        ) { name in
            handleName(context: context, name: name)
        }
    }
    
    private func handleName(context: NamePromptContext, name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        
        Task {
            switch context {
            case .create:
                if let newId = await viewModel.createScript(name: trimmed) {
                    await MainActor.run {
                        currentScriptId = newId
                        editorContent = viewModel.scriptDraft(for: newId)
                    }
                }
            case .rename(let id):
                await viewModel.renameScript(id: id, newName: trimmed)
            case .copy(let id):
                if let newId = await viewModel.copyScript(id: id, newName: trimmed) {
                    await MainActor.run {
                        currentScriptId = newId
                        editorContent = viewModel.scriptDraft(for: newId)
                    }
                }
            }
        }
    }
    
    @ToolbarContentBuilder
    private func toolbarContent() -> some ToolbarContent {
        if showingEditor {
            ToolbarItem(placement: .navigationBarLeading) {
                Button("Close") {
                    exitEditor()
                }
            }
            
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(currentScriptId != nil && viewModel.isExistingScript(currentScriptId!) ? "Save" : "Create") {
                    saveCurrentScript()
                }
            }
            
            ToolbarItemGroup(placement: .bottomBar) {
                Button("Preview") {
                    guard let id = currentScriptId else { return }
                    // Save editor content before previewing
                    viewModel.updateDraft(for: id, content: editorContent)
                    previewScript(id)
                }
                .disabled(editorContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                
                Spacer()
                
                Button(action: {
                    let pasteboard = UIPasteboard.general
                    if let string = pasteboard.string {
                        editorContent = string
                    }
                }) {
                    Label("Paste", systemImage: "doc.on.clipboard")
                }
                
                Button(action: {
                    let pasteboard = UIPasteboard.general
                    pasteboard.string = editorContent
                }) {
                    Label("Copy", systemImage: "doc.on.doc")
                }
                
                if currentScriptId != nil && viewModel.isExistingScript(currentScriptId!) {
                    Button(action: {
                        guard let id = currentScriptId else { return }
                        presentNamePrompt(context: .rename(id: id))
                    }) {
                        Label("Rename", systemImage: "pencil")
                    }
                    
                    Button(action: {
                        guard let id = currentScriptId else { return }
                        presentNamePrompt(context: .copy(id: id))
                    }) {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                    
                    Button(role: .destructive, action: {
                        guard let id = currentScriptId else { return }
                        deleteTarget = DeletionTarget(id: id, name: viewModel.scriptName(for: id))
                        showingDeleteConfirmation = true
                    }) {
                        Label("Delete", systemImage: "trash")
                    }
                }
                
                Button(action: { lineWrapEnabled.toggle() }) {
                    Label("Wrap", systemImage: lineWrapEnabled ? "text.word.spacing" : "text.alignleft")
                }
            }
        } else if showingPreview {
            ToolbarItem(placement: .navigationBarLeading) {
                Button(action: {
                    exitPreview()
                }) {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                        Text("Back")
                    }
                }
            }
            
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Clear Console") {
                    previewManager.clearConsole()
                }
                .disabled(previewManager.consoleLines.isEmpty)
            }
        } else {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button {
                        openNewScriptEditor()
                    } label: {
                        Label("New Script", systemImage: "plus")
                    }
                    
                    Button {
                        // Open file picker
                        // TODO: Implement file import
                    } label: {
                        Label("Open", systemImage: "folder")
                    }
                    
                    if let selected = viewModel.selectedScriptId, viewModel.isExistingScript(selected) {
                        Divider()
                        
                        Button {
                            presentNamePrompt(context: .copy(id: selected))
                        } label: {
                            Label("Make Copy", systemImage: "doc.on.doc")
                        }
                        
                        Button {
                            presentNamePrompt(context: .rename(id: selected))
                        } label: {
                            Label("Rename", systemImage: "pencil")
                        }
                        
                        Button(role: .destructive) {
                            deleteTarget = DeletionTarget(id: selected, name: viewModel.scriptName(for: selected))
                            showingDeleteConfirmation = true
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
    }
}

private struct ScriptRow: View {
    let script: WaveletsViewModel.ScriptListItem
    let isSelected: Bool
    let onTap: () -> Void
    let onEdit: () -> Void
    
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(script.name)
                    .font(isSelected ? .headline : .body)
                if script.isDirty {
                    Text("Unsaved changes")
                        .font(.caption)
                        .foregroundColor(.orange)
                }
            }
            Spacer()
            Button(action: onEdit) {
                Image(systemName: "pencil")
                    .foregroundColor(.blue)
            }
            .buttonStyle(.plain)
            .padding(.leading, 8)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
    }
}

private enum NamePromptContext {
    case create
    case rename(id: String)
    case copy(id: String)
    
    var title: String {
        switch self {
        case .create:
            return "Save Script"
        case .rename:
            return "Rename Script"
        case .copy:
            return "Copy Script"
        }
    }
    
    var message: String {
        switch self {
        case .create:
            return "Enter a name for the new script."
        case .rename:
            return "Enter a new name for this script."
        case .copy:
            return "Enter a name for the duplicated script."
        }
    }
}

private struct NamePrompt: Identifiable {
    let id = UUID()
    let context: NamePromptContext
    let title: String
    let message: String
    var initialValue: String
    let action: (String) -> Void
}

private struct DeletionTarget: Identifiable {
    let id: String
    let name: String
}

private struct NamePromptSheet: View {
    @Environment(\.dismiss) private var dismiss
    let prompt: NamePrompt
    @State private var value: String
    
    init(prompt: NamePrompt) {
        self.prompt = prompt
        _value = State(initialValue: prompt.initialValue)
    }
    
    var body: some View {
        NavigationStack {
            Form {
                Section(header: Text(prompt.message)) {
                    TextField("Script name", text: $value)
                        .textInputAutocapitalization(.none)
                        .autocorrectionDisabled()
                }
            }
            .navigationTitle(prompt.title)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        prompt.action(value)
                        dismiss()
                    }
                    .disabled(value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
