from flask import Flask
from flask_cors import CORS

from emw_backend.config import Config
from emw_backend.db import init_db
from emw_backend.routes.agent import agent_bp
from emw_backend.routes.agent_messages import agent_messages_bp
from emw_backend.routes.files import files_bp
from emw_backend.routes.health import health_bp
from emw_backend.routes.docs import docs_bp
from emw_backend.routes.hosts import hosts_bp
from emw_backend.routes.ws import init_ws
from emw_backend.routes.provisioning import provisioning_bp
from emw_backend.routes.store import store_bp
from emw_backend.routes.devices import devices_bp
from emw_backend.routes.entitlements import entitlements_bp
from emw_backend.routes.billing import billing_bp
from emw_backend.routes.admin import admin_bp
from emw_backend.routes.pro import pro_bp
from emw_backend.routes.credits import credits_bp
from emw_backend.routes.auth_handoff import auth_handoff_bp


def create_app() -> Flask:
    # Local dev convenience: load backend/.env if present.
    # (No-op in prod; env vars in Container Apps remain authoritative.)
    try:
        from dotenv import load_dotenv

        load_dotenv(dotenv_path="backend/.env", override=False)
        load_dotenv(dotenv_path=".env", override=False)
    except Exception:
        pass

    config = Config.from_env()

    app = Flask(__name__)
    app.config["EMWAVER_CONFIG"] = config

    # Optional auth debug logging.
    if config.auth_debug:
        import logging

        logging.basicConfig(level=logging.INFO)

    CORS(app, resources={r"/*": {"origins": config.cors_origins}})
    init_db(config.database_url)

    app.register_blueprint(health_bp)
    app.register_blueprint(agent_bp)
    app.register_blueprint(agent_messages_bp)
    app.register_blueprint(files_bp)
    app.register_blueprint(hosts_bp)
    app.register_blueprint(docs_bp)
    app.register_blueprint(provisioning_bp)
    app.register_blueprint(store_bp)
    app.register_blueprint(devices_bp)
    app.register_blueprint(entitlements_bp)
    app.register_blueprint(billing_bp)
    app.register_blueprint(pro_bp)
    app.register_blueprint(credits_bp)
    app.register_blueprint(auth_handoff_bp)
    app.register_blueprint(admin_bp)

    # WebSocket endpoint for Remote Sessions.
    init_ws(app)

    return app
