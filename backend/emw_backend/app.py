from flask import Flask
from flask_cors import CORS

from emw_backend.config import Config
from emw_backend.db import init_db
from emw_backend.routes.agent import agent_bp
from emw_backend.routes.files import files_bp
from emw_backend.routes.health import health_bp
from emw_backend.routes.docs import docs_bp
from emw_backend.routes.hosts import hosts_bp
from emw_backend.routes.ws import init_ws


def create_app() -> Flask:
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
    app.register_blueprint(files_bp)
    app.register_blueprint(hosts_bp)
    app.register_blueprint(docs_bp)

    # WebSocket endpoint for Remote Sessions.
    init_ws(app)

    return app
