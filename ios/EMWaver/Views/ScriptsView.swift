/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import SwiftUI

struct ScriptsView: View {
    @EnvironmentObject var bleManager: USBManager
    @StateObject private var viewModel = ScriptsViewModel()
    @StateObject private var previewManager = ScriptPreviewManager()
    @State private var showingEditor = false
    @State private var showingPreview = false
    @State private var currentScriptId: String?
    @State private var editorContent: String = ""
    @State private var lineWrapEnabled = false
    @State private var consoleExpanded = false
    @State private var namePrompt: NamePrompt?
    @State private var deleteTarget: DeletionTarget?
    @State private var showingDeleteConfirmation = false
    @State private var assetPreview: AssetScriptPreview?

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
            .navigationTitle(showingEditor ? (currentScriptName ?? "Script") : (showingPreview ? (currentScriptName ?? "Script Preview") : "Scripts"))
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
            .sheet(item: $assetPreview) { preview in
                AssetScriptPreviewSheet(preview: preview)
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
                // Preview mode: full screen preview
                ZStack {
                    ScriptRenderView(tree: previewManager.scriptTree) { token, args in
                        previewManager.invoke(token: token, arguments: args)
                    }
                    .opacity(previewManager.scriptTree == nil ? 0 : 1)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    
                    if previewManager.scriptTree == nil {
                        VStack {
                            if previewManager.isRendering {
                                ProgressView("Rendering…")
                            } else {
                                Text("Render a script to preview it here.")
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(uiColor: .secondarySystemBackground))
            } else {
                // Normal mode: scripts list fills the view
                if viewModel.assetScripts.isEmpty && viewModel.customScripts.isEmpty {
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
                        if !viewModel.assetScripts.isEmpty {
                            Section("Asset Scripts (Read-Only)") {
                                ForEach(viewModel.assetScripts) { script in
                                    ScriptRow(
                                        script: script,
                                        isSelected: script.id == viewModel.selectedScriptId,
                                        onTap: { previewScript(script.id) },
                                        onEdit: { openAssetPreview(for: script.id) }
                                    )
                                    .listRowSeparator(.hidden)
                                    .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                                }
                            }
                        }

                        if !viewModel.customScripts.isEmpty {
                            Section("Custom Scripts") {
                                ForEach(viewModel.customScripts) { script in
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
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
        }
    }
    
    private var editorView: some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                if lineWrapEnabled {
                    // Line wrap enabled: TextEditor fills width, wraps naturally
                    TextEditor(text: $editorContent)
                        .font(.system(.body, design: .monospaced))
                        .scrollContentBackground(.hidden)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .onChange(of: editorContent) { _, newValue in
                            if let id = currentScriptId {
                                viewModel.updateDraft(for: id, content: newValue)
                            }
                        }
                } else {
                    // Line wrap disabled: Horizontal scrolling with wide TextEditor
                    ScrollView(.horizontal, showsIndicators: true) {
                        HStack(spacing: 0) {
                            TextEditor(text: $editorContent)
                                .font(.system(.body, design: .monospaced))
                                .scrollContentBackground(.hidden)
                                .frame(width: calculateTextWidth(editorContent))
                                .frame(minHeight: geometry.size.height)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                                .onChange(of: editorContent) { _, newValue in
                                    if let id = currentScriptId {
                                        viewModel.updateDraft(for: id, content: newValue)
                                    }
                                }
                            Spacer(minLength: 0)
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
    }
    
    private func calculateTextWidth(_ text: String) -> CGFloat {
        let lines = text.components(separatedBy: .newlines)
        let longestLine = lines.max(by: { $0.count < $1.count }) ?? ""
        // Approximate width: ~10 pixels per character for monospaced font at body size
        // Minimum width ensures editor is usable even with short lines
        let calculatedWidth = CGFloat(longestLine.count) * 10 + 200
        return max(600, calculatedWidth)
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
        if viewModel.isAssetScript(id) {
            openAssetPreview(for: id)
            return
        }
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
        if viewModel.isAssetScript(id) {
            return
        }
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
            initial = "script_script.emw"
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
            
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                // Preview button in toolbar
                Button(action: {
                    guard let id = currentScriptId else { return }
                    // Save editor content before previewing
                    viewModel.updateDraft(for: id, content: editorContent)
                    previewScript(id)
                }) {
                    Image(systemName: "play.fill")
                }
                .disabled(editorContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                
                // Menu with other actions
                Menu {
                    Button(action: {
                        let pasteboard = UIPasteboard.general
                        pasteboard.string = editorContent
                    }) {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                    
                    Button(action: {
                        let pasteboard = UIPasteboard.general
                        if let string = pasteboard.string {
                            editorContent = string
                        }
                    }) {
                        Label("Paste", systemImage: "doc.on.clipboard")
                    }
                    
                    if currentScriptId != nil && viewModel.isExistingScript(currentScriptId!) && !viewModel.isAssetScript(currentScriptId!) {
                        Divider()
                        
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
                            Label("Make Copy", systemImage: "doc.on.doc")
                        }
                        
                        Button(role: .destructive, action: {
                            guard let id = currentScriptId else { return }
                            deleteTarget = DeletionTarget(id: id, name: viewModel.scriptName(for: id))
                            showingDeleteConfirmation = true
                        }) {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                    
                    Divider()
                    
                    Button(action: {
                        lineWrapEnabled.toggle()
                    }) {
                        Label("Line Wrap", systemImage: lineWrapEnabled ? "text.word.spacing" : "text.alignleft")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                
                // Save/Create button
                Button(currentScriptId != nil && viewModel.isExistingScript(currentScriptId!) ? "Save" : "Create") {
                    saveCurrentScript()
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

                        if !viewModel.isAssetScript(selected) {
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
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
    }

    private func openAssetPreview(for id: String) {
        viewModel.selectScript(id: id)
        currentScriptId = id
        let content = viewModel.scriptDraft(for: id)
        let name = viewModel.scriptName(for: id)
        assetPreview = AssetScriptPreview(id: id, name: name, content: content)
    }
}

private struct ScriptRow: View {
    let script: ScriptsViewModel.ScriptListItem
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
                Image(systemName: script.isAsset ? "eye" : "pencil")
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

private struct AssetScriptPreview: Identifiable {
    let id: String
    let name: String
    let content: String
}

private struct AssetScriptPreviewSheet: View {
    @Environment(\.dismiss) private var dismiss
    let preview: AssetScriptPreview

    var body: some View {
        NavigationStack {
            ScrollView([.vertical, .horizontal]) {
                Text(preview.content)
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(16)
            }
            .background(Color(uiColor: .systemBackground))
            .navigationTitle(preview.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Copy") {
                        UIPasteboard.general.string = preview.content
                    }
                }
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
