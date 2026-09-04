/**
 * Documents loaded into the session. They live only in the browser tab; each
 * turn ships them with the request and the server drops them when the turn
 * ends, so nothing a user pastes is retained anywhere.
 */

import { MAX_DOCUMENT_CHARS, type StoredDocument } from '$lib/plugins';

let counter = 0;

class DocumentState {
	items = $state<StoredDocument[]>([]);

	readonly total = $derived(this.items.length);
	readonly characters = $derived(this.items.reduce((sum, item) => sum + item.text.length, 0));

	add(name: string, text: string, kind: StoredDocument['kind'] = 'paste'): StoredDocument | null {
		const trimmed = text.trim();
		if (!trimmed) return null;
		const document: StoredDocument = {
			id: `doc${(counter += 1)}`,
			name: name.trim().slice(0, 120) || `Document ${counter}`,
			text: trimmed.slice(0, MAX_DOCUMENT_CHARS),
			kind
		};
		this.items.push(document);
		return document;
	}

	remove(id: string): void {
		this.items = this.items.filter((item) => item.id !== id);
	}

	clear(): void {
		this.items = [];
	}

	/** The payload shape the API routes expect. */
	payload(): StoredDocument[] {
		return this.items.map((item) => ({ ...item }));
	}
}

export const documents = new DocumentState();
