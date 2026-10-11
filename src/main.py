import os
import sys
# DON'T CHANGE THIS !!!
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from flask import Flask, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from sqlalchemy import create_engine
from src.models.user import db
from src.routes.user import user_bp
from src.routes.note import note_bp
from src.routes.translate import translate_bp
from src.models.note import Note

ROOT_DIR = os.path.abspath(os.path.dirname(os.path.dirname(__file__)))
PUBLIC_DIR = os.path.join(ROOT_DIR, 'public')
load_dotenv(os.path.join(ROOT_DIR, '.env'))

app = Flask(__name__, static_folder=None)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY')

# Enable CORS for all routes
CORS(app)

# register blueprints
app.register_blueprint(user_bp, url_prefix='/api')
app.register_blueprint(note_bp, url_prefix='/api')
app.register_blueprint(translate_bp, url_prefix='/api')
database_url = os.environ.get('DATABASE_URL')
if not database_url:
    raise RuntimeError('DATABASE_URL must be configured')

app.config['SQLALCHEMY_DATABASE_URI'] = database_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {'pool_pre_ping': True}
db.init_app(app)

@app.cli.command('init-db')
def init_db():
    """Create missing tables in the configured PostgreSQL database."""
    schema_url = os.environ.get('DATABASE_URL_UNPOOLED', database_url)
    engine = create_engine(schema_url)
    try:
        db.metadata.create_all(engine)
    finally:
        engine.dispose()

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path != "" and os.path.isfile(os.path.join(PUBLIC_DIR, path)):
        return send_from_directory(PUBLIC_DIR, path)
    else:
        index_path = os.path.join(PUBLIC_DIR, 'index.html')
        if os.path.exists(index_path):
            return send_from_directory(PUBLIC_DIR, 'index.html')
        else:
            return "index.html not found", 404


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
