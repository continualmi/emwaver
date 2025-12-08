# Wavelet Development & File Sync System

## Overview

The EMWaver ecosystem enables flexible wavelet development through a transparent file sync pipeline that bridges the CLI, firmware, and mobile app without requiring WiFi, Bluetooth on the computer, or internet connectivity. This design prioritizes minimal dependencies—only USB on the computer side—while providing a Git-like workflow for managing wavelet scripts and signal files.

## Architecture

### Sync Pipeline
```
CLI (Computer) ↔ UART/USB ↔ EMWaver Firmware ↔ BLE ↔ Android/iOS App
```

The EMWaver device acts as a transparent bridge:
- **CLI → Device**: Streams file chunks over UART using existing command protocol
- **Device → App**: Forwards chunks via BLE file-transfer characteristic
- **Device Role**: Stateless relay with chunked buffering (doesn't persist files)

### Design Principles

1. **Minimal Requirements**: Only assumes USB connection between computer and EMWaver
2. **Existing Infrastructure**: Reuses UART command protocol and BLE service
3. **Memory Efficiency**: Streams files in 128–256KB chunks (safe within 512KB PSRAM)
4. **Stateless Firmware**: Device buffers/forwards without persisting files
5. **App-side Storage**: Android/iOS `FileRepositoryLocal` handles persistence
6. **Git-like UX**: CLI commands mirror `git` (`push`, `pull`, `status`, `list`)

## Use Cases

### Primary: Wavelet Development
- Develop `.js` wavelet scripts on computer with preferred editor/IDE
- Push to device with `emwaver sync push mywavelet.js`
- Test immediately on phone via Wavelets fragment
- Pull back changes made in-app for version control

### Future: Signal File Management
- Push captured `.raw` signal files from phone to computer for analysis
- Edit/process signals with desktop tools
- Push modified signals back to device

## Implementation Components

### 1. Firmware (main/)

#### New BLE Characteristic
- **UUID**: `48c7158e-0c3b-4e90-a847-452a15b14191` (File Transfer)
- **Properties**: `WRITE_NO_RSP | NOTIFY`
- **Purpose**: Bidirectional file packet streaming

#### UART Commands
```bash
# Start file transfer
sync --start --name <filename> --size <bytes> --type wavelet

# Send data chunk
sync --chunk --seq <n> --data <hex>

# Finalize transfer
sync --commit --hash <sha256>

# List remote files
sync --list

# Retrieve file from app
sync --get --name <filename>
```

#### file_sync.c Module
- **Circular buffer**: 128KB window for active transfer
- **State machine**: `IDLE → RECEIVING → BUFFERING → TRANSMITTING → DONE`
- **Memory management**: Reuses buffer for bidirectional sync
- **Flow control**: Responds with `ok`/`err` after each operation

### 2. Android App (android/app/)

#### BLEService Extension
- Subscribe to file transfer characteristic (UUID `...c7:48`)
- Handle incoming file packets via `handleFileTransferPacket(byte[] data)`
- Parse packet types: `start`, `chunk`, `commit`

#### FileSyncManager.java
```java
public class FileSyncManager {
    // Coordinates incoming/outgoing file transfers
    public void handleStartPacket(String name, long size, String type);
    public void handleChunkPacket(int seq, byte[] data);
    public void handleCommitPacket(String hash);
    public SyncStatus getSyncStatus();
}
```

- Maintains active transfer state
- Creates temp files during receive
- Validates hash on commit
- Moves to `FileRepositoryLocal` on success

#### FileRepositoryLocal Updates
```java
// Incoming sync from CLI
public void receiveFile(String name, InputStream stream, RepositoryCallback callback);

// Outgoing sync to CLI
public InputStream getFileStream(String name);
```

### 3. CLI Tool (cli/src/)

#### Sync Subcommands
```bash
# Push local file to device
emwaver sync push mywavelet.js

# Pull remote file to local
emwaver sync pull mywavelet.js

# Show sync status
emwaver sync status

# List remote files
emwaver sync list
```

#### sync.rs Module
```rust
pub fn push_file(path: PathBuf, serial: &mut SerialPort) -> Result<()>;
pub fn pull_file(name: String, serial: &mut SerialPort) -> Result<()>;
pub fn list_files(serial: &mut SerialPort) -> Result<Vec<FileMetadata>>;
pub fn sync_status(serial: &mut SerialPort) -> Result<SyncStatus>;
```

**Push Flow**:
1. Open file, calculate SHA256
2. Send `sync --start` command
3. Read file in 128KB chunks
4. Send each chunk via `sync --chunk`
5. Send `sync --commit` with hash
6. Display progress: `[=====>    ] 50% (512KB/1024KB)`

**Pull Flow**:
1. Send `sync --get --name X`
2. Receive chunked response via notification characteristic
3. Write chunks to local file
4. Verify hash

## Packet Format

### UART Protocol (CLI → Firmware)
```
sync --start --name "hello.js" --size 1024 --type wavelet
sync --chunk --seq 0 --data 636f6e736f6c652e6c6f67282248656c6c6f22293b
sync --commit --hash e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

Responses: `ok` or `err <message>`

### BLE Protocol (Firmware ↔ App)

JSON-encoded packets over file transfer characteristic:

```json
{
  "op": "start",
  "name": "hello.js",
  "size": 1024,
  "type": "wavelet"
}

{
  "op": "chunk",
  "seq": 0,
  "data": "Y29uc29sZS5sb2coIkhlbGxvIik7"
}

{
  "op": "commit",
  "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}

{
  "op": "error",
  "message": "Invalid sequence number"
}
```

## Workflow Examples

### Develop New Wavelet
```bash
# Create wavelet on computer
cat > my-remote.js <<EOF
const root = UI.column({
  children: [
    UI.button({ label: "Power", onTap: () => IR.send("power") }),
    UI.button({ label: "Vol+", onTap: () => IR.send("vol_up") })
  ]
});
UI.render(root);
EOF

# Push to device
emwaver sync push my-remote.js
# Output: Pushing my-remote.js (324 bytes)...
#         [==========] 100% Done!

# Test on phone (Wavelets fragment shows "my-remote")
# Make changes in app...

# Pull back changes
emwaver sync pull my-remote.js
# Output: Pulling my-remote.js from device...
#         [==========] 100% (381 bytes) Saved to ./my-remote.js

# Commit to version control
git add my-remote.js
git commit -m "wavelet: add IR volume controls"
```

### Batch Sync
```bash
# Push entire directory
for f in wavelets/*.js; do
  emwaver sync push "$f"
done

# List remote files
emwaver sync list
# Output:
# hello.js          324 B   2025-12-08 10:15:23
# my-remote.js      381 B   2025-12-08 10:16:45
# signal-analyzer.js 1.2 KB  2025-12-08 09:30:12
```

### Sync Status
```bash
emwaver sync status
# Output:
# Connected to: EMWaver-A1B2C3
# Firmware: v1.2.3
# Remote files: 3 wavelets (1.9 KB total)
# Last sync: 2 minutes ago
# Status: ✓ In sync
```

## Development Workflow Integration

### With Git
```bash
# Clone wavelets repo
git clone https://github.com/user/emwaver-wavelets.git
cd emwaver-wavelets

# Push to device
emwaver sync push *.js

# Device connected, test on phone
# ... make changes in app or on computer ...

# Pull latest from device
emwaver sync pull-all

# Review changes
git diff

# Commit
git add .
git commit -m "wavelets: update IR codes for Sony TV"
git push
```

### With IDE Integration (Future)
The EMWaver IDE (`ide/`) will integrate sync operations:
- **Auto-sync on save**: Push wavelet when file saved
- **Live preview**: Hot-reload wavelet on device
- **Diff view**: Show local vs remote changes
- **Conflict resolution**: Merge in-app edits with local changes

## Memory Constraints & Optimization

### Firmware Buffer Strategy
- **Total PSRAM**: 512KB
- **BLE stack usage**: ~64KB
- **Sync buffer allocation**: 128KB (safe margin)
- **Chunk size**: 128KB (one buffer fill)
- **Stream processing**: Forward chunks immediately, don't accumulate

### File Size Limits (MVP)
- **Wavelet scripts**: Typically 1–50KB (well within limits)
- **Signal files**: 100KB–1MB (streamed in chunks)
- **No arbitrary limit**: System handles files of any size via streaming

### Optimization Techniques
1. **Zero-copy forwarding**: Firmware passes buffer pointers between UART and BLE
2. **Async I/O**: Non-blocking UART reads, BLE notifications
3. **Backpressure handling**: Pause UART reads if BLE TX queue full
4. **Hash streaming**: Calculate SHA256 incrementally during transfer

## Error Handling & Recovery

### Connection Loss
- **During upload**: CLI retries from last confirmed chunk
- **During download**: CLI requests missing chunks by sequence number

### Corruption Detection
- **Hash mismatch**: CLI retries entire transfer
- **Sequence gap**: Firmware requests retransmission

### Timeout Handling
- **UART timeout**: 5 seconds per chunk
- **BLE timeout**: 10 seconds per notification
- **Total transfer timeout**: 60 seconds (configurable)

### User Feedback
```bash
emwaver sync push large-wavelet.js
# Output:
# Pushing large-wavelet.js (2.5 MB)...
# [=====>    ] 50% (1.2 MB/2.5 MB) - 15s elapsed
# Error: Connection lost to device
# Retrying from chunk 10...
# [==========>] 100% Done! (took 32s)
```

## Conflict Resolution (MVP)

### Strategy: Last-Write-Wins
- No automatic merging
- CLI warns if remote is newer:
  ```bash
  emwaver sync push mywavelet.js
  # Warning: Remote version is newer (modified 5m ago)
  # Use --force to overwrite, or pull first
  ```

### Future: Three-Way Merge
- Track modification timestamps
- Detect concurrent edits
- Prompt user to resolve conflicts
- Integrate with Git-like merge tools

## Security Considerations

### Authentication
- **MVP**: Inherit BLE pairing from app
- **Future**: Require PIN or passphrase for sync operations

### Encryption
- **Link-layer**: BLE encryption when paired (automatic)
- **Payload**: Optional wavelet signature verification (future)

### Permissions
- **File access**: Scoped to `wavelets/` and `signals/` directories
- **Type enforcement**: Only allow `.js` and `.raw` extensions
- **Size limits**: Enforce reasonable maximums (10MB per file)

## Testing Strategy

### Unit Tests
- `file_sync.c`: Buffer management, state machine transitions
- `sync.rs`: Chunk encoding, hash calculation, progress tracking
- `FileSyncManager.java`: Packet parsing, temp file handling

### Integration Tests
1. **Firmware smoke test**: Use `emwaver shell` to send manual sync commands
2. **Android smoke test**: Use nRF Connect to inject file packets
3. **End-to-end**: CLI push → verify in Android app storage
4. **Bidirectional**: CLI pull → verify file contents match
5. **Error injection**: Disconnect during transfer, verify recovery

### Performance Benchmarks
- **Target**: 50KB/s average throughput (BLE + UART overhead)
- **1KB file**: < 1 second
- **100KB file**: < 3 seconds
- **1MB file**: < 25 seconds

## Roadmap

### Phase 1: MVP (Current)
- ✅ Architecture design
- ☐ Firmware: File transfer characteristic + sync commands
- ☐ Android: BLE packet handling + FileSyncManager
- ☐ CLI: `push`/`pull` commands with progress
- ☐ End-to-end smoke test

### Phase 2: Robustness
- ☐ Error recovery (retry logic, hash validation)
- ☐ Bidirectional sync (CLI can pull from app)
- ☐ `sync list` and `sync status` commands
- ☐ Progress UI in Android app

### Phase 3: Advanced Features
- ☐ Directory sync (preserve folder structure)
- ☐ Incremental sync (only changed files)
- ☐ Conflict detection and resolution
- ☐ Signal file support (`.raw` format)
- ☐ IDE integration (auto-sync on save)

### Phase 4: Multi-User
- ☐ Cloud backend integration (optional)
- ☐ Shared wavelet repositories
- ☐ Version control (track edit history)
- ☐ Collaborative editing

## References

- **Command Protocol**: `AGENTS.md` section on firmware command structure
- **BLE Service**: `main/ble_server.c` for characteristic definitions
- **File Storage**: `android/.../files/FileRepositoryLocal.java` for persistence layer
- **CLI Shell**: `cli/src/shell.rs` for serial communication patterns
- **Wavelet Engine**: `TODO.md` for wavelet packaging and execution model
