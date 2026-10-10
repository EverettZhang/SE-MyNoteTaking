"""Translation endpoint for the note editor."""

import requests
from flask import Blueprint, jsonify, request

from translator import llm_generate


translate_bp = Blueprint("translate", __name__)


@translate_bp.route("/translate", methods=["POST"])
def translate():
    data = request.get_json(silent=True)
    text = data.get("text") if isinstance(data, dict) else None
    if not isinstance(text, str) or not text.strip():
        return jsonify({"error": "Text to translate is required."}), 400

    try:
        translation = llm_generate(text)
    except (ValueError, OSError, requests.RequestException):
        return jsonify({"error": "Translation is unavailable. Please try again."}), 502

    return jsonify({"translation": translation})
