import { backendFetch } from "@/lib/backend";

export type Device = {
  board_type: string;
  hardware_uid: string;
  label?: string;
  created_at_ms?: number;
  updated_at_ms?: number;
  last_seen_at_ms?: number;
};

export async function listMyDevices(idToken: string): Promise<Device[]> {
  const res = await backendFetch("/v1/devices/my", idToken, { method: "GET" });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const json = JSON.parse(text);
  return json.devices || [];
}

export async function setDeviceLabel(idToken: string, boardType: string, hardwareUid: string, label: string) {
  const res = await backendFetch("/v1/devices/label", idToken, {
    method: "POST",
    body: JSON.stringify({ board_type: boardType, hardware_uid: hardwareUid, label }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return JSON.parse(text) as { device: Device };
}
