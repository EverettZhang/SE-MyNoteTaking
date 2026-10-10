import json
import io
import unittest
from contextlib import redirect_stdout
from unittest.mock import Mock, patch

from flask import Flask

from src.routes.translate import translate_bp
from translator import llm_generate, main


class TranslationTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.register_blueprint(translate_bp, url_prefix="/api")
        self.client = app.test_client()

    @patch("translator.requests.post")
    @patch("translator.dotenv_values", return_value={"OPENROUTER_API_KEY": "test-key"})
    def test_valid_model_json(self, _dotenv, post):
        response = Mock()
        response.json.return_value = {
            "choices": [{"message": {"content": json.dumps({"translation": "你好\n世界"})}}]
        }
        post.return_value = response

        self.assertEqual(llm_generate("Hello\nworld"), "你好\n世界")
        sent = post.call_args.kwargs["json"]["messages"]
        self.assertIn("Traditional Chinese", sent[0]["content"])
        self.assertEqual(sent[1]["content"], "Hello\nworld")

    @patch("translator.requests.post")
    @patch("translator.dotenv_values", return_value={"OPENROUTER_API_KEY": "test-key"})
    def test_invalid_model_json_is_rejected(self, _dotenv, post):
        response = Mock()
        response.json.return_value = {"choices": [{"message": {"content": "plain text"}}]}
        post.return_value = response

        with self.assertRaisesRegex(ValueError, "invalid translation JSON"):
            llm_generate("Hello")

    @patch("src.routes.translate.llm_generate", return_value="你好")
    def test_endpoint_returns_json(self, generate):
        response = self.client.post("/api/translate", json={"text": "Hello"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"translation": "你好"})
        generate.assert_called_once_with("Hello")

    def test_endpoint_rejects_empty_text(self):
        response = self.client.post("/api/translate", json={"text": "   "})
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json)

    @patch("src.routes.translate.llm_generate", side_effect=ValueError("bad model response"))
    def test_endpoint_hides_model_errors(self, _generate):
        response = self.client.post("/api/translate", json={"text": "Hello"})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("bad model response", response.json["error"])

    @patch("translator.llm_generate", return_value="你好")
    @patch("sys.argv", ["translator.py", "Hello"])
    def test_command_line_outputs_json(self, _generate):
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(main(), 0)
        self.assertEqual(json.loads(output.getvalue()), {"translation": "你好"})


if __name__ == "__main__":
    unittest.main()
