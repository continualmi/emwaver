const KEY = "emwaver.web.selectedHostId";

export function loadSelectedHostId(): string {
  if (typeof window === "undefined") return "";
  try {
    return String(window.localStorage.getItem(KEY) || "");
  } catch {
    return "";
  }
}

export function saveSelectedHostId(id: string) {
  if (typeof window === "undefined") return;
  try {
    if (!id) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, id);
  } catch {}
}
