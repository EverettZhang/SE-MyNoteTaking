"""Exercise recoverable deletion without touching the configured Neon database."""

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from flask import Flask

from src.models.note import Note, db
from src.routes.note import note_bp


class SoftDeleteTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
        self.app.register_blueprint(note_bp, url_prefix='/api')
        db.init_app(self.app)
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()
        self.client = self.app.test_client()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.context.pop()

    def create_note(self, title='First note'):
        response = self.client.post('/api/notes', json={'title': title, 'content': 'Original content'})
        self.assertEqual(response.status_code, 201)
        return response.json

    def test_delete_and_restore_preserve_note_identity_and_timestamps(self):
        original = self.create_note()
        note_id = original['id']

        self.assertEqual(self.client.delete(f'/api/notes/{note_id}').status_code, 204)
        deleted_at = db.session.get(Note, note_id).deleted_at
        self.assertIsNotNone(deleted_at)
        self.assertEqual(self.client.delete(f'/api/notes/{note_id}').status_code, 204)
        self.assertEqual(db.session.get(Note, note_id).deleted_at, deleted_at)

        self.assertEqual(self.client.get('/api/notes').json, [])
        self.assertEqual(self.client.get(f'/api/notes/{note_id}').status_code, 404)
        self.assertEqual(self.client.put(f'/api/notes/{note_id}', json={'title': 'Changed'}).status_code, 404)
        self.assertEqual(self.client.get('/api/notes/search?q=Original').json, [])

        restored = self.client.post(f'/api/notes/{note_id}/restore')
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(restored.json, original)
        self.assertIsNone(db.session.get(Note, note_id).deleted_at)
        self.assertEqual(self.client.post(f'/api/notes/{note_id}/restore').json, original)
        self.assertEqual(self.client.get('/api/notes').json, [original])
        self.assertEqual(self.client.get('/api/notes/search?q=Original').json, [original])

    def test_delete_only_hides_target_note_and_missing_ids_return_404(self):
        first = self.create_note()
        second = self.create_note('Second note')
        self.assertEqual(self.client.delete(f"/api/notes/{first['id']}").status_code, 204)
        self.assertEqual([note['id'] for note in self.client.get('/api/notes').json], [second['id']])
        self.assertEqual(self.client.delete('/api/notes/99999').status_code, 404)
        self.assertEqual(self.client.post('/api/notes/99999/restore').status_code, 404)

    def test_multiple_deletions_can_be_restored_independently(self):
        first = self.create_note()
        second = self.create_note('Second note')
        self.assertEqual(self.client.delete(f"/api/notes/{first['id']}").status_code, 204)
        self.assertEqual(self.client.delete(f"/api/notes/{second['id']}").status_code, 204)
        self.assertEqual(self.client.get('/api/notes').json, [])

        self.assertEqual(self.client.post(f"/api/notes/{first['id']}/restore").json, first)
        self.assertEqual(self.client.get('/api/notes').json, [first])
        self.assertIsNotNone(db.session.get(Note, second['id']).deleted_at)

    def test_deleted_view_retains_protected_overflow_then_prunes_oldest(self):
        notes = [self.create_note(f'Note {number}') for number in range(11)]
        for note in notes:
            response = self.client.delete(f"/api/notes/{note['id']}")
            self.assertEqual(response.status_code, 204)
            self.assertTrue(response.headers['X-Deleted-At'].endswith('Z'))

        self.assertTrue(self.client.get('/api/notes/deleted/status').json['will_evict'])
        protected = self.client.post('/api/notes/deleted/refresh')
        self.assertEqual(protected.status_code, 200)
        self.assertEqual(len(protected.json), 11)

        oldest = db.session.get(Note, notes[0]['id'])
        oldest.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=59)
        db.session.commit()
        self.assertEqual(len(self.client.post('/api/notes/deleted/refresh').json), 11)

        oldest = db.session.get(Note, notes[0]['id'])
        oldest.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=61)
        db.session.commit()
        retained = self.client.post('/api/notes/deleted/refresh')
        self.assertEqual(retained.status_code, 200)
        self.assertEqual(len(retained.json), 10)
        self.assertNotIn(notes[0]['id'], [note['id'] for note in retained.json])
        self.assertIsNone(db.session.get(Note, notes[0]['id']))
        self.assertEqual(self.client.post(f"/api/notes/{notes[0]['id']}/restore").status_code, 404)

    def test_next_delete_prunes_eligible_old_note(self):
        notes = [self.create_note(f'Note {number}') for number in range(11)]
        for note in notes[:10]:
            self.assertEqual(self.client.delete(f"/api/notes/{note['id']}").status_code, 204)
        oldest = db.session.get(Note, notes[0]['id'])
        oldest.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=61)
        db.session.commit()

        self.assertEqual(self.client.delete(f"/api/notes/{notes[10]['id']}").status_code, 204)
        self.assertIsNone(db.session.get(Note, notes[0]['id']))
        self.assertEqual(self.client.get('/api/notes/deleted/status').json['count'], 10)

    def test_database_error_keeps_note_visible(self):
        original = self.create_note()
        with patch.object(db.session, 'commit', side_effect=RuntimeError('database unavailable')):
            response = self.client.delete(f"/api/notes/{original['id']}")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.client.get('/api/notes').json, [original])

    def test_restore_error_keeps_note_recoverable(self):
        original = self.create_note()
        self.assertEqual(self.client.delete(f"/api/notes/{original['id']}").status_code, 204)
        with patch.object(db.session, 'commit', side_effect=RuntimeError('database unavailable')):
            response = self.client.post(f"/api/notes/{original['id']}/restore")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.client.get('/api/notes').json, [])
        self.assertIsNotNone(db.session.get(Note, original['id']).deleted_at)
        self.assertEqual(self.client.post(f"/api/notes/{original['id']}/restore").json, original)


if __name__ == '__main__':
    unittest.main()
