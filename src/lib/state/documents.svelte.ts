/**
 * Documents loaded into the session.
 *
 * They live only in this browser tab. Each turn ships the extracted text with
 * the request and the server drops it when the turn ends, so nothing anyone
 * pastes is retained. The original `File` is kept in memory alongside the text
 * because the viewer renders the real pages, and OCR needs the bytes.
 */

import { MAX_DOCUMENT_CHARS, type StoredDocument } from '$lib/plugins';

export interface LoadedDocument extends StoredDocument {
	/** The original file, when it came from one. Never leaves the browser. */
	file?: File;
	/** Object URL for the viewer; created lazily and revoked on removal. */
	objectUrl?: string;
	mimeType?: string;
}

let counter = 0;

class DocumentState {
	items = $state<LoadedDocument[]>([]);

	readonly total = $derived(this.items.length);
	readonly characters = $derived(this.items.reduce((sum, item) => sum + item.text.length, 0));

	add(
		name: string,
		text: string,
		kind: StoredDocument['kind'] = 'paste',
		file?: File
	): LoadedDocument | null {
		const trimmed = text.trim();
		if (!trimmed) return null;

		const document: LoadedDocument = {
			id: `doc${(counter += 1)}`,
			name: name.trim().slice(0, 120) || `Document ${counter}`,
			text: trimmed.slice(0, MAX_DOCUMENT_CHARS),
			kind,
			file,
			mimeType: file?.type || undefined
		};
		this.items.push(document);
		return document;
	}

	get(id: string): LoadedDocument | undefined {
		return this.items.find((item) => item.id === id);
	}

	/** A URL the viewer can render the original file from. */
	sourceUrl(id: string): string | null {
		const document = this.get(id);
		if (!document?.file) return null;
		document.objectUrl ??= URL.createObjectURL(document.file);
		return document.objectUrl;
	}

	remove(id: string): void {
		const document = this.get(id);
		if (document?.objectUrl) URL.revokeObjectURL(document.objectUrl);
		this.items = this.items.filter((item) => item.id !== id);
	}

	clear(): void {
		for (const item of this.items) {
			if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
		}
		this.items = [];
	}

	/** The payload shape the API routes expect — text only, never the bytes. */
	payload(): StoredDocument[] {
		return this.items.map(({ id, name, text, kind }) => ({ id, name, text, kind }));
	}
}

export const documents = new DocumentState();
