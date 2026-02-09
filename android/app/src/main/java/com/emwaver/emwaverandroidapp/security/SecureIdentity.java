/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.security;

import android.util.Base64;

import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters;
import org.bouncycastle.crypto.signers.Ed25519Signer;

/**
 * SecureWaver identity verification (Ed25519 signature of DeviceID).
 */
public final class SecureIdentity {
    private SecureIdentity() {}

    // Hardcoded root public key (base64, 32 bytes) per Luís request.
    public static final String EMWAVER_ROOT_PUBLIC_KEY_B64 = "Hc1UAlc+CXh9bLPLWCqV3I8FyQVKxr7U7S+L7Nycm4s=";

    public static byte[] rootPublicKeyRaw() {
        try {
            byte[] raw = Base64.decode(EMWAVER_ROOT_PUBLIC_KEY_B64, Base64.DEFAULT);
            return (raw != null && raw.length == 32) ? raw : null;
        } catch (Throwable t) {
            return null;
        }
    }

    public static boolean verifyDeviceIdentity(byte[] deviceId16, byte[] proof64) {
        try {
            byte[] pkRaw = rootPublicKeyRaw();
            if (pkRaw == null || pkRaw.length != 32) return false;
            if (deviceId16 == null || deviceId16.length != 16) return false;
            if (proof64 == null || proof64.length != 64) return false;

            Ed25519PublicKeyParameters pk = new Ed25519PublicKeyParameters(pkRaw, 0);
            Ed25519Signer signer = new Ed25519Signer();
            signer.init(false, pk);
            signer.update(deviceId16, 0, deviceId16.length);
            return signer.verifySignature(proof64);
        } catch (Throwable t) {
            return false;
        }
    }
}
