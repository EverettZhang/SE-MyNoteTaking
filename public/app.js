class NoteTaker {
    constructor() {
        this.notes = [];
        this.currentNote = null;
        this.loadError = false;
        this.saveTimer = null;
        this.savePromise = null;
        this.messageTimer = null;
        this.undoToasts = new Map();
        this.restoringIds = new Set();
        this.deletedNotes = [];
        this.deletedLoading = false;
        this.deletedLoadError = false;
        this.viewMode = 'notes';
        this.messageContext = null;
        this.navigationInProgress = false;
        this.translationRequest = 0;

        this.ui = {};
        for (const id of [
            'newNoteBtn', 'searchBox', 'notesList', 'noteEditor', 'editorTitle',
            'editorActions', 'saveStatus', 'saveBtn', 'translateBtn', 'deleteBtn',
            'messageArea', 'editorForm', 'noteTitle', 'noteContent',
            'translationPanel', 'translationResult', 'emptyState',
            'confirmDialog', 'confirmDialogTitle', 'confirmDialogDescription',
            'confirmDialogError', 'confirmCancelBtn', 'confirmActionBtn', 'toastRegion',
            'deletedNotesToggle', 'searchContainer', 'sidebarTitle'
        ]) {
            this.ui[id] = document.getElementById(id);
        }

        this.bindEvents();
        this.restoreUndoToasts();
        this.initialLoad = this.loadNotes();
    }

    bindEvents() {
        this.ui.newNoteBtn.addEventListener('click', () => this.createNewNote());
        this.ui.saveBtn.addEventListener('click', () => this.saveNote());
        this.ui.translateBtn.addEventListener('click', () => this.translateNote());
        this.ui.deleteBtn.addEventListener('click', () => this.deleteNote());
        this.ui.deletedNotesToggle.addEventListener('click', () => this.toggleDeletedNotes());
        this.ui.searchBox.addEventListener('input', () => this.renderNotesList());
        this.ui.notesList.addEventListener('click', (event) => {
            const restoreButton = event.target.closest('[data-restore-id]');
            if (restoreButton) {
                this.restoreDeletedNote(Number(restoreButton.dataset.restoreId));
                return;
            }
            if (event.target.closest('[data-refresh-deleted]')) {
                this.loadDeletedNotes();
                return;
            }
            if (this.viewMode !== 'notes') return;
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
        if (this.viewMode === 'deleted') {
            this.renderDeletedNotesList();
            return;
        }
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

    toggleDeletedNotes() {
        this.viewMode = this.viewMode === 'notes' ? 'deleted' : 'notes';
        const deleted = this.viewMode === 'deleted';
        this.ui.sidebarTitle.textContent = deleted ? 'Deleted notes' : 'Notes';
        this.ui.deletedNotesToggle.textContent = deleted ? 'Back to notes' : 'Deleted notes';
        this.ui.deletedNotesToggle.setAttribute('aria-pressed', String(deleted));
        this.ui.searchContainer.hidden = deleted;
        this.ui.notesList.setAttribute('aria-label', deleted ? 'Deleted notes' : 'Notes');
        if (deleted) this.loadDeletedNotes();
        else this.renderNotesList();
    }

    async loadDeletedNotes() {
        if (this.deletedLoading) return;
        this.deletedLoading = true;
        this.deletedLoadError = false;
        this.renderNotesList();
        try {
            const response = await fetch('/api/notes/deleted/refresh', { method: 'POST' });
            if (!response.ok) throw new Error('Unable to load deleted notes.');
            const notes = await response.json();
            if (!Array.isArray(notes)) throw new Error('Invalid deleted notes response.');
            this.deletedNotes = notes;
        } catch (error) {
            this.deletedLoadError = true;
        } finally {
            this.deletedLoading = false;
            this.renderNotesList();
        }
    }

    renderDeletedNotesList() {
        const list = this.ui.notesList;
        list.replaceChildren();
        if (this.deletedLoading) {
            this.appendListMessage('Loading deleted notes…');
            return;
        }
        if (this.deletedLoadError) {
            this.appendListMessage('Unable to load deleted notes.');
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'restore-note-btn';
            retry.dataset.refreshDeleted = 'true';
            retry.textContent = 'Retry';
            list.append(retry);
            return;
        }
        if (this.deletedNotes.length === 0) {
            this.appendListMessage('No deleted notes.');
            return;
        }
        const fragment = document.createDocumentFragment();
        for (const note of this.deletedNotes) {
            const item = document.createElement('article');
            item.className = 'note-item deleted-note-item';
            const title = document.createElement('span');
            title.className = 'note-title';
            title.textContent = note.title || 'Untitled';
            const preview = document.createElement('span');
            preview.className = 'note-preview';
            preview.textContent = (note.content || '').replace(/\s+/g, ' ').trim() || 'No content';
            const actions = document.createElement('div');
            actions.className = 'deleted-note-actions';
            const date = document.createElement('span');
            date.className = 'note-date';
            date.textContent = 'Deleted ' + this.formatDate(note.deleted_at);
            const restore = document.createElement('button');
            restore.type = 'button';
            restore.className = 'restore-note-btn';
            restore.dataset.restoreId = String(note.id);
            restore.textContent = this.restoringIds.has(note.id) ? 'Restoring…' : 'Restore';
            restore.disabled = this.restoringIds.has(note.id);
            restore.setAttribute('aria-label', 'Restore ' + title.textContent);
            actions.append(date, restore);
            item.append(title, preview, actions);
            fragment.append(item);
        }
        list.append(fragment);
    }

    async restoreDeletedNote(noteId) {
        if (this.restoringIds.has(noteId)) return;
        const hadFocus = this.ui.notesList.contains(document.activeElement);
        try {
            await this.requestRestore(noteId);
            this.dismissUndoToast(noteId);
            this.showToast('Note restored.');
            if (hadFocus) {
                (this.ui.notesList.querySelector('[data-restore-id]') || this.ui.deletedNotesToggle).focus();
            }
        } catch (error) {
            this.showToast('Could not restore note. Check your connection and try Restore again.', 'error');
        }
    }

    async requestRestore(noteId) {
        if (this.restoringIds.has(noteId)) throw new Error('Restoration is already in progress.');
        this.restoringIds.add(noteId);
        this.renderNotesList();
        try {
            const response = await fetch('/api/notes/' + noteId + '/restore', { method: 'POST' });
            if (!response.ok) throw new Error('Unable to restore note.');
            const restoredNote = await response.json();
            if (restoredNote.id !== noteId) throw new Error('Unexpected note response.');
            await this.initialLoad;
            this.notes = [restoredNote, ...this.notes.filter((note) => note.id !== noteId)]
                .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
            this.deletedNotes = this.deletedNotes.filter((note) => note.id !== noteId);
            this.loadError = false;
            return restoredNote;
        } finally {
            this.restoringIds.delete(noteId);
            this.renderNotesList();
        }
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
            } else if (this.hasUnsavedChanges() && !(await this.showConfirmDialog({
                title: 'Discard this note?',
                description: 'Your unsaved title and content will be lost. This cannot be undone.',
                confirmLabel: 'Discard note'
            }))) {
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
                if (!response.ok) {
                    if (response.status === 404 && noteId) {
                        throw new Error('This note may have been deleted in another tab. Restore it from Deleted notes, then retry Save. Your changes are still here.');
                    }
                    throw new Error('Unable to save note. Your changes are still here.');
                }

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
                this.showMessage(error.message, 'error');
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
        const noteId = this.currentNote.id;
        let noteTitle = this.currentNote.title || 'Untitled';
        let deletedAt = Date.now();
        let description = 'This note will be removed from your notes. You can undo this action shortly after deleting.';
        try {
            const status = await fetch('/api/notes/deleted/status');
            if (!status.ok) throw new Error('Unable to check deleted notes.');
            const retention = await status.json();
            if (retention.will_evict) {
                description += ' An older deleted note may be permanently removed after its recovery window.';
            }
        } catch (error) {
            description += ' Only the 10 newest deleted notes are retained after recovery windows end.';
        }
        if (!this.currentNote || this.currentNote.id !== noteId) return;
        const deleted = await this.showConfirmDialog({
            title: 'Delete this note?',
            description,
            confirmLabel: 'Delete note',
            busyLabel: 'Saving and deleting…',
            errorMessage: 'Unable to delete note. Please try again.',
            onConfirm: async () => {
                clearTimeout(this.saveTimer);
                this.navigationInProgress = true;
                this.setEditingDisabled(true);
                try {
                    if (this.savePromise && !(await this.savePromise)) {
                        throw new Error('Unable to save changes. Note was not deleted. Your draft is still here.');
                    }
                    if (this.hasUnsavedChanges() && !(await this.saveNote(true))) {
                        throw new Error('Unable to save changes. Note was not deleted. Your draft is still here.');
                    }
                    noteTitle = this.currentNote.title || 'Untitled';
                    const response = await fetch('/api/notes/' + noteId, { method: 'DELETE' });
                    if (!response.ok) throw new Error('Unable to delete note.');
                    const serverTime = Date.parse(response.headers.get('X-Deleted-At') || '');
                    deletedAt = Number.isFinite(serverTime) ? serverTime : Date.now();
                    this.notes = this.notes.filter((note) => note.id !== noteId);
                    this.hideEditor();
                } finally {
                    this.setEditingDisabled(false);
                    this.navigationInProgress = false;
                }
            }
        });
        if (deleted) this.showUndoToast(noteId, noteTitle, Date.now() + 6000, deletedAt + 60000);
    }

    showConfirmDialog({ title, description, confirmLabel, busyLabel = 'Working…',
                        errorMessage, onConfirm }) {
        const dialog = this.ui.confirmDialog;
        if (dialog.open) return Promise.resolve(false);

        const previousFocus = document.activeElement;
        this.ui.confirmDialogTitle.textContent = title;
        this.ui.confirmDialogDescription.textContent = description;
        this.ui.confirmActionBtn.textContent = confirmLabel;
        this.ui.confirmDialogError.hidden = true;
        this.ui.confirmDialogError.textContent = '';
        dialog.returnValue = '';

        return new Promise((resolve) => {
            let busy = false;
            const cancel = () => dialog.close('cancel');
            const handleEscape = (event) => {
                if (busy) event.preventDefault();
            };
            const keepFocusInside = (event) => {
                if (event.key !== 'Tab') return;
                if (busy) {
                    event.preventDefault();
                    dialog.focus();
                } else if (event.shiftKey && document.activeElement === this.ui.confirmCancelBtn) {
                    event.preventDefault();
                    this.ui.confirmActionBtn.focus();
                } else if (!event.shiftKey && document.activeElement === this.ui.confirmActionBtn) {
                    event.preventDefault();
                    this.ui.confirmCancelBtn.focus();
                }
            };
            const confirm = async () => {
                if (busy) return;
                busy = true;
                dialog.setAttribute('aria-busy', 'true');
                this.ui.confirmCancelBtn.disabled = true;
                this.ui.confirmActionBtn.disabled = true;
                dialog.focus();
                this.ui.confirmActionBtn.textContent = busyLabel;
                this.ui.confirmDialogError.hidden = true;
                try {
                    if (onConfirm) await onConfirm();
                    dialog.close('confirm');
                } catch (error) {
                    this.ui.confirmDialogError.textContent = error.message || errorMessage ||
                        'Unable to continue. Please try again.';
                    this.ui.confirmDialogError.hidden = false;
                    busy = false;
                    dialog.removeAttribute('aria-busy');
                    this.ui.confirmCancelBtn.disabled = false;
                    this.ui.confirmActionBtn.disabled = false;
                    this.ui.confirmActionBtn.textContent = confirmLabel;
                    this.ui.confirmActionBtn.focus();
                }
            };
            const finish = () => {
                this.ui.confirmCancelBtn.removeEventListener('click', cancel);
                this.ui.confirmActionBtn.removeEventListener('click', confirm);
                dialog.removeEventListener('cancel', handleEscape);
                dialog.removeEventListener('keydown', keepFocusInside);
                dialog.removeEventListener('close', finish);
                dialog.removeAttribute('aria-busy');
                this.ui.confirmCancelBtn.disabled = false;
                this.ui.confirmActionBtn.disabled = false;
                if (previousFocus && previousFocus.isConnected &&
                    !previousFocus.disabled && !previousFocus.closest('[hidden]')) {
                    previousFocus.focus();
                } else {
                    this.ui.newNoteBtn.focus();
                }
                resolve(dialog.returnValue === 'confirm');
            };

            this.ui.confirmCancelBtn.addEventListener('click', cancel);
            this.ui.confirmActionBtn.addEventListener('click', confirm);
            dialog.addEventListener('cancel', handleEscape);
            dialog.addEventListener('keydown', keepFocusInside);
            dialog.addEventListener('close', finish);
            dialog.showModal();
            this.ui.confirmCancelBtn.focus();
        });
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = type === 'error' ? 'toast toast-error' : 'toast';
        toast.textContent = message;
        this.ui.toastRegion.append(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    persistUndoToasts() {
        try {
            sessionStorage.setItem('noteUndoToasts', JSON.stringify(
                [...this.undoToasts.values()].map(({ id, title, expiresAt, recoveryUntil, failed }) =>
                    ({ id, title, expiresAt, recoveryUntil, failed }))
            ));
        } catch (error) {
            // Undo still works in the current page if browser storage is unavailable.
        }
    }

    restoreUndoToasts() {
        try {
            const stored = JSON.parse(sessionStorage.getItem('noteUndoToasts') || '[]');
            if (Array.isArray(stored)) {
                for (const item of stored) {
                    if (Number.isInteger(item.id) && item.id > 0 &&
                        Number.isFinite(item.expiresAt) && item.expiresAt > Date.now()) {
                        this.showUndoToast(item.id, item.title, item.expiresAt,
                            Number.isFinite(item.recoveryUntil) ? item.recoveryUntil : item.expiresAt + 54000,
                            Boolean(item.failed));
                    }
                }
            }
        } catch (error) {
            // Invalid or unavailable browser storage should not stop the app.
        }
        this.persistUndoToasts();
    }

    showUndoToast(noteId, title = 'Untitled', expiresAt = Date.now() + 6000,
                  recoveryUntil = Date.now() + 60000, failed = false) {
        this.dismissUndoToast(noteId);
        const toast = document.createElement('div');
        toast.className = 'toast toast-undo';
        const copy = document.createElement('div');
        copy.className = 'toast-copy';
        const message = document.createElement('span');
        message.textContent = failed ? 'Could not restore note. Check your connection and retry.' : 'Note deleted';
        const detail = document.createElement('span');
        detail.className = 'toast-detail';
        detail.textContent = typeof title === 'string' ? title : 'Untitled';
        copy.append(message, detail);
        const action = document.createElement('button');
        action.className = 'toast-action';
        action.type = 'button';
        action.textContent = failed ? 'Retry Undo' : 'Undo';
        action.setAttribute('aria-label', (failed ? 'Retry restoring ' : 'Undo deletion of ') +
            detail.textContent);
        action.addEventListener('click', () => this.undoDelete(noteId));
        toast.append(copy, action);
        this.ui.toastRegion.append(toast);

        if (failed) toast.classList.add('toast-error');
        const entry = { id: noteId, title: detail.textContent, expiresAt, recoveryUntil,
            failed, toast, message, action, pending: false };
        entry.timer = setTimeout(() => this.dismissUndoToast(noteId),
            Math.max(0, expiresAt - Date.now()));
        this.undoToasts.set(noteId, entry);
        this.persistUndoToasts();
    }

    dismissUndoToast(noteId) {
        const entry = this.undoToasts.get(noteId);
        if (!entry || entry.pending) return;
        const focusWasInside = entry.toast.contains(document.activeElement) ||
            (entry.restoreHadFocus && document.activeElement === document.body);
        clearTimeout(entry.timer);
        entry.toast.remove();
        this.undoToasts.delete(noteId);
        this.persistUndoToasts();
        if (focusWasInside) {
            const restoredNote = this.ui.notesList.querySelector('[data-note-id="' + noteId + '"]');
            (restoredNote || this.ui.newNoteBtn).focus();
        }
    }

    async undoDelete(noteId) {
        const entry = this.undoToasts.get(noteId);
        if (!entry || entry.pending || this.restoringIds.has(noteId)) return;
        entry.restoreHadFocus = document.activeElement === entry.action;
        entry.pending = true;
        clearTimeout(entry.timer);
        entry.message.textContent = 'Restoring note…';
        entry.action.textContent = 'Restoring…';
        entry.action.disabled = true;

        try {
            await this.requestRestore(noteId);
            entry.pending = false;
            this.dismissUndoToast(noteId);
            this.showToast('Note restored.');
        } catch (error) {
            entry.pending = false;
            if (Date.now() >= entry.recoveryUntil) {
                this.dismissUndoToast(noteId);
                this.showToast('Undo window ended. Open Deleted notes to restore.', 'error');
                return;
            }
            entry.expiresAt = Math.min(Date.now() + 10000, entry.recoveryUntil);
            entry.failed = true;
            entry.toast.classList.add('toast-error');
            entry.message.textContent = 'Could not restore note. Check your connection and retry.';
            entry.action.textContent = 'Retry Undo';
            entry.action.disabled = false;
            entry.action.setAttribute('aria-label', 'Retry restoring ' + entry.title);
            entry.timer = setTimeout(() => this.dismissUndoToast(noteId),
                Math.max(0, entry.expiresAt - Date.now()));
            this.persistUndoToasts();
            if (entry.restoreHadFocus && document.activeElement === document.body) {
                entry.action.focus();
            }
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
