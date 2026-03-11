import { createServer } from "node:http";
import next from "next";
import { parse } from "node:url";
import { WebSocketServer } from "ws";

import { env } from "./src/server/env";
import { handleWebSocketUpgrade } from "./src/server/ws/upgrade";
import { memoryRemoteSessionState } from "./src/server/ws/state";

const dev = env.nodeEnv !== "production";
const app = next({ dev, dir: process.cwd() });
const handle = app.getRequestHandler();

async function main() {
  await app.prepare();

  const wsServer = new WebSocketServer({ noServer: true });
  const remoteState = memoryRemoteSessionState();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url || "", true);
    void handle(req, res, parsedUrl);
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname !== "/v1/ws") {
      socket.destroy();
      return;
    }

    void handleWebSocketUpgrade({
      req,
      socket,
      head,
      wsServer,
      remoteState,
    });
  });

  server.listen(env.port, () => {
    console.log(`EMWaver web listening on http://0.0.0.0:${env.port}`);
  });
}

main().catch((error) => {
  console.error("Failed to start EMWaver web", error);
  process.exit(1);
});
