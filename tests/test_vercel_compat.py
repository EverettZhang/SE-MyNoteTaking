"""Check the Flask entry point and files used in the Vercel deployment."""

import unittest
from unittest.mock import patch

from app import app
from translator import PROMPT_PATH


class VercelCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_frontend_and_favicon(self):
        page = self.client.get('/')
        try:
            self.assertEqual(page.status_code, 200)
            self.assertIn(b'/styles.css', page.data)
            self.assertIn(b'/app.js', page.data)
        finally:
            page.close()

        script = self.client.get('/app.js')
        try:
            self.assertEqual(script.status_code, 200)
            self.assertIn(b'/api/notes', script.data)
        finally:
            script.close()

        stylesheet = self.client.get('/styles.css')
        try:
            self.assertEqual(stylesheet.status_code, 200)
            self.assertIn(b'.note-editor', stylesheet.data)
        finally:
            stylesheet.close()

        favicon = self.client.get('/favicon.ico')
        try:
            self.assertEqual(favicon.status_code, 200)
            self.assertIn(favicon.mimetype, ('image/x-icon', 'image/vnd.microsoft.icon'))
        finally:
            favicon.close()

    def test_translation_prompt_and_route(self):
        self.assertTrue(PROMPT_PATH.is_file())
        self.assertTrue(PROMPT_PATH.read_text(encoding='utf-8').strip())

        with patch('src.routes.translate.llm_generate', return_value='你好'):
            response = self.client.post('/api/translate', json={'text': 'Hello'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {'translation': '你好'})
