# SecureWaver

Internal **device provisioning** app for EMWaver.

Goal: provide a simple GUI for manufacturing/provisioning steps:
- Connect to STM32 DFU device
- Provision device identity material (device key + root-signed certificate)
- Flash firmware without mass-erasing the key page
- Set STM32 option bytes (RDP1)
- Verify by running the local auth handshake

> This tool is internal and is not shipped to end users.
