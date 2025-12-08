import SwiftUI

struct GitView: View {
    @StateObject private var service = GitService.shared
    @State private var repositoryURL: String = ""
    @State private var accessToken: String = ""
    @State private var showingError: Bool = false
    @State private var errorMessage: String = ""
    @State private var showingSuccess: Bool = false
    @State private var successMessage: String = ""
    
    var body: some View {
        VStack(spacing: 20) {
            configurationSection
            
            if service.isConfigured() {
                operationsSection
            }
            
            Spacer()
        }
        .padding()
        .navigationTitle("Git")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            repositoryURL = service.repositoryURL
            accessToken = service.accessToken
        }
        .alert("Error", isPresented: $showingError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage)
        }
        .alert("Success", isPresented: $showingSuccess) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(successMessage)
        }
    }
    
    private var configurationSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Configuration")
                .font(.headline)
            
            VStack(alignment: .leading, spacing: 8) {
                Text("Repository URL")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                
                TextField("https://github.com/owner/repo", text: $repositoryURL)
                    .textFieldStyle(.roundedBorder)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                    .keyboardType(.URL)
            }
            
            VStack(alignment: .leading, spacing: 8) {
                Text("Personal Access Token")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                
                SecureField("ghp_...", text: $accessToken)
                    .textFieldStyle(.roundedBorder)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
            }
            
            Button {
                service.repositoryURL = repositoryURL
                service.accessToken = accessToken
                service.saveSettings()
                successMessage = "Settings saved"
                showingSuccess = true
            } label: {
                Text("Save Configuration")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(repositoryURL.isEmpty || accessToken.isEmpty)
            
            if !service.status.isEmpty {
                HStack {
                    Image(systemName: service.isConfigured() ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                        .foregroundColor(service.isConfigured() ? .green : .orange)
                    Text(service.status)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
    
    private var operationsSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Operations")
                .font(.headline)
            
            VStack(spacing: 12) {
                Button {
                    Task {
                        await performOperation {
                            try await service.clone()
                            successMessage = "Repository cloned successfully"
                            showingSuccess = true
                        }
                    }
                } label: {
                    HStack {
                        Image(systemName: "arrow.down.circle.fill")
                        Text("Clone")
                        Spacer()
                        if service.isLoading {
                            ProgressView()
                                .scaleEffect(0.8)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(service.isLoading)
                
                Button {
                    Task {
                        await performOperation {
                            try await service.pull()
                            successMessage = "Repository pulled successfully"
                            showingSuccess = true
                        }
                    }
                } label: {
                    HStack {
                        Image(systemName: "arrow.clockwise.circle.fill")
                        Text("Pull")
                        Spacer()
                        if service.isLoading {
                            ProgressView()
                                .scaleEffect(0.8)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(service.isLoading)
                
                Button {
                    Task {
                        await performOperation {
                            try await service.push()
                        }
                    }
                } label: {
                    HStack {
                        Image(systemName: "arrow.up.circle.fill")
                        Text("Push")
                        Spacer()
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(service.isLoading)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
    
    private func performOperation(_ operation: @escaping () async throws -> Void) async {
        do {
            try await operation()
        } catch {
            errorMessage = error.localizedDescription
            showingError = true
        }
    }
}
