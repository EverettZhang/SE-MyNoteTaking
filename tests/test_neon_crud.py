"""Opt-in CRUD verification against the configured Neon database."""

import os
import unittest
from uuid import uuid4


@unittest.skipUnless(os.environ.get('RUN_NEON_INTEGRATION') == '1',
                     'Set RUN_NEON_INTEGRATION=1 to test against Neon')
class NeonCrudTests(unittest.TestCase):
    def test_note_lifecycle(self):
        from src.main import app
        from src.models.note import Note, db

        client = app.test_client()
        marker = f'neon-crud-test-{uuid4().hex}'
        note_id = None

        try:
            created = client.post('/api/notes', json={
                'title': marker,
                'content': marker,
            })
            self.assertEqual(created.status_code, 201)
            note_id = created.json['id']
            self.assertEqual(created.json['title'], marker)
            self.assertEqual(created.json['content'], marker)
            self.assertIn('created_at', created.json)
            self.assertIn('updated_at', created.json)

            listed = client.get('/api/notes')
            self.assertEqual(listed.status_code, 200)
            self.assertTrue(any(note['id'] == note_id for note in listed.json))

            retrieved = client.get(f'/api/notes/{note_id}')
            self.assertEqual(retrieved.status_code, 200)
            self.assertEqual(retrieved.json['title'], marker)

            updated = client.put(f'/api/notes/{note_id}', json={
                'title': f'{marker}-UPPER',
                'content': marker,
            })
            self.assertEqual(updated.status_code, 200)
            self.assertEqual(updated.json['title'], f'{marker}-UPPER')
            self.assertEqual(updated.json['content'], marker)

            searched = client.get('/api/notes/search', query_string={'q': 'upper'})
            self.assertEqual(searched.status_code, 200)
            self.assertTrue(any(note['id'] == note_id for note in searched.json))

            deleted = client.delete(f'/api/notes/{note_id}')
            self.assertEqual(deleted.status_code, 204)
            self.assertEqual(client.get(f'/api/notes/{note_id}').status_code, 404)
            self.assertFalse(any(note['id'] == note_id for note in client.get('/api/notes').json))

            restored = client.post(f'/api/notes/{note_id}/restore')
            self.assertEqual(restored.status_code, 200)
            self.assertEqual(restored.json['id'], note_id)
            self.assertEqual(restored.json['created_at'], created.json['created_at'])
            self.assertEqual(restored.json['updated_at'], updated.json['updated_at'])
            self.assertEqual(client.get(f'/api/notes/{note_id}').status_code, 200)
        finally:
            with app.app_context():
                # Clean up only the uniquely marked row if an assertion failed.
                note = Note.query.filter_by(content=marker).first()
                if note is not None and (note_id is None or note.id == note_id):
                    db.session.delete(note)
                    db.session.commit()


if __name__ == '__main__':
    unittest.main()
