from __future__ import annotations

from flask import Blueprint, Response, jsonify, request


docs_bp = Blueprint("docs", __name__)


def _openapi_spec(*, base_url: str) -> dict:
    return {
        "openapi": "3.0.3",
        "info": {
            "title": "EMWaver Backend API",
            "version": "v1",
            "description": "Manual Swagger UI docs. Auth: Authorization: Bearer <firebase_id_token>.",
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
                "FileMetadata": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "format": "uuid"},
                        "name": {"type": "string"},
                        "extension": {"type": "string"},
                        "file_extension": {"type": "string"},
                        "kind": {"type": "string"},
                        "etag": {"type": "string"},
                        "size_bytes": {"type": "integer"},
                        "content_type": {"type": "string"},
                    },
                    "required": ["id", "name", "kind", "etag", "size_bytes", "content_type"],
                },
                "FileStorage": {
                    "type": "object",
                    "properties": {
                        "provider": {"type": "string"},
                        "container": {"type": "string"},
                        "blob_key": {"type": "string"},
                    },
                    "required": ["provider", "container", "blob_key"],
                },
                "CloudFile": {
                    "type": "object",
                    "properties": {
                        "metadata": {"$ref": "#/components/schemas/FileMetadata"},
                        "storage": {"$ref": "#/components/schemas/FileStorage"},
                    },
                    "required": ["metadata", "storage"],
                },
                "ListFilesResponse": {
                    "type": "object",
                    "properties": {
                        "files": {
                            "type": "array",
                            "items": {"$ref": "#/components/schemas/CloudFile"},
                        }
                    },
                    "required": ["files"],
                },
                "InitUploadRequest": {
                    "type": "object",
                    "properties": {
                        "kind": {"type": "string", "example": "script"},
                        "name": {"type": "string", "example": "uart.emw"},
                        "content_type": {"type": "string", "example": "application/octet-stream"},
                        "size_bytes": {"type": "integer", "example": 1234},
                    },
                    "required": ["kind", "name"],
                },
                "InitUploadResponse": {
                    "type": "object",
                    "properties": {
                        "file": {"$ref": "#/components/schemas/CloudFile"},
                        "upload_url": {"type": "string"},
                    },
                    "required": ["file", "upload_url"],
                },
                "CommitUploadRequest": {
                    "type": "object",
                    "properties": {
                        "etag": {"type": "string", "description": "etag from init-upload response"},
                        "size_bytes": {"type": "integer"},
                    },
                    "required": ["etag"],
                },
                "DownloadURLResponse": {
                    "type": "object",
                    "properties": {"download_url": {"type": "string"}},
                    "required": ["download_url"],
                },
                "RenameRequest": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}},
                    "required": ["name"],
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
                    "summary": "List files (metadata)",
                    "parameters": [
                        {
                            "name": "kind",
                            "in": "query",
                            "required": False,
                            "schema": {"type": "string"},
                            "description": "Examples: script, signal_raw, signal_text",
                        },
                        {
                            "name": "ext",
                            "in": "query",
                            "required": False,
                            "schema": {"type": "string"},
                            "description": "Examples: .emw, .raw, .txt",
                        },
                    ],
                    "responses": {
                        "200": {
                            "description": "OK",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ListFilesResponse"}
                                }
                            },
                        },
                        "401": {
                            "description": "Unauthorized",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                            },
                        },
                    },
                }
            },
            "/v1/files/upload": {
                "post": {
                    "summary": "Upload file via backend (overwrite by name)",
                    "description": "One-shot flow: client sends base64 bytes to backend; backend stores in Azure and upserts metadata.",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "kind": {"type": "string", "example": "signal_raw"},
                                        "name": {"type": "string", "example": "tesla.raw"},
                                        "content_type": {"type": "string", "example": "application/octet-stream"},
                                        "data_base64": {"type": "string", "example": "AAECAw=="},
                                        "size_bytes": {"type": "integer", "example": 4},
                                    },
                                    "required": ["kind", "name", "data_base64"],
                                }
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "OK",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {"file": {"$ref": "#/components/schemas/CloudFile"}},
                                        "required": ["file"],
                                    }
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}},
                        },
                        "401": {
                            "description": "Unauthorized",
                            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}},
                        },
                        "502": {
                            "description": "Azure upload failed",
                            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}},
                        },
                    },
                }
            },
            "/v1/files/init-upload": {
                "post": {
                    "summary": "Init upload (allocate metadata + get Azure SAS PUT URL)",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {"schema": {"$ref": "#/components/schemas/InitUploadRequest"}}
                        },
                    },
                    "responses": {
                        "201": {
                            "description": "Created",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/InitUploadResponse"}
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                            },
                        },
                        "401": {
                            "description": "Unauthorized",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                            },
                        },
                        "409": {
                            "description": "File already exists",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                            },
                        },
                    },
                }
            },
            "/v1/files/{file_id}": {
                "get": {
                    "summary": "Get file metadata",
                    "parameters": [
                        {
                            "name": "file_id",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string", "format": "uuid"},
                        }
                    ],
                    "responses": {
                        "200": {
                            "description": "OK",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/CloudFile"}}
                            },
                        },
                        "401": {
                            "description": "Unauthorized",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                            },
                        },
                        "404": {
                            "description": "Not found",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                            },
                        },
                    },
                },
                "delete": {
                    "summary": "Delete file (requires etag query param)",
                    "parameters": [
                        {
                            "name": "file_id",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string", "format": "uuid"},
                        },
                        {
                            "name": "etag",
                            "in": "query",
                            "required": True,
                            "schema": {"type": "string"},
                        },
                    ],
                    "responses": {
                        "200": {
                            "description": "OK",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/OkResponse"}}
                            },
                        },
                        "401": {
                            "description": "Unauthorized",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                            },
                        },
                        "404": {
                            "description": "Not found",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                            },
                        },
                        "409": {
                            "description": "Conflict",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                            },
                        },
                    },
                },
            },
            "/v1/files/{file_id}/commit-upload": {
                "post": {
                    "summary": "Commit upload (finalize after Azure PUT)",
                    "parameters": [
                        {
                            "name": "file_id",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string", "format": "uuid"},
                        }
                    ],
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {"schema": {"$ref": "#/components/schemas/CommitUploadRequest"}}
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "OK",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/CloudFile"}}
                            },
                        },
                        "401": {
                            "description": "Unauthorized",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                            },
                        },
                        "404": {
                            "description": "Not found",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                            },
                        },
                        "409": {
                            "description": "Conflict",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                            },
                        },
                    },
                }
            },
            "/v1/files/{file_id}/content": {
                "get": {
                    "summary": "Download file bytes via backend (no SAS)",
                    "parameters": [
                        {
                            "name": "file_id",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string", "format": "uuid"},
                        }
                    ],
                    "responses": {
                        "200": {"description": "OK"},
                        "401": {
                            "description": "Unauthorized",
                            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}},
                        },
                        "404": {
                            "description": "Not found",
                            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}},
                        },
                        "502": {
                            "description": "Azure download failed",
                            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}},
                        },
                    },
                }
            },
            "/v1/files/{file_id}/download": {
                "get": {
                    "summary": "Get Azure SAS download URL",
                    "parameters": [
                        {
                            "name": "file_id",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string", "format": "uuid"},
                        }
                    ],
                    "responses": {
                        "200": {
                            "description": "OK",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/DownloadURLResponse"}}
                            },
                        },
                        "401": {
                            "description": "Unauthorized",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                            },
                        },
                        "404": {
                            "description": "Not found",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                            },
                        },
                    },
                }
            },
            "/v1/files/{file_id}/rename": {
                "post": {
                    "summary": "Rename file (metadata only; blob key is not renamed)",
                    "parameters": [
                        {
                            "name": "file_id",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string", "format": "uuid"},
                        }
                    ],
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {"schema": {"$ref": "#/components/schemas/RenameRequest"}}
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "OK",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/CloudFile"}}
                            },
                        },
                        "401": {
                            "description": "Unauthorized",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                            },
                        },
                        "404": {
                            "description": "Not found",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                            },
                        },
                        "409": {
                            "description": "Conflict (name already in use)",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                            },
                        },
                    },
                }
            },
        },
    }


@docs_bp.get("/openapi.json")
def openapi_json():
    # Serve spec with the correct base URL for the current host/port.
    base_url = request.host_url.rstrip("/")
    return jsonify(_openapi_spec(base_url=base_url))


@docs_bp.get("/docs")
def swagger_ui():
    html = """<!doctype html>
<html>
  <head>
    <meta charset='utf-8' />
    <meta name='viewport' content='width=device-width, initial-scale=1' />
    <title>EMWaver Backend API Docs</title>
    <link rel='stylesheet' href='https://unpkg.com/swagger-ui-dist@5/swagger-ui.css' />
    <style>
      body { margin: 0; }
      #swagger-ui { height: 100vh; }
    </style>
  </head>
  <body>
    <div id='swagger-ui'></div>
    <script src='https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js'></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        persistAuthorization: true,
        displayRequestDuration: true,
      });
    </script>
  </body>
</html>"""
    return Response(html, mimetype="text/html")
