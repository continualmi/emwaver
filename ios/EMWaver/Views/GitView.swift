import SwiftUI

struct GitView: View {
    @StateObject private var service = GitService.shared
    @State private var showingManagePAT = false
    
    var body: some View {
        VStack {
            if !service.isAuthenticated {
                GitLoginView()
            } else if service.selectedRepo == nil {
                RepositorySelectionView()
            } else {
                FileBrowserView()
            }
        }
        .navigationTitle(navigationTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                menuButton
            }
        }
        .alert(item: Binding<AlertItem?>( 
            get: { service.errorMessage.map { AlertItem(message: $0) } }, 
            set: { _ in service.errorMessage = nil } 
        )) { item in 
            Alert(title: Text("Error"), message: Text(item.message), dismissButton: .default(Text("OK")))
        }
        .overlay(
            Group {
                if let message = service.successMessage {
                    VStack {
                        Spacer()
                        Text(message)
                            .padding()
                            .background(Color.green.opacity(0.8))
                            .foregroundColor(.white)
                            .cornerRadius(8)
                            .padding(.bottom, 20)
                            .onAppear {
                                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                    service.successMessage = nil
                                }
                            }
                    }
                }
            }
        )
        .overlay(
            Group {
                if service.isLoading {
                    ProgressView()
                        .scaleEffect(1.5)
                        .padding()
                        .background(Color(.systemBackground).opacity(0.8))
                        .cornerRadius(10)
                }
            }
        )
        .sheet(isPresented: $showingManagePAT) {
            ManagePATView(isPresented: $showingManagePAT)
        }
    }
    
    private var navigationTitle: String {
        if !service.isAuthenticated { return "Git Login" }
        if service.selectedRepo == nil { return "Select Repository" }
        return service.currentPath.isEmpty ? service.selectedRepo?.name ?? "Files" : service.currentPath
    }
    
    private var menuButton: some View {
        Menu {
            if service.isAuthenticated {
                Button(role: .destructive, action: { service.logout() }) {
                    Label("Logout", systemImage: "rectangle.portrait.and.arrow.right")
                }
                
                Button(action: { 
                    Task { 
                        if service.selectedRepo == nil {
                            await service.listRepositories()
                        } else {
                            await service.refreshFileTree() 
                        }
                    } 
                }) {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                
                if service.selectedRepo != nil {
                    Button(action: { service.selectedRepo = nil }) {
                        Label("Change Repository", systemImage: "arrow.triangle.2.circlepath")
                    }
                }
                
                Button(action: { showingManagePAT = true }) {
                    Label("Manage PAT", systemImage: "key")
                }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
    }
}

struct AlertItem: Identifiable {
    var id = UUID()
    var message: String
}

// MARK: - Login View

struct GitLoginView: View {
    @StateObject private var service = GitService.shared
    @State private var patInput: String = ""
    @State private var showingPAT = false
    
    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "globe")
                .font(.system(size: 60))
                .foregroundColor(.blue)
            
            Text("Connect to GitHub")
                .font(.title2)
                .bold()
            
            Text("Sync your Wavelet scripts and signals")
                .foregroundColor(.secondary)
            
            Button(action: {
                Task { await service.loginWithOAuth() }
            }) {
                HStack {
                    Image(systemName: "safari")
                    Text("Login with GitHub")
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.black)
                .foregroundColor(.white)
                .cornerRadius(10)
            }
            .padding(.horizontal)
            
            Button("Or use Personal Access Token") {
                showingPAT.toggle()
            }
            .font(.footnote)
            
            if showingPAT {
                VStack {
                    SecureField("Personal Access Token", text: $patInput)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                        .textContentType(.password)
                    
                    Button("Save Token") {
                        if !patInput.isEmpty {
                            service.setPAT(patInput)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding()
                .background(Color(.secondarySystemBackground))
                .cornerRadius(10)
                .padding(.horizontal)
            }
            
            Spacer()
        }
        .padding(.top, 50)
    }
}

// MARK: - Repository Selection

struct RepositorySelectionView: View {
    @StateObject private var service = GitService.shared
    @State private var showingCreateDialog = false
    
    var body: some View {
        List {
            Section {
                Button(action: { showingCreateDialog = true }) {
                    Label("Create New Repository", systemImage: "plus.circle.fill")
                        .foregroundColor(.blue)
                }
            }
            
            Section(header: Text("Repositories")) {
                ForEach(service.repositories) { repo in
                    Button(action: { service.selectRepository(repo) }) {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(repo.name)
                                    .font(.headline)
                                Text(repo.fullName)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            Spacer()
                            if repo.isPrivate {
                                Image(systemName: "lock.fill")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .listStyle(InsetGroupedListStyle())
        .onAppear {
            Task { await service.listRepositories() }
        }
        .sheet(isPresented: $showingCreateDialog) {
            CreateRepoView(isPresented: $showingCreateDialog)
        }
    }
}

struct CreateRepoView: View {
    @Binding var isPresented: Bool
    @StateObject private var service = GitService.shared
    @State private var name: String = ""
    @State private var description: String = "Created with EMWaver"
    @State private var isPrivate: Bool = true
    
    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Details")) {
                    TextField("Repository Name", text: $name)
                    TextField("Description", text: $description)
                    Toggle("Private", isOn: $isPrivate)
                }
                
                Section(footer: Text("This will create a new repository and push all your local Wavelet files to it.")) {
                    Button("Create Repository") {
                        Task {
                            await service.createRepository(name: name, description: description, isPrivate: isPrivate)
                            isPresented = false
                        }
                    }
                    .disabled(name.isEmpty)
                }
            }
            .navigationTitle("New Repository")
            .navigationBarItems(leading: Button("Cancel") { isPresented = false })
        }
    }
}

// MARK: - Manage PAT View

struct ManagePATView: View {
    @Binding var isPresented: Bool
    @StateObject private var service = GitService.shared
    @State private var patInput: String = ""
    
    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Personal Access Token")) {
                    SecureField("Enter new PAT", text: $patInput)
                        .textContentType(.password)
                }
                
                Section(footer: Text("Entering a new PAT will update your current session.")) {
                    Button("Save Token") {
                        if !patInput.isEmpty {
                            service.setPAT(patInput)
                            isPresented = false
                        }
                    }
                    .disabled(patInput.isEmpty)
                }
            }
            .navigationTitle("Manage PAT")
            .navigationBarItems(leading: Button("Cancel") { isPresented = false })
        }
    }
}

