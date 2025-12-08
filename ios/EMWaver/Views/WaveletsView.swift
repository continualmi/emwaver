import SwiftUI

struct WaveletsView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @EnvironmentObject var bleManager: BLEManager
    @StateObject private var viewModel = WaveletsViewModel()
    @StateObject private var previewManager = WaveletPreviewManager()
    @State private var editorSession: EditorSession?
    @State private var showingPreview = false
    @State private var namePrompt: NamePrompt?
    @State private var deleteTarget: DeletionTarget?
    @State private var showingDeleteConfirmation = false
    @State private var searchQuery: String = ""

    var body: some View {
        NavigationStack {
            ZStack {
                content

                if viewModel.isPerformingAction {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .padding(24)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .shadow(radius: 12)
                }
            }
            .navigationTitle("Wavelets")
            .toolbar { toolbarContent() }
            .searchable(text: $searchQuery, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search scripts")
            .alert(item: $viewModel.notice) { notice in
                Alert(title: Text(notice.title), message: Text(notice.message), dismissButton: .default(Text("OK")))
            }
            .sheet(item: $editorSession) { session in
                editorSheet(for: session)
            }
            .sheet(isPresented: $showingPreview) {
                WaveletPreviewSheet(previewManager: previewManager) {
                    showingPreview = false
                }
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
                    editorSession = nil
                    Task {
                        await viewModel.deleteScript(id: target.id, accessToken: authManager.accessToken ?? "local-only-token")
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

    private var content: some View {
        Group {
            if filteredScripts.isEmpty {
                emptyState
            } else {
                List {
                    Section {
                        ForEach(filteredScripts) { script in
                            ScriptRow(
                                script: script,
                                isSelected: script.id == viewModel.selectedScriptId,
                                onPreview: { openPreview(for: script.id) },
                                onEdit: { openEditor(for: script.id) }
                            )
                            .swipeActions(edge: .trailing) {
                                Button("Preview") {
                                    openPreview(for: script.id)
                                }
                                .tint(.indigo)

                                Button("Edit") {
                                    openEditor(for: script.id)
                                }
                                .tint(.blue)
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
    }

    private var filteredScripts: [WaveletsViewModel.ScriptListItem] {
        let scripts = viewModel.scripts
        let trimmed = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return scripts }
        return scripts.filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "doc.text")
                .font(.system(size: 44))
                .foregroundColor(.secondary)
            Text("No scripts available")
                .font(.headline)
            Text("Create a new script to get started.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            Button(action: openNewScriptEditor) {
                Label("New Script", systemImage: "plus")
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private func loadScripts() {
        Task {
            await viewModel.loadScripts(accessToken: authManager.accessToken ?? "local-only-token")
        }
    }

    private func openPreview(for id: String) {
        viewModel.selectScript(id: id)
        Task {
            await viewModel.ensureContent(for: id, accessToken: authManager.accessToken ?? "local-only-token")
            await MainActor.run {
                let script = viewModel.scriptDraft(for: id)
                let name = viewModel.scriptName(for: id)
                let modules = viewModel.moduleSources()
                previewManager.render(script: script, name: name, moduleSources: modules)
                showingPreview = true
            }
        }
    }

    private func openEditor(for id: String) {
        viewModel.selectScript(id: id)
        Task {
            await viewModel.ensureContent(for: id, accessToken: authManager.accessToken ?? "local-only-token")
            await MainActor.run {
                editorSession = EditorSession(id: id)
            }
        }
    }

    private func openNewScriptEditor() {
        viewModel.selectScript(id: viewModel.unsavedIdentifier)
        editorSession = EditorSession(id: viewModel.unsavedIdentifier)
    }

    private func syncScripts() {
        Task {
            await viewModel.syncScripts(accessToken: authManager.accessToken ?? "local-only-token")
        }
    }

    private func editorSheet(for session: EditorSession) -> some View {
        ScriptEditorSheet(
            scriptId: session.id,
            viewModel: viewModel,
            accessToken: authManager.accessToken ?? "local-only-token",
            onDismiss: { editorSession = nil },
            onRequestCreate: { presentNamePrompt(context: .create) },
            onRequestRename: { presentNamePrompt(context: .rename(id: session.id)) },
            onRequestCopy: { presentNamePrompt(context: .copy(id: session.id)) },
            onRequestDelete: {
                    deleteTarget = DeletionTarget(id: session.id, name: viewModel.scriptName(for: session.id))
                    showingDeleteConfirmation = true
            },
            onRequestPreview: { openPreview(for: session.id) }
        )
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
        let token = authManager.accessToken ?? "local-only-token"

        Task {
            switch context {
            case .create:
                if let newId = await viewModel.createScript(name: trimmed, accessToken: token) {
                    await MainActor.run {
                        editorSession = EditorSession(id: newId)
                    }
                }
            case .rename(let id):
                await viewModel.renameScript(id: id, newName: trimmed, accessToken: token)
            case .copy(let id):
                if let newId = await viewModel.copyScript(id: id, newName: trimmed, accessToken: token) {
                    await MainActor.run {
                        editorSession = EditorSession(id: newId)
                    }
                }
            }
        }
    }

    @ToolbarContentBuilder
    private func toolbarContent() -> some ToolbarContent {
        ToolbarItem(placement: .navigationBarTrailing) {
            Menu {
                Button {
                    openNewScriptEditor()
                } label: {
                    Label("New Script", systemImage: "plus")
                }

                Button {
                    syncScripts()
                } label: {
                    Label("Sync Scripts", systemImage: "arrow.triangle.2.circlepath")
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

private struct EditorSession: Identifiable {
    let id: String
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

private struct ScriptRow: View {
    let script: WaveletsViewModel.ScriptListItem
    let isSelected: Bool
    let onPreview: () -> Void
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
            }
            .buttonStyle(.plain)
            .padding(.leading, 8)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onPreview)
    }
}

private struct ScriptEditorSheet: View {
    let scriptId: String
    @ObservedObject var viewModel: WaveletsViewModel
    let accessToken: String
    let onDismiss: () -> Void
    let onRequestCreate: () -> Void
    let onRequestRename: () -> Void
    let onRequestCopy: () -> Void
    let onRequestDelete: () -> Void
    let onRequestPreview: () -> Void

    private var isExisting: Bool {
        viewModel.isExistingScript(scriptId)
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                TextEditor(text: viewModel.draftBinding(for: scriptId))
                    .font(.system(.body, design: .monospaced))
                    .frame(minHeight: 280)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.secondary.opacity(0.2))
                    )

                if viewModel.isScriptDirty(scriptId) {
                    Label("Changes not yet saved", systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundColor(.orange)
                }

                Spacer()
            }
            .padding()
            .navigationTitle(viewModel.scriptName(for: scriptId))
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") { onDismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(isExisting ? "Save" : "Create") {
                        save()
                    }
                }
                ToolbarItemGroup(placement: .bottomBar) {
                    Button("Preview", action: onRequestPreview)
                        .disabled(viewModel.scriptDraft(for: scriptId).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    Spacer()

                    if isExisting {
                        Button("Rename", action: onRequestRename)
                        Button("Copy", action: onRequestCopy)
                        Button("Delete", role: .destructive, action: onRequestDelete)
                    }
                }
            }
        }
    }

    private func save() {
        if isExisting {
            Task { await viewModel.saveScript(id: scriptId, accessToken: accessToken) }
        } else {
            onRequestCreate()
        }
    }
}

private struct WaveletPreviewSheet: View {
    @ObservedObject var previewManager: WaveletPreviewManager
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
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

                Divider()

                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(previewManager.consoleLines.enumerated()), id: \.offset) { _, line in
                            Text(line)
                                .font(.system(.caption, design: .monospaced))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding()
                }
                .frame(maxHeight: 200)
                .background(Color(uiColor: .systemBackground))
            }
            .navigationTitle(previewManager.activeScriptName ?? "Wavelet Preview")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") { onClose() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Clear Console") { previewManager.clearConsole() }
                        .disabled(previewManager.consoleLines.isEmpty)
                }
            }
            .alert(item: $previewManager.dialog) { dialog in
                Alert(title: Text(dialog.title), message: Text(dialog.message), dismissButton: .default(Text("OK")))
            }
        }
    }
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

