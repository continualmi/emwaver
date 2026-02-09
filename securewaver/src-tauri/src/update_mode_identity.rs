use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ed25519_dalek::{Signature, VerifyingKey};

const IDENTITY_PAGE_SIZE: usize = 1024;

fn parse_root_public_key() -> Result<VerifyingKey, String> {
    let b64 = std::env::var("EMWAVER_ROOT_PUBLIC_KEY_B64").unwrap_or_default();
    let b64 = b64.trim();
    if b64.is_empty() {
        return Err("Missing EMWAVER_ROOT_PUBLIC_KEY_B64".to_string());
    }
    let bytes = B64
        .decode(b64)
        .map_err(|e| format!("Invalid EMWAVER_ROOT_PUBLIC_KEY_B64: {e}"))?;
    let key_bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Root public key must be 32 bytes".to_string())?;
    VerifyingKey::from_bytes(&key_bytes).map_err(|e| format!("Invalid root public key: {e}"))
}

pub struct UpdateModeLegitResult {
    pub device_id_b64: Option<String>,
    pub proof_b64: Option<String>,
    pub ok: bool,
}

pub fn read_and_verify_identity_page(
    dev: &mut emwaver_dfu::DfuDevice,
    identity_page_addr: u32,
) -> Result<UpdateModeLegitResult, String> {
    let root = parse_root_public_key()?;

    dev.set_address_pointer(identity_page_addr)
        .map_err(|e| format!("Update Mode set address pointer failed: {e}"))?;

    let mut page = vec![0u8; IDENTITY_PAGE_SIZE];
    let n = dev
        .read_block(2, &mut page)
        .map_err(|e| format!("Update Mode read identity page failed: {e}"))?;
    if n == 0 {
        return Err("Update Mode read returned 0 bytes".to_string());
    }

    if page.len() < 16 {
        return Err("Identity page too small".to_string());
    }

    if &page[0..4] != b"EMID" {
        return Ok(UpdateModeLegitResult {
            device_id_b64: None,
            proof_b64: None,
            ok: false,
        });
    }
    if page[4] != 1 {
        return Err("Unsupported identity version".to_string());
    }

    let dev_len = page[5] as usize;
    let proof_len = page[6] as usize;
    if dev_len != 16 || proof_len != 64 {
        return Err("Invalid identity lengths".to_string());
    }

    let mut off = 16usize;
    let device_id = page[off..off + 16].to_vec();
    off += 16;
    let proof = page[off..off + 64].to_vec();

    let sig_bytes: [u8; 64] = proof
        .clone()
        .try_into()
        .map_err(|_| "Proof must be 64 bytes".to_string())?;
    let sig = Signature::from_bytes(&sig_bytes);

    let ok = root.verify_strict(&device_id, &sig).is_ok();

    Ok(UpdateModeLegitResult {
        device_id_b64: Some(B64.encode(device_id)),
        proof_b64: Some(B64.encode(proof)),
        ok,
    })
}
