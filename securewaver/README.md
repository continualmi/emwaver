# SecureWaver

Internal **device provisioning** app for EMWaver.

Goal: provide a simple GUI for manufacturing/provisioning steps:
- Generate the offline **Root keypair** (one-time)
- For each device: mint a **DeviceID** and **Proof = Sign_root(DeviceID)**
- Flash firmware and flash `DeviceID+Proof` onto the device via DFU
- (Later) verify cloud gating flows against the backend

> This tool is internal and is not shipped to end users.
