from __future__ import annotations

from flask import Blueprint, Response, jsonify, request


docs_bp = Blueprint("docs", __name__)


def _openapi_spec(*, base_url: str) -> dict:
    return {
        "openapi": "3.0.3",
        "info": {
            "title": "EMWaver Backend API",
            "version": "v1",
            "description": "Blobs-only user file store. Auth: Authorization: Bearer <firebase_id_token>.",
        },
        "servers": [{"url": base_url}],
        "components": {
            "securitySchemes": {
                "bearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "JWT",
                    "description": "Firebase ID token",
                }
            },
            "schemas": {
                "Error": {
                    "type": "object",
                    "properties": {"error": {"type": "string"}},
                    "required": ["error"],
                },
                "UserFile": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "example": "tesla.raw"},
                        "blob_key": {"type": "string", "example": "u/<uid>/tesla.raw"},
                        "etag": {"type": "string"},
                        "size_bytes": {"type": "integer"},
                        "last_modified": {"type": "string", "nullable": True},
                        "content_type": {"type": "string", "nullable": True},
                        "mtime_ms": {"type": "integer", "nullable": True, "description": "User modification time (unix ms) stored in blob metadata"},
                    },
                    "required": ["name", "blob_key", "size_bytes"],
                },
                "ListFilesResponse": {
                    "type": "object",
                    "properties": {"files": {"type": "array", "items": {"$ref": "#/components/schemas/UserFile"}}},
                    "required": ["files"],
                },
                "UploadRequest": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "example": "tesla.raw"},
                        "content_type": {"type": "string", "example": "application/octet-stream"},
                        "data_base64": {"type": "string", "example": "AAECAw=="},
                        "mtime_ms": {"type": "integer", "example": 1738695200000},
                    },
                    "required": ["name", "data_base64"],
                },
                "UploadResponse": {
                    "type": "object",
                    "properties": {"file": {"$ref": "#/components/schemas/UserFile"}},
                    "required": ["file"],
                },
                "OkResponse": {
                    "type": "object",
                    "properties": {"ok": {"type": "boolean"}},
                    "required": ["ok"],
                },
            },
        },
        "security": [{"bearerAuth": []}],
        "paths": {
            "/v1/files": {
                "get": {
                    "summary": "List all files for the current user",
                    "responses": {
                        "200": {"description": "OK", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ListFilesResponse"}}}},
                        "401": {"description": "Unauthorized", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
                    },
                },
                "delete": {
                    "summary": "Delete a file by name",
                    "parameters": [
                        {"name": "name", "in": "query", "required": True, "schema": {"type": "string"}, "example": "tesla.raw"}
                    ],
                    "responses": {
                        "200": {"description": "OK", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}}},
                        "401": {"description": "Unauthorized", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
                        "404": {"description": "Not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
                    },
                },
            },
            "/v1/files/upload": {
                "post": {
                    "summary": "Upload a file by name (overwrite)",
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/UploadRequest"}}}},
                    "responses": {
                        "200": {"description": "OK", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/UploadResponse"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
                        "401": {"description": "Unauthorized", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
                        "502": {"description": "Azure upload failed", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
                    },
                }
            },
            "/v1/files/content": {
                "get": {
                    "summary": "Download bytes for a file (by blob_key or name)",
                    "parameters": [
                        {"name": "blob_key", "in": "query", "required": False, "schema": {"type": "string"}, "example": "u/<uid>/tesla.raw"},
                        {"name": "name", "in": "query", "required": False, "schema": {"type": "string"}, "example": "tesla.raw"}
                    ],
                    "responses": {
                        "200": {"description": "OK", "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}},
                        "400": {"description": "Bad request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
                        "401": {"description": "Unauthorized", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
                        "404": {"description": "Not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
                        "502": {"description": "Azure download failed", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
                    },
                }
            },
        },
    }


@docs_bp.get("/openapi.json")
def openapi_json():
    base_url = request.host_url.rstrip("/")
    return jsonify(_openapi_spec(base_url=base_url))


@docs_bp.get("/docs")
def swagger_ui():
    # Minimal Swagger UI bootstrap.
    html = f"""<!doctype html>
<html>
  <head>
    <meta charset='utf-8' />
    <meta name='viewport' content='width=device-width, initial-scale=1' />
    <title>EMWaver API Docs</title>
    <link rel='stylesheet' href='https://unpkg.com/swagger-ui-dist@5/swagger-ui.css' />
  </head>
  <body>
    <div id='swagger-ui'></div>
    <script src='https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js'></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '{request.host_url.rstrip('/')}/openapi.json',
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis],
        layout: 'BaseLayout'
      });
    </script>
  </body>
</html>"""
    return Response(html, mimetype="text/html")
