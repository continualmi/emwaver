use crate::SecurewaverAuthSession;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

const STORE_PATH: &str = "securewaver.store.json";
const KEY: &str = "auth.session";

pub fn get(app: &AppHandle) -> Result<Option<SecurewaverAuthSession>, String> {
    let store = app
        .store(STORE_PATH)
        .map_err(|e| format!("Failed to open store: {e}"))?;

    let v = store.get(KEY);
    if v.is_none() {
        return Ok(None);
    }

    let s: SecurewaverAuthSession = serde_json::from_value(v.unwrap())
        .map_err(|e| format!("Failed to decode stored session: {e}"))?;
    Ok(Some(s))
}

pub fn set(app: &AppHandle, session: &SecurewaverAuthSession) -> Result<(), String> {
    let store = app
        .store(STORE_PATH)
        .map_err(|e| format!("Failed to open store: {e}"))?;

    let v = serde_json::to_value(session).map_err(|e| format!("Failed to encode session: {e}"))?;
    store.set(KEY, v);
    store.save().map_err(|e| format!("Failed to save store: {e}"))?;
    Ok(())
}

pub fn clear(app: &AppHandle) -> Result<(), String> {
    let store = app
        .store(STORE_PATH)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    store.delete(KEY);
    store.save().map_err(|e| format!("Failed to save store: {e}"))?;
    Ok(())
}
