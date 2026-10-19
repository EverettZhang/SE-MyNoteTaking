from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request
from sqlalchemy import delete, update
from src.models.note import Note, db

note_bp = Blueprint('note', __name__)

DELETED_NOTE_LIMIT = 10
RECOVERY_PROTECTION = timedelta(seconds=60)


def prune_deleted_notes(now):
    """Remove surplus old deleted notes within the caller's transaction."""
    newest_ids = db.session.scalars(
        db.select(Note.id)
        .where(Note.deleted_at.is_not(None))
        .order_by(Note.deleted_at.desc(), Note.id.desc())
        .limit(DELETED_NOTE_LIMIT)
    ).all()
    db.session.execute(
        delete(Note).where(
            Note.deleted_at.is_not(None),
            Note.deleted_at <= now - RECOVERY_PROTECTION,
            Note.id.not_in(newest_ids),
        )
    )


@note_bp.route('/notes/deleted/status', methods=['GET'])
def deleted_note_status():
    """Tell the confirmation UI when deletion may evict an older note."""
    count = Note.query.filter(Note.deleted_at.is_not(None)).count()
    return jsonify({'count': count, 'will_evict': count >= DELETED_NOTE_LIMIT})


@note_bp.route('/notes/deleted/refresh', methods=['POST'])
def refresh_deleted_notes():
    """Prune eligible old notes, then return every retained deleted note."""
    try:
        prune_deleted_notes(datetime.now(timezone.utc).replace(tzinfo=None))
        notes = Note.query.filter(Note.deleted_at.is_not(None)).order_by(
            Note.deleted_at.desc(), Note.id.desc()
        ).all()
        result = [dict(note.to_dict(), deleted_at=note.deleted_at.isoformat() + 'Z')
                  for note in notes]
        db.session.commit()
        return jsonify(result)
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Unable to load deleted notes'}), 500

@note_bp.route('/notes', methods=['GET'])
def get_notes():
    """Get all notes, ordered by most recently updated"""
    notes = Note.query.filter(Note.deleted_at.is_(None)).order_by(Note.updated_at.desc()).all()
    return jsonify([note.to_dict() for note in notes])

@note_bp.route('/notes', methods=['POST'])
def create_note():
    """Create a new note"""
    try:
        data = request.json
        if not data or 'title' not in data or 'content' not in data:
            return jsonify({'error': 'Title and content are required'}), 400
        
        note = Note(title=data['title'], content=data['content'])
        db.session.add(note)
        db.session.commit()
        return jsonify(note.to_dict()), 201
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Unable to create note'}), 500

@note_bp.route('/notes/<int:note_id>', methods=['GET'])
def get_note(note_id):
    """Get a specific note by ID"""
    note = Note.query.filter_by(id=note_id, deleted_at=None).first_or_404()
    return jsonify(note.to_dict())

@note_bp.route('/notes/<int:note_id>', methods=['PUT'])
def update_note(note_id):
    """Update a specific note"""
    note = Note.query.filter_by(id=note_id, deleted_at=None).first_or_404()
    try:
        data = request.json
        
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        note.title = data.get('title', note.title)
        note.content = data.get('content', note.content)
        db.session.commit()
        return jsonify(note.to_dict())
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Unable to update note'}), 500

@note_bp.route('/notes/<int:note_id>', methods=['DELETE'])
def delete_note(note_id):
    """Hide a note while preserving its identity and content for restoration."""
    note = db.session.get(Note, note_id)
    if note is None:
        return jsonify({'error': 'Note not found'}), 404
    if note.deleted_at is not None:
        return '', 204, {'X-Deleted-At': note.deleted_at.isoformat() + 'Z'}
    try:
        deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.session.execute(
            update(Note)
            .where(Note.id == note_id, Note.deleted_at.is_(None))
            .values(deleted_at=deleted_at,
                    updated_at=Note.updated_at)
        )
        prune_deleted_notes(deleted_at)
        db.session.commit()
        return '', 204, {'X-Deleted-At': deleted_at.isoformat() + 'Z'}
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Unable to delete note'}), 500

@note_bp.route('/notes/<int:note_id>/restore', methods=['POST'])
def restore_note(note_id):
    """Restore a soft-deleted note, including its original timestamps."""
    note = db.session.get(Note, note_id, with_for_update=True)
    if note is None:
        return jsonify({'error': 'Note not found'}), 404
    try:
        if note.deleted_at is not None:
            db.session.execute(
                update(Note)
                .where(Note.id == note_id, Note.deleted_at.is_not(None))
                .values(deleted_at=None, updated_at=Note.updated_at)
            )
            db.session.commit()
            db.session.refresh(note)
        return jsonify(note.to_dict())
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Unable to restore note'}), 500

@note_bp.route('/notes/search', methods=['GET'])
def search_notes():
    """Search notes by title or content"""
    query = request.args.get('q', '')
    if not query:
        return jsonify([])
    
    notes = Note.query.filter(Note.deleted_at.is_(None)).filter(
        (Note.title.icontains(query)) | (Note.content.icontains(query))
    ).order_by(Note.updated_at.desc()).all()
    
    return jsonify([note.to_dict() for note in notes])

