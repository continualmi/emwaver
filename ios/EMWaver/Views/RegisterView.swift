import SwiftUI

struct RegisterView: View {
    @EnvironmentObject private var authManager: AuthenticationManager
    @Environment(\.dismiss) private var dismiss

    @State private var email = ""
    @State private var username = ""
    @State private var password = ""
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var accessCode = ""
    @State private var errorMessage: String?
    @State private var isLoading = false
    @FocusState private var focusedField: Field?

    enum Field: Hashable {
        case email
        case username
        case password
        case firstName
        case lastName
        case accessCode
    }

    var body: some View {
        Form {
            Section("Account") {
                TextField("Email", text: $email)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                    .focused($focusedField, equals: .email)

                TextField("Username", text: $username)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                    .focused($focusedField, equals: .username)

                SecureField("Password", text: $password)
                    .textContentType(.newPassword)
                    .focused($focusedField, equals: .password)
            }

            Section("Optional Details") {
                TextField("First Name", text: $firstName)
                    .focused($focusedField, equals: .firstName)
                TextField("Last Name", text: $lastName)
                    .focused($focusedField, equals: .lastName)
                TextField("Access Code", text: $accessCode)
                    .focused($focusedField, equals: .accessCode)
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundColor(.red)
                }
            }

            Section {
                Button(action: submit) {
                    HStack {
                        if isLoading {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle())
                        }
                        Text("Create Account")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                }
                .disabled(isLoading || !isFormValid)
            }
        }
        .navigationTitle("Create Account")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Create", action: submit)
                    .disabled(isLoading || !isFormValid)
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") {
                    focusedField = nil
                }
            }
        }
    }

    private var isFormValid: Bool {
        !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !password.isEmpty
    }

    private func submit() {
        guard !isLoading, isFormValid else { return }
        focusedField = nil
        errorMessage = nil
        isLoading = true

        Task {
            defer { isLoading = false }
            do {
                let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
                let trimmedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
                let trimmedFirstName = firstName.trimmingCharacters(in: .whitespacesAndNewlines)
                let trimmedLastName = lastName.trimmingCharacters(in: .whitespacesAndNewlines)
                let trimmedAccessCode = accessCode.trimmingCharacters(in: .whitespacesAndNewlines)

                try await authManager.register(
                    email: trimmedEmail,
                    username: trimmedUsername,
                    password: password,
                    firstName: trimmedFirstName.isEmpty ? nil : trimmedFirstName,
                    lastName: trimmedLastName.isEmpty ? nil : trimmedLastName,
                    accessCode: trimmedAccessCode.isEmpty ? nil : trimmedAccessCode
                )
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

#Preview {
    NavigationStack {
        RegisterView()
            .environmentObject(AuthenticationManager())
    }
}
