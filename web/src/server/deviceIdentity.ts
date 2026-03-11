import { signAsync, verifyAsync, utils } from "@noble/ed25519";

export async function verifyDeviceProof(deviceIdB64: string, proofB64: string, publicKeyB64: string) {
  const deviceId = Buffer.from(deviceIdB64, "base64");
  const proof = Buffer.from(proofB64, "base64");
  const publicKey = Buffer.from(publicKeyB64, "base64");

  if (deviceId.length !== 16) throw new Error("invalid_device_id_len");
  if (proof.length !== 64) throw new Error("invalid_proof_len");
  if (publicKey.length !== 32) throw new Error("invalid_public_key_len");

  const ok = await verifyAsync(proof, deviceId, publicKey);
  if (!ok) throw new Error("invalid_proof");
}

export async function mintDeviceIdentity(privateKeyB64: string) {
  const privateKey = Buffer.from(privateKeyB64, "base64");
  if (privateKey.length !== 32) throw new Error("invalid_private_key_len");
  const deviceId = utils.randomPrivateKey().slice(0, 16);
  const proof = await signAsync(deviceId, privateKey);
  return {
    device_id_b64: Buffer.from(deviceId).toString("base64"),
    proof_b64: Buffer.from(proof).toString("base64"),
    algorithm: "ed25519",
    device_id_len: 16,
    proof_len: 64,
  };
}