// MARK: - File Browser

struct FileBrowserView: View {
    @StateObject private var service = GitService.shared
    @State private var selectedFile: GitHubContent?
    @State private var showingEdit = false
    @State private var showingSyncPreview = false
    @State private var syncDirection: SyncDirection = .githubToLocal
    @State private var localContentForDiff: String = ""
    @State private var githubContentForDiff: String = ""
    
    enum SyncDirection {
        case githubToLocal
        case localToGitHub
    }
    
    var body: some View {
        List {
            if !service.currentPath.isEmpty {
                Button(action: { service.navigateUp() }) {
                    HStack {
                        Image(systemName: "folder")
                        Text("..")
                    }
                }
            }
            
            ForEach(service.fileTree) { item in
                if item.type == "dir" {
                    Button(action: { service.navigateTo(path: item.path) }) {
                        HStack {
                            Image(systemName: "folder.fill")
                                .foregroundColor(.blue)
                            Text(item.name)
                        }
                    }
                } else {
                    Button(action: { handleFileSelection(item) }) {
                        HStack {
                            Image(systemName: "doc.text")
                                .foregroundColor(.gray)
                            Text(item.name)
                            Spacer()
                            Image(systemName: "ellipsis.circle")
                                .foregroundColor(.blue)
                        }
                    }
                }
            }
        }
        .listStyle(PlainListStyle())
        .confirmationDialog(
            selectedFile?.name ?? "Options",
            isPresented: Binding(
                get: { selectedFile != nil },
                set: { if !$0 { selectedFile = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Edit File") {
                if let file = selectedFile { loadAndEdit(file) }
            }
            Button("GitHub → Local") {
                if let file = selectedFile { prepareSync(file, direction: .githubToLocal) }
            }
            Button("Local → GitHub") {
                if let file = selectedFile { prepareSync(file, direction: .localToGitHub) }
            }
            Button("Cancel", role: .cancel) {
                selectedFile = nil
            }
        }
        .sheet(isPresented: $showingEdit) {
            if let file = selectedFile {
                FileEditView(file: file, content: githubContentForDiff, isPresented: $showingEdit)
            }
        }
        .sheet(isPresented: $showingSyncPreview) {
            if let file = selectedFile {
                DiffPreviewView(
                    file: file,
                    localContent: localContentForDiff,
                    githubContent: githubContentForDiff,
                    direction: syncDirection,
                    isPresented: $showingSyncPreview
                )
            }
        }
    }
    
    func handleFileSelection(_ item: GitHubContent) {
        selectedFile = item
    }
    
    func loadAndEdit(_ file: GitHubContent) {
        Task {
            do {
                let content = try await service.getFileContent(path: file.path)
                if let encoded = content.content, let data = Data(base64Encoded: encoded.replacingOccurrences(of: "\n", with: "")) {
                    await MainActor.run {
                        githubContentForDiff = String(data: data, encoding: .utf8) ?? ""
                        showingEdit = true
                    }
                }
            } catch {
                await MainActor.run { service.errorMessage = "Failed to load: \(error.localizedDescription)" }
            }
        }
    }
    
    func prepareSync(_ file: GitHubContent, direction: SyncDirection) {
        syncDirection = direction
        Task {
            // Get local content
            let local = await service.getLocalFileContent(name: file.name) ?? ""
            
            // Get GitHub content
            var remote = ""
            do {
                let content = try await service.getFileContent(path: file.path)
                if let encoded = content.content, let data = Data(base64Encoded: encoded.replacingOccurrences(of: "\n", with: "")) {
                    remote = String(data: data, encoding: .utf8) ?? ""
                }
            } catch {
                print("Remote load failed: \(error)")
            }
            
            await MainActor.run {
                localContentForDiff = local
                githubContentForDiff = remote
                showingSyncPreview = true
            }
        }
    }
}

// MARK: - File Editing

struct FileEditView: View {
    let file: GitHubContent
    @State var content: String
    @Binding var isPresented: Bool
    @StateObject private var service = GitService.shared
    @State private var commitMessage = ""
    @State private var showingCommit = false
    
    init(file: GitHubContent, content: String, isPresented: Binding<Bool>) {
        self.file = file
        self._content = State(initialValue: content)
        self._isPresented = isPresented
        self._commitMessage = State(initialValue: "Update " + file.name)
    }
    
    var body: some View {
        NavigationView {
            VStack {
                TextEditor(text: $content)
                    .font(.system(.body, design: .monospaced))
                    .padding()
            }
            .navigationTitle(file.name)
            .navigationBarItems(
                leading: Button("Cancel") { isPresented = false },
                trailing: Button("Save") { showingCommit = true }
            )
            .alert("Commit Changes", isPresented: $showingCommit) {
                TextField("Commit Message", text: $commitMessage)
                Button("Commit") {
                    Task {
                        await service.updateFileOnGitHub(path: file.path, content: content, sha: file.sha, message: commitMessage)
                        isPresented = false
                    }
                }
                Button("Cancel", role: .cancel) {}
            }
        }
    }
}

// MARK: - Diff Preview

struct DiffPreviewView: View {
    let file: GitHubContent
    let localContent: String
    let githubContent: String
    let direction: FileBrowserView.SyncDirection
    @Binding var isPresented: Bool
    @StateObject private var service = GitService.shared
    
    @State private var commitMessage = ""
    
    var body: some View {
        NavigationView {
            VStack {
                HStack {
                    Text(direction == .githubToLocal ? "GitHub (Remote)" : "Local (Source)")
                        .bold()
                    Image(systemName: "arrow.right")
                    Text(direction == .githubToLocal ? "Local (Dest)" : "GitHub (Dest)")
                        .bold()
                }
                .padding()
                
                ScrollView {
                    // Use GitHubDiffUtil
                    let diff = GitHubDiffUtil.calculateDiff(
                        original: direction == .githubToLocal ? localContent : githubContent,
                        new: direction == .githubToLocal ? githubContent : localContent
                    )
                    
                    Text("Lines Added: \(diff.linesAdded)  Removed: \(diff.linesRemoved)")
                        .font(.caption)
                        .padding(.bottom)
                    
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(diff.previewLines, id: \.self) {
                            line in
                            Text(line)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundColor(getColor(line))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(getBgColor(line))
                        }
                    }
                    .padding()
                }
            }
            .navigationTitle("Sync Preview")
            .navigationBarItems(
                leading: Button("Cancel") { isPresented = false },
                trailing: Button("Confirm") {
                    Task {
                        if direction == .githubToLocal {
                            await service.syncGitHubToLocal(content: file)
                        } else {
                            // Local to GitHub requires commit
                            await service.updateFileOnGitHub(path: file.path, content: localContent, sha: file.sha, message: "Update \(file.name) from local")
                        }
                        isPresented = false
                    }
                }
            )
        }
    }
    
    func getColor(_ line: String) -> Color {
        if line.starts(with: "+") { return .green }
        if line.starts(with: "-") { return .red }
        return .primary
    }
    
    func getBgColor(_ line: String) -> Color {
        if line.starts(with: "+") { return Color.green.opacity(0.1) }
        if line.starts(with: "-") { return Color.red.opacity(0.1) }
        return Color.clear
    }
}