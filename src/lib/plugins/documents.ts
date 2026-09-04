/**
 * The document service.
 *
 * A pasted engagement letter or a client memo is too big to travel as a tool
 * argument — the model would have to re-emit the whole thing to ask a question
 * about it, and in voice mode it would try to *say* it. So the document lives
 * here, in a per-request service, and tools reference it by id.
 */

import type { Context, Disposer } from '$lib/harness';

export interface StoredDocument {
	id: string;
	name: string;
	text: string;
	/** Where the text came from, for the citation line under a finding. */
	kind: 'paste' | 'file';
}

export const MAX_DOCUMENT_CHARS = 120_000;

export class DocumentStore {
	readonly #documents = new Map<string, StoredDocument>();

	constructor(private readonly ctx: Context) {}

	put(document: StoredDocument): Disposer {
		const trimmed: StoredDocument = {
			...document,
			text: document.text.slice(0, MAX_DOCUMENT_CHARS)
		};
		return this.ctx.effect(() => {
			this.#documents.set(trimmed.id, trimmed);
			return () => this.#documents.delete(trimmed.id);
		});
	}

	get(id: string): StoredDocument | undefined {
		return this.#documents.get(id);
	}

	/**
	 * Resolve a document the way a model refers to one.
	 *
	 * By id, by name, or by part of a name — and when exactly one document is
	 * loaded, by anything at all. A model asked to review "the loaded document"
	 * will sometimes pass the string "loaded", and refusing that when there is
	 * only one candidate is pedantry that costs the user their answer: the
	 * review failed, so the markup had no text to quote from, so nothing was
	 * marked. One document is unambiguous whatever it gets called.
	 */
	resolve(reference?: string): StoredDocument | undefined {
		const all = [...this.#documents.values()];
		if (!all.length) return undefined;
		if (!reference) return all.length === 1 ? all[0] : undefined;

		const direct = this.#documents.get(reference);
		if (direct) return direct;

		const lowered = reference.trim().toLowerCase();
		const byName =
			all.find((document) => document.name.toLowerCase() === lowered) ??
			all.find((document) => document.name.toLowerCase().includes(lowered)) ??
			all.find((document) => lowered.includes(document.name.toLowerCase()));
		if (byName) return byName;

		return all.length === 1 ? all[0] : undefined;
	}

	list(): { id: string; name: string; characters: number }[] {
		return [...this.#documents.values()].map((document) => ({
			id: document.id,
			name: document.name,
			characters: document.text.length
		}));
	}

	get size(): number {
		return this.#documents.size;
	}
}

/** Provides `ctx.documents`. */
export const documentsPlugin = {
	name: 'documents',
	apply(ctx: Context) {
		ctx.provide('documents', new DocumentStore(ctx));
	}
};
