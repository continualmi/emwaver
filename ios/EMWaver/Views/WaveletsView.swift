import SwiftUI

struct WaveletsView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @EnvironmentObject var bleManager: BLEManager
    @StateObject private var viewModel = WaveletsViewModel()
    @StateObject private var previewManager = WaveletPreviewManager()
    @State private var editorSession: EditorSession?
    @State private var showingPreview = false
    @State private var showingIRDBSheet = false
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
            .sheet(isPresented: $showingIRDBSheet) {
                if let token = authManager.accessToken, !token.isEmpty {
                    IRDBImportView(
                        accessToken: token,
                        service: IRDBService.shared,
                        onDismiss: { showingIRDBSheet = false },
                        onWaveletImported: { wavelet in
                            Task {
                                await viewModel.importWavelet(wavelet: wavelet, accessToken: token)
                            }
                        }
                    )
                } else {
                    Text("Authentication required")
                        .padding()
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
                    guard let token = authManager.accessToken, !token.isEmpty else {
                        viewModel.notice = WaveletsViewModel.Notice(title: "Error", message: "Missing access token")
                        return
                    }
                    editorSession = nil
                    Task {
                        await viewModel.deleteScript(id: target.id, accessToken: token)
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
            Text("Create a new script or import one from the IRDB catalogue.")
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
        guard let token = authManager.accessToken, !token.isEmpty else { return }
        Task {
            await viewModel.loadScripts(accessToken: token)
        }
    }

    private func openPreview(for id: String) {
        guard let token = authManager.accessToken, !token.isEmpty else {
            viewModel.notice = WaveletsViewModel.Notice(title: "Error", message: "Missing access token")
            return
        }
        viewModel.selectScript(id: id)
        Task {
            await viewModel.ensureContent(for: id, accessToken: token)
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
        guard let token = authManager.accessToken, !token.isEmpty else {
            viewModel.notice = WaveletsViewModel.Notice(title: "Error", message: "Missing access token")
            return
        }
        viewModel.selectScript(id: id)
        Task {
            await viewModel.ensureContent(for: id, accessToken: token)
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
        guard let token = authManager.accessToken, !token.isEmpty else {
            viewModel.notice = WaveletsViewModel.Notice(title: "Error", message: "Missing access token")
            return
        }
        Task {
            await viewModel.syncScripts(accessToken: token)
        }
    }

    private func editorSheet(for session: EditorSession) -> some View {
        guard let token = authManager.accessToken, !token.isEmpty else {
            return AnyView(Text("Authentication required").padding())
        }
        return AnyView(
            ScriptEditorSheet(
                scriptId: session.id,
                viewModel: viewModel,
                accessToken: token,
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
        guard let token = authManager.accessToken, !token.isEmpty else {
            viewModel.notice = WaveletsViewModel.Notice(title: "Error", message: "Missing access token")
            return
        }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

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

                Button {
                    showingIRDBSheet = true
                } label: {
                    Label("Import from IRDB", systemImage: "antenna.radiowaves.left.and.right")
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

private struct IRDBImportView: View {
    @Environment(\.dismiss) private var dismiss
    let accessToken: String
    let service: IRDBService
    let onDismiss: () -> Void
    let onWaveletImported: (IRDBImportedWavelet) -> Void

    var body: some View {
        NavigationStack {
            BrandListView(
                accessToken: accessToken,
                service: service,
                onWaveletImported: { wavelet in
                    onWaveletImported(wavelet)
                    dismiss()
                    onDismiss()
                }
            )
            .navigationTitle("Select Brand")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") {
                        dismiss()
                        onDismiss()
                    }
                }
            }
        }
    }
}

private struct BrandListView: View {
    let accessToken: String
    let service: IRDBService
    let onWaveletImported: (IRDBImportedWavelet) -> Void

    @State private var brands: [String] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchText: String = ""

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading brands…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(filteredBrands, id: \.self) { brand in
                    NavigationLink(brand) {
                        RemoteListView(
                            brand: brand,
                            accessToken: accessToken,
                            service: service,
                            onWaveletImported: onWaveletImported
                        )
                        .navigationTitle(brand)
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .searchable(text: $searchText, prompt: "Search brands")
        .alert(isPresented: Binding<Bool>(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Alert(title: Text("Error"), message: Text(errorMessage ?? ""), dismissButton: .default(Text("OK")))
        }
        .task { await loadBrands() }
    }

    private var filteredBrands: [String] {
        let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return brands }
        return brands.filter { $0.localizedCaseInsensitiveContains(trimmed) }
    }

    private func loadBrands() async {
        isLoading = true
        do {
            brands = try await service.fetchBrands(accessToken: accessToken).sorted()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

private struct RemoteListView: View {
    let brand: String
    let accessToken: String
    let service: IRDBService
    let onWaveletImported: (IRDBImportedWavelet) -> Void

    @State private var remotes: [IRDBRemoteSummary] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchText: String = ""

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading remotes…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(filteredRemotes) { remote in
                    NavigationLink(remote.name) {
                        VariantListView(
                            brand: brand,
                            remote: remote.name,
                            accessToken: accessToken,
                            service: service,
                            onWaveletImported: onWaveletImported
                        )
                        .navigationTitle(remote.name)
                    }
                    .badge(remote.variantCount)
                }
                .listStyle(.insetGrouped)
            }
        }
        .searchable(text: $searchText, prompt: "Search remotes")
        .alert(isPresented: Binding<Bool>(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Alert(title: Text("Error"), message: Text(errorMessage ?? ""), dismissButton: .default(Text("OK")))
        }
        .task { await loadRemotes() }
    }

    private var filteredRemotes: [IRDBRemoteSummary] {
        let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return remotes }
        return remotes.filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
    }

    private func loadRemotes() async {
        isLoading = true
        do {
            remotes = try await service.fetchRemotes(brand: brand, accessToken: accessToken).sorted(by: { $0.name < $1.name })
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

private struct VariantListView: View {
    @Environment(\.dismiss) private var dismiss
    let brand: String
    let remote: String
    let accessToken: String
    let service: IRDBService
    let onWaveletImported: (IRDBImportedWavelet) -> Void

    @State private var variants: [String] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchText: String = ""
    @State private var importProgress: IRDBImportProgress?

    var body: some View {
        Group {
            if isLoading {
                if let progress = importProgress {
                    VStack(spacing: 12) {
                        if progress.total > 0 {
                            ProgressView(value: Double(progress.processed), total: Double(progress.total))
                        } else {
                            ProgressView()
                        }
                        Text(progress.formatted)
                            .font(.footnote)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ProgressView("Loading variants…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                List(filteredVariants, id: \.self) { variant in
                    Button(action: { importVariant(named: variant) }) {
                        HStack {
                            Text(variant)
                            Spacer()
                            Image(systemName: "square.and.arrow.down")
                                .foregroundColor(.accentColor)
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .searchable(text: $searchText, prompt: "Search variants")
        .alert(isPresented: Binding<Bool>(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Alert(title: Text("Error"), message: Text(errorMessage ?? ""), dismissButton: .default(Text("OK")))
        }
        .task { await loadVariants() }
    }

    private var filteredVariants: [String] {
        let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return variants }
        return variants.filter { $0.localizedCaseInsensitiveContains(trimmed) }
    }

    private func loadVariants() async {
        isLoading = true
        do {
            variants = try await service.fetchVariants(brand: brand, remote: remote, accessToken: accessToken).sorted()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func importVariant(named fileName: String) {
        isLoading = true
        importProgress = IRDBImportProgress(processed: 0, total: 0)
        Task {
            do {
                let wavelet = try await service.importRemote(
                    brand: brand,
                    remote: remote,
                    fileName: fileName,
                    accessToken: accessToken
                ) { progress in
                    importProgress = progress
                }
                onWaveletImported(wavelet)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
                isLoading = false
            }
        }
    }
}
