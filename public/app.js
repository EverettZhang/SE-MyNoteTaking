class NoteTaker {
    constructor() {
        this.notes = [];
        this.currentNote = null;
        this.loadError = false;
        this.saveTimer = null;
        this.savePromise = null;
        this.messageTimer = null;
        this.messageContext = null;
        this.navigationInProgress = false;
        this.translationRequest = 0;

        this.ui = {};
        for (const id of [
            'newNoteBtn', 'searchBox', 'notesList', 'noteEditor', 'editorTitle',
            'editorActions', 'saveStatus', 'saveBtn', 'translateBtn', 'deleteBtn',
            'messageArea', 'editorForm', 'noteTitle', 'noteContent',
            'translationPanel', 'translationResult', 'emptyState'
        ]) {
            this.ui[id] = document.getElementById(id);
        }

        this.bindEvents();
        this.loadNotes();
    }

    bindEvents() {
        this.ui.newNoteBtn.addEventListener('click', () => this.createNewNote());
        this.ui.saveBtn.addEventListener('click', () => this.saveNote());
        this.ui.translateBtn.addEventListener('click', () => this.translateNote());
        this.ui.deleteBtn.addEventListener('click', () => this.deleteNote());
        this.ui.searchBox.addEventListener('input', () => this.renderNotesList());
        this.ui.notesList.addEventListener('click', (event) => {
            const button = event.target.closest('[data-note-id]');
            if (button) this.selectNote(Number(button.dataset.noteId));
        });
        this.ui.noteTitle.addEventListener('input', () => this.onDraftChange());
        this.ui.noteContent.addEventListener('input', () => {
            this.clearTranslation();
            this.onDraftChange();
        });
    }

    async loadNotes() {
        try {
            const response = await fetch('/api/notes');
            if (!response.ok) throw new Error('Unable to load notes.');
            this.notes = await response.json();
            this.loadError = false;
        } catch (error) {
            this.loadError = true;
            this.showMessage('Unable to load notes. Please refresh the page.', 'error');
        }
        this.renderNotesList();
    }

    renderNotesList() {
        const list = this.ui.notesList;
        list.replaceChildren();

        if (this.loadError) {
            this.appendListMessage('Notes could not be loaded.');
            return;
        }

        const query = this.ui.searchBox.value.trim().toLocaleLowerCase();
        const notes = query
            ? this.notes.filter((note) =>
                (note.title || '').toLocaleLowerCase().includes(query) ||
                (note.content || '').toLocaleLowerCase().includes(query))
            : this.notes;

        if (notes.length === 0) {
            this.appendListMessage(query
                ? 'No notes match your search.'
                : 'No notes yet. Create one to get started.');
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const note of notes) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'note-item';
            button.dataset.noteId = String(note.id);
            if (this.currentNote && this.currentNote.id === note.id) {
                button.classList.add('active');
                button.setAttribute('aria-current', 'true');
            }

            const title = document.createElement('span');
            title.className = 'note-title';
            title.textContent = note.title || 'Untitled';
            button.append(title);

            const preview = document.createElement('span');
            preview.className = 'note-preview';
            preview.textContent = (note.content || '').replace(/\s+/g, ' ').trim() || 'No content';
            button.append(preview);

            const date = document.createElement('span');
            date.className = 'note-date';
            date.textContent = this.formatDate(note.updated_at);
            button.append(date);

            fragment.append(button);
        }
        list.append(fragment);
    }

    appendListMessage(text) {
        const message = document.createElement('p');
        message.className = 'list-message';
        message.textContent = text;
        this.ui.notesList.append(message);
    }

    async selectNote(noteId) {
        if (this.currentNote && this.currentNote.id === noteId) return;
        if (!(await this.prepareToLeave())) return;

        const note = this.notes.find((item) => item.id === noteId);
        if (!note) return;
        this.clearTranslation();
        this.hideMessage();
        this.currentNote = note;
        this.ui.noteTitle.value = note.title || '';
        this.ui.noteContent.value = note.content || '';
        this.showEditor();
        this.renderNotesList();
        this.scrollToEditorOnSmallScreen();
    }

    async createNewNote() {
        if (!(await this.prepareToLeave())) return;
        this.clearTranslation();
        this.hideMessage();
        this.currentNote = { id: null, title: '', content: '' };
        this.ui.noteTitle.value = '';
        this.ui.noteContent.value = '';
        this.showEditor();
        this.renderNotesList();
        this.scrollToEditorOnSmallScreen();
        this.ui.noteTitle.focus();
    }

    async prepareToLeave() {
        if (this.navigationInProgress) return false;
        this.navigationInProgress = true;
        clearTimeout(this.saveTimer);

        try {
            if (this.currentNote && this.currentNote.id) {
                this.setEditingDisabled(true);
                if (this.savePromise && !(await this.savePromise)) return false;
                if (this.hasUnsavedChanges() && !(await this.saveNote(true))) return false;
            } else if (this.hasUnsavedChanges() &&
                       !window.confirm('Discard this unsaved note?')) {
                return false;
            }
            return true;
        } finally {
            this.setEditingDisabled(false);
            this.navigationInProgress = false;
        }
    }

    showEditor() {
        this.ui.emptyState.hidden = true;
        this.ui.editorForm.hidden = false;
        this.ui.editorActions.hidden = false;
        this.ui.deleteBtn.hidden = !this.currentNote.id;
        this.ui.editorTitle.textContent = 'Note';
        this.updateSaveStatus();
    }

    hideEditor() {
        clearTimeout(this.saveTimer);
        this.clearTranslation();
        this.currentNote = null;
        this.ui.editorForm.hidden = true;
        this.ui.editorActions.hidden = true;
        this.ui.emptyState.hidden = false;
        this.ui.saveStatus.textContent = '';
        this.renderNotesList();
    }

    setEditingDisabled(disabled) {
        for (const element of [
            this.ui.noteTitle, this.ui.noteContent, this.ui.saveBtn,
            this.ui.translateBtn, this.ui.deleteBtn
        ]) {
            element.disabled = disabled;
        }
    }

    scrollToEditorOnSmallScreen() {
        if (window.matchMedia('(max-width: 760px)').matches) {
            this.ui.noteEditor.scrollIntoView({ block: 'start' });
        }
    }

    hasUnsavedChanges() {
        if (!this.currentNote) return false;
        const title = this.ui.noteTitle.value.trim() || 'Untitled';
        const content = this.ui.noteContent.value;
        if (!this.currentNote.id) {
            return Boolean(this.ui.noteTitle.value.trim() || content.trim());
        }
        return title !== (this.currentNote.title || 'Untitled') ||
            content !== (this.currentNote.content || '');
    }

    onDraftChange() {
        this.updateSaveStatus();
        clearTimeout(this.saveTimer);
        if (this.currentNote && this.currentNote.id && this.hasUnsavedChanges()) {
            this.saveTimer = setTimeout(() => this.saveNote(true), 2000);
        }
    }

    updateSaveStatus() {
        if (!this.currentNote) {
            this.ui.saveStatus.textContent = '';
        } else if (this.savePromise) {
            this.ui.saveStatus.textContent = 'Saving…';
        } else if (!this.currentNote.id) {
            this.ui.saveStatus.textContent = 'Not saved yet';
        } else {
            this.ui.saveStatus.textContent = this.hasUnsavedChanges()
                ? 'Unsaved changes'
                : 'Saved';
        }
    }

    async saveNote(isAutoSave = false) {
        if (!this.currentNote) return false;
        clearTimeout(this.saveTimer);

        if (this.savePromise) {
            const previousSaveSucceeded = await this.savePromise;
            if (!previousSaveSucceeded) return false;
            return this.saveNote(isAutoSave);
        }

        if (this.currentNote.id && !this.hasUnsavedChanges()) {
            if (!isAutoSave) this.showMessage('All changes are saved.', 'success');
            this.updateSaveStatus();
            return true;
        }

        const title = this.ui.noteTitle.value.trim();
        const content = this.ui.noteContent.value;
        if (!this.currentNote.id && !title && !content.trim()) {
            if (!isAutoSave) {
                this.showMessage('Add a title or content before saving.', 'error');
            }
            return false;
        }

        const noteId = this.currentNote.id;
        const noteData = { title: title || 'Untitled', content };
        const request = async () => {
            try {
                const response = await fetch(
                    noteId ? '/api/notes/' + noteId : '/api/notes',
                    {
                        method: noteId ? 'PUT' : 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(noteData)
                    }
                );
                if (!response.ok) throw new Error('Unable to save note.');

                const savedNote = await response.json();
                this.currentNote = savedNote;
                this.notes = [
                    savedNote,
                    ...this.notes.filter((note) => note.id !== savedNote.id)
                ];
                this.showEditor();
                this.renderNotesList();
                if (!isAutoSave) this.showMessage('Note saved.', 'success');
                return true;
            } catch (error) {
                this.showMessage('Unable to save note. Your changes are still here.', 'error');
                return false;
            }
        };

        this.savePromise = request();
        this.updateSaveStatus();
        const saved = await this.savePromise;
        this.savePromise = null;
        this.updateSaveStatus();
        return saved;
    }

    clearTranslation() {
        this.translationRequest++;
        this.ui.translationPanel.hidden = true;
        this.ui.translationResult.value = '';
        this.ui.translateBtn.disabled = false;
        if (this.messageContext === 'translation') this.hideMessage();
    }

    async translateNote() {
        if (!this.currentNote) return;
        const text = this.ui.noteContent.value;
        if (!text.trim()) {
            this.showMessage('Enter note content to translate.', 'error');
            return;
        }

        this.clearTranslation();
        const requestId = this.translationRequest;
        this.ui.translateBtn.disabled = true;
        this.showMessage('Translating…', 'info', 'translation');

        try {
            const response = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Translation failed.');
            if (requestId !== this.translationRequest) return;
            this.ui.translationResult.value = result.translation;
            this.ui.translationPanel.hidden = false;
            this.hideMessage();
        } catch (error) {
            if (requestId === this.translationRequest) {
                this.showMessage('Translation failed: ' + error.message, 'error', 'translation');
            }
        } finally {
            if (requestId === this.translationRequest) {
                this.ui.translateBtn.disabled = false;
            }
        }
    }

    async deleteNote() {
        if (!this.currentNote || !this.currentNote.id || this.navigationInProgress) return;
        if (!window.confirm('Delete this note? This cannot be undone.')) return;

        const noteId = this.currentNote.id;
        clearTimeout(this.saveTimer);
        this.navigationInProgress = true;
        this.setEditingDisabled(true);
        try {
            if (this.savePromise) await this.savePromise;
            const response = await fetch('/api/notes/' + noteId, { method: 'DELETE' });
            if (!response.ok) throw new Error('Unable to delete note.');
            this.notes = this.notes.filter((note) => note.id !== noteId);
            this.hideEditor();
            this.showMessage('Note deleted.', 'success');
        } catch (error) {
            this.showMessage('Unable to delete note. Please try again.', 'error');
        } finally {
            this.setEditingDisabled(false);
            this.navigationInProgress = false;
        }
    }

    showMessage(message, type, context = null) {
        clearTimeout(this.messageTimer);
        this.messageContext = context;
        const notice = document.createElement('div');
        notice.className = 'notice notice-' + type;
        notice.textContent = message;
        this.ui.messageArea.replaceChildren(notice);
        this.ui.messageArea.setAttribute('role', type === 'error' ? 'alert' : 'status');
        if (type === 'success') {
            this.messageTimer = setTimeout(() => this.hideMessage(), 3000);
        }
    }

    hideMessage() {
        clearTimeout(this.messageTimer);
        this.messageContext = null;
        this.ui.messageArea.replaceChildren();
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) return '';
        const today = new Date();
        if (date.toDateString() === today.toDateString()) return 'Today';
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
        return date.toLocaleDateString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric'
        });
    }
}

new NoteTaker();
