import SwiftUI

struct EspBootloaderInstructionsSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Enter ESP32-S3 Bootloader")
                        .font(.title3.weight(.semibold))
                    Text("ESP32-S3 updates use serial flashing. Put the board into bootloader mode before you start the update.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button("Close") {
                    dismiss()
                }
                .buttonStyle(.bordered)
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Button sequence")
                    .font(.headline)
                Text("1. Hold the BOOT button.")
                Text("2. Press and release RESET while still holding BOOT.")
                Text("3. Release RESET.")
                Text("4. Release BOOT.")
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Notes")
                    .font(.headline)
                Text("Use the board's serial or flash-capable USB port.")
                Text("After the board is in bootloader mode, return to EMWaver and click Update device.")
                Text("If flashing fails, repeat the button sequence and retry.")
                    .foregroundStyle(.secondary)
            }
            .font(.caption)

            Spacer(minLength: 0)

            HStack {
                Spacer()
                Button("Done") {
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(minWidth: 460, idealWidth: 500, minHeight: 300)
    }
}
