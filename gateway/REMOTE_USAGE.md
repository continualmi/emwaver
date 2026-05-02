# Remote Usage Without EMWaver Cloud

EMWaver's local-first direction does not require a hosted relay for core hardware control.

The machine connected to the board owns the hardware transport and runs the `.emw` runtime. Remote access should use user-owned infrastructure.

## SSH CLI Workflow

Use SSH to enter the machine that owns the board:

```bash
ssh user@lab-machine
emwaver devices
emwaver run scripts/blink.emw
```

Once the local gateway is available:

```bash
ssh user@lab-machine
emwaver gateway
```

Then either use SSH port forwarding:

```bash
ssh -L 3921:127.0.0.1:3921 user@lab-machine
```

and open locally:

```text
http://127.0.0.1:3921
```

or run a browser on the remote machine if that environment supports it.

## VPN/Tailscale Workflow

Users may also run EMWaver over a private VPN or Tailscale-style network. This is user-managed networking, not an EMWaver-hosted relay.

The gateway binds to `127.0.0.1` by default. Binding to a non-local interface should require an explicit future flag and clear security warning.

## Security Boundary

Local hardware control is powerful. A gateway session can run scripts that drive pins, buses, radios, and connected modules.

Default behavior:

- bind to localhost,
- no public network listener,
- no Continual cloud relay,
- no account requirement,
- no subscription requirement.

If a user exposes the gateway through SSH forwarding, VPN, reverse proxy, or port forwarding, access control is their responsibility.

## Product Position

Remote control from anywhere is not a launch-critical hosted cloud promise.

The launch-supported remote story is:

- same machine: local CLI/gateway,
- remote technical user: SSH/VPN into the hardware-owning machine,
- optional hosted relay only if real users later need it.
