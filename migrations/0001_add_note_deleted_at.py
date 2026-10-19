r"""One-time, additive migration for recoverable note deletion.

Run from the repository root with:
    .\.venv\Scripts\python.exe migrations\0001_add_note_deleted_at.py
"""

import os
from contextlib import closing
from pathlib import Path

import psycopg2
from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / '.env')

database_url = os.environ.get('DATABASE_URL_UNPOOLED')
if not database_url:
    raise SystemExit('DATABASE_URL_UNPOOLED is required for this schema migration')

with closing(psycopg2.connect(database_url)) as connection:
    with connection:
        with connection.cursor() as cursor:
            cursor.execute(
                'ALTER TABLE public.note '
                'ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITHOUT TIME ZONE'
            )

print('Note soft-delete migration complete.')
