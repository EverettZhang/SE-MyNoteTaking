# How the NoteTaker web app works

NoteTaker is a small, single-page application for creating, finding, editing, and deleting notes. The browser runs the interface in `src/static/index.html`. A Flask server provides the note API, and SQLAlchemy stores notes in a SQLite database. The editor's Translate button uses `translator.py` to produce a separate Traditional Chinese result.

## 1. Run it locally

From the repository root, create a virtual environment and install the Python dependencies:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python src/main.py
```

On macOS or Linux, activate the environment with `source .venv/bin/activate` instead. Then open <http://localhost:5001/>. The server listens on port 5001 and runs with Flask debug mode enabled when started this way, so this command is intended for local development.

On startup, `src/main.py` creates the `database` directory if necessary, configures SQLite at `database/app.db` **in the repository root**, and calls `db.create_all()` to create missing tables. The database file appears when the app first uses it. Notes remain there across server restarts.

## 2. Follow the parts of the app

| File | Responsibility |
| --- | --- |
| `src/main.py` | Creates the Flask app, registers API routes, initializes the database, and serves the frontend. |
| `src/static/index.html` | Contains the page, styling, and the JavaScript `NoteTaker` class that handles user actions. |
| `src/routes/note.py` | Defines the HTTP endpoints for notes. |
| `src/models/note.py` | Defines the `Note` database table and its JSON representation. |
| `src/models/user.py` | Provides the shared SQLAlchemy `db` object and a separate `User` model. |
| `src/routes/user.py` | Defines separate user CRUD endpoints; the note interface does not use them. |

The path through the app looks like this:

```text
Browser action
  → NoteTaker JavaScript in index.html
  → fetch('/api/notes...')
  → Flask route in src/routes/note.py
  → Note model and SQLAlchemy session
  → SQLite database/app.db
  → JSON response
  → updated browser interface
```

`src/main.py` registers the note and user blueprints under `/api`. It also serves `index.html` at `/` and serves files such as the favicon from `src/static`.

## 3. Load and display notes

When the page loads, the `NoteTaker` constructor sets up its state and event handlers, then calls `loadNotes()`. That method requests `GET /api/notes`. The server reads all `Note` rows, orders them by `updated_at` with the newest first, and returns a JSON array.

Each note has an integer `id`, a `title`, `content`, `created_at`, and `updated_at`. `Note.to_dict()` converts the date values to ISO-format strings for the response. The browser keeps the returned array in `this.notes` and draws the sidebar list. It escapes note titles and previews before inserting them into HTML.

Clicking a sidebar item calls `selectNote(id)`. The editor then shows that note's title and content, while `this.currentNote` tracks which note will be saved or deleted.

## 4. Create, edit, and auto-save a note

Click **New Note** to open a blank editor. This creates a browser-side note with no ID; it is not in SQLite yet. Enter a title or content and click **Save**. `saveNote()` sends a JSON `POST /api/notes` request. If the title is blank, the browser uses `Untitled`. The server requires both `title` and `content` fields, inserts a `Note`, commits the transaction, and responds with the saved note and HTTP `201`. The browser adds that response to its list and keeps its new ID as the current note.

For an existing note, **Save** sends `PUT /api/notes/<id>` with the current title and content. The server changes the supplied fields and commits. SQLAlchemy updates `updated_at` when the row changes. The response replaces the corresponding note in the browser's array.

Typing in an **existing** note also schedules an auto-save two seconds after the last input event. Further typing resets that timer. A brand-new note has no ID, so typing alone does not create it; click **Save** once first. If both fields are blank, the browser skips saving and displays an error for a manual save.

## 5. Search and delete

The search box filters the notes already loaded in the browser. It compares the query with each title and content without regard to letter case, then redraws the sidebar. This does not make a network request. The server also exposes `GET /api/notes/search?q=...` for API clients, but the current page does not call it.

For an existing note, **Delete** asks for confirmation, then sends `DELETE /api/notes/<id>`. The server deletes the row and returns HTTP `204` with no body. The browser removes the note from its array and closes the editor.

## 6. Try the API directly

These are the note endpoints registered under `/api`:

| Method and path | Result |
| --- | --- |
| `GET /api/notes` | All notes, newest update first. |
| `POST /api/notes` | Create a note from JSON containing `title` and `content`. |
| `GET /api/notes/<id>` | One note, or HTTP `404` if absent. |
| `PUT /api/notes/<id>` | Update supplied fields of a note. |
| `DELETE /api/notes/<id>` | Delete a note; success returns HTTP `204`. |
| `GET /api/notes/search?q=<query>` | Notes whose title or content contains the query. |
| `POST /api/translate` | Translate JSON `{"text":"..."}` into Traditional Chinese; returns JSON `{"translation":"..."}`. |

For example, with the server running, create and list notes in PowerShell:

```powershell
Invoke-RestMethod -Uri http://localhost:5001/api/notes `
  -Method Post -ContentType 'application/json' `
  -Body '{"title":"First note","content":"Hello from the API"}'

Invoke-RestMethod -Uri http://localhost:5001/api/notes
```

The `Note` model sets timestamps when records are inserted and updates `updated_at` on later changes. These timestamps are returned as strings without a timezone suffix. The API's validation is limited: creation checks that the two fields are present, and updating checks that a JSON body was provided. The browser applies its own blank-note check before sending a save request.

## 7. Trace one complete action

To see the pieces together, create a note in the browser:

1. **New Note** opens a blank editor without sending a request.
2. **Save** calls `saveNote()`, which sends `POST /api/notes`.
3. `create_note()` builds a `Note` and commits it through the shared `db` session.
4. SQLite stores the row in `database/app.db`.
5. The route returns the new note as JSON. The browser records its ID and redraws the sidebar.

Later edits use the same route-to-model-to-database path with `PUT` instead of `POST`.
