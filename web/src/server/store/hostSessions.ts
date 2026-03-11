type HostSessionRecord = {
  id: string;
  firebase_uid: string;
  platform: string;
  device_name: string;
  app_version: string;
  capabilities: Record<string, unknown>;
  status: Record<string, unknown>;
  created_at_ms: number;
  last_seen_at_ms: number;
};

type HeartbeatPayload = {
  host_session_id: string;
  platform: string;
  device_name: string;
  app_version: string;
  capabilities: Record<string, unknown>;
  status: Record<string, unknown>;
};

function nowMs() {
  return Date.now();
}

function fingerprint(row: HostSessionRecord): string {
  return `${(row.platform || "").trim().toLowerCase()}|${(row.device_name || "").trim().toLowerCase()}`;
}

class HostSessionsStore {
  private readonly rows = new Map<string, HostSessionRecord>();

  upsert(uid: string, payload: HeartbeatPayload) {
    const now = nowMs();
    const existing = this.rows.get(payload.host_session_id);
    if (existing && existing.firebase_uid !== uid) {
      return { error: "Not found", status: 404 as const };
    }

    if (!existing) {
      const row: HostSessionRecord = {
        id: payload.host_session_id,
        firebase_uid: uid,
        platform: payload.platform,
        device_name: payload.device_name,
        app_version: payload.app_version,
        capabilities: payload.capabilities,
        status: payload.status,
        created_at_ms: now,
        last_seen_at_ms: now,
      };
      this.rows.set(row.id, row);
      this.cleanupDuplicates(uid);
      return { created: true as const, server_time_ms: now };
    }

    existing.platform = payload.platform || existing.platform;
    existing.device_name = payload.device_name;
    existing.app_version = payload.app_version;
    existing.capabilities = payload.capabilities;
    existing.status = payload.status;
    existing.last_seen_at_ms = now;
    this.cleanupDuplicates(uid);
    return { created: false as const, server_time_ms: now };
  }

  list(uid: string) {
    const now = nowMs();
    const rows = [...this.rows.values()]
      .filter((row) => row.firebase_uid === uid)
      .sort((a, b) => b.last_seen_at_ms - a.last_seen_at_ms);

    const byFingerprint = new Map<string, HostSessionRecord>();
    for (const row of rows) {
      const key = fingerprint(row);
      const previous = byFingerprint.get(key);
      if (!previous || row.last_seen_at_ms > previous.last_seen_at_ms) {
        byFingerprint.set(key, row);
      }
    }

    return {
      now_ms: now,
      hosts: [...byFingerprint.values()]
        .sort((a, b) => b.last_seen_at_ms - a.last_seen_at_ms)
        .map((row) => ({
          id: row.id,
          platform: row.platform,
          device_name: row.device_name,
          app_version: row.app_version,
          capabilities: row.capabilities,
          status: row.status,
          created_at_ms: row.created_at_ms,
          last_seen_at_ms: row.last_seen_at_ms,
          online: now - row.last_seen_at_ms < 30_000,
        })),
    };
  }

  belongsTo(uid: string, hostSessionId: string): boolean {
    const row = this.rows.get(hostSessionId);
    return Boolean(row && row.firebase_uid === uid);
  }

  private cleanupDuplicates(uid: string) {
    const rows = [...this.rows.values()].filter((row) => row.firebase_uid === uid);
    const byFingerprint = new Map<string, HostSessionRecord>();

    for (const row of rows) {
      const key = fingerprint(row);
      const previous = byFingerprint.get(key);
      if (!previous || row.last_seen_at_ms > previous.last_seen_at_ms) {
        byFingerprint.set(key, row);
      }
    }

    const keep = new Set([...byFingerprint.values()].map((row) => row.id));
    for (const row of rows) {
      if (!keep.has(row.id)) {
        this.rows.delete(row.id);
      }
    }
  }
}

const globalStore = globalThis as typeof globalThis & {
  __emwaverHostSessionsStore?: HostSessionsStore;
};

export const hostSessionsStore = globalStore.__emwaverHostSessionsStore ?? new HostSessionsStore();
globalStore.__emwaverHostSessionsStore = hostSessionsStore;

export type { HeartbeatPayload };
