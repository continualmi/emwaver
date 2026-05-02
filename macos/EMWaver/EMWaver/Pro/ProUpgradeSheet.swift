import SwiftUI
import AppKit

struct ProUpgradeSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var auth: AuthenticationManager
    @ObservedObject var entitlements: EntitlementsManager

    let featureName: String

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Agent API")
                    .font(.title2.weight(.semibold))

                Spacer()

                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
            }

            Text("\(featureName) will use a user-provided MGPT API key.")
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 10) {
                Label("Local script and device context", systemImage: "terminal")
                Label("Server-side private Agent instructions", systemImage: "lock")
                Label("MGPT-backed inference", systemImage: "sparkles")
            }
            .padding(.top, 6)

                Text("Configure an Agent API key to enable Agent replies.")
                .font(.callout)
                .foregroundStyle(.secondary)

            Divider()

            if !auth.isSignedIn {
                Text("Agent API-key setup is not wired here yet. Local scripts and hardware control do not require it.")
                    .foregroundStyle(.secondary)

                Button("Close") {
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
            } else {
                if let el = entitlements.eligibility {
                    if el.canPurchasePro {
                        Text("Eligible to subscribe.")
                            .foregroundStyle(.secondary)

                        Button("Get Pro…") {
                            openProPurchase()
                        }
                        .buttonStyle(.borderedProminent)

                        Button("Manage on web") {
                            openProPurchase()
                        }
                        .buttonStyle(.bordered)
                    } else {
                        if el.reason == "no_device" {
                            Text("Agent API-key setup is not available in this panel yet.")
                                .foregroundStyle(.secondary)
                        } else {
                            Text("You’re not eligible to subscribe yet.")
                                .foregroundStyle(.secondary)
                        }

                        HStack(spacing: 10) {
                            Button("Get Pro…") {
                                openProPurchase()
                            }
                            .buttonStyle(.borderedProminent)

                            Button("Refresh") {
                                Task { await entitlements.refresh(auth: auth, force: true) }
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                } else {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Checking eligibility…")
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if let err = entitlements.lastError, !err.isEmpty {
                Text(err)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(.top, 6)
            }

            Spacer()
        }
        .padding(18)
        .frame(minWidth: 520, minHeight: 360)
        .task {
            await entitlements.refresh(auth: auth, force: true)
        }
    }

    private func openProPurchase() {
        guard var base = FrontendUrl.resolve() else { return }
        base.appendPathComponent("pro")
        NSWorkspace.shared.open(base)
    }
}
