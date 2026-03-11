import { NextResponse, type NextRequest } from "next/server";

function openapiSpec(baseUrl: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: "EMWaver Backend API",
      version: "v1",
      description: "Unified EMWaver web/backend API. Auth: Authorization: Bearer <firebase_id_token>.",
    },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Firebase ID token",
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/v1/files": {
        get: { summary: "List all files for the current user" },
        delete: { summary: "Delete a file by name" },
      },
      "/v1/files/upload": {
        post: { summary: "Upload a file by name (overwrite)" },
      },
      "/v1/files/content": {
        get: { summary: "Download bytes for a file (by name)" },
      },
      "/v1/hosts": {
        get: { summary: "List host sessions for the current user" },
      },
      "/v1/hosts/heartbeat": {
        post: { summary: "Register or refresh a host session heartbeat" },
      },
      "/v1/ws": {
        get: { summary: "WebSocket entrypoint for host/web remote control" },
      },
    },
  };
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  return NextResponse.json(openapiSpec(url.origin));
}
