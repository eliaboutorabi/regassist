/**
 * What Verity has read of a document, and what she is pointing at.
 *
 * OCR is not run on upload. It costs a call to a second provider and most
 * questions never need it, so it happens when someone opens the viewer or
 * when Verity asks to point at something — and only for documents that came
 * from a real file.
 */

import { locateQuote, type BlockMatch, type OcrPageView } from '$lib/ocr-match';
import { documents } from './documents.svelte';
import { session } from './session.svelte';

export type ReadStatus = 'idle' | 'reading' | 'ready' | 'error';

export interface Highlight {
	id: string;
	documentId: string;
	quote: string;
	/** Why it is highlighted — shown on the marker. */
	note: string;
	severity: 'high' | 'medium' | 'low' | 'info';
}

interface DocumentRead {
	status: ReadStatus;
	pages: OcrPageView[];
	error: string | null;
}

let counter = 0;

class PagesState {
	reads = $state<Record<string, DocumentRead>>({});
	highlights = $state<Highlight[]>([]);
	/** The highlight the viewer should scroll to, and a nonce so a repeat click still moves. */
	focus = $state<{ id: string; nonce: number } | null>(null);

	status(documentId: string): ReadStatus {
		return this.reads[documentId]?.status ?? 'idle';
	}

	pages(documentId: string): OcrPageView[] {
		return this.reads[documentId]?.pages ?? [];
	}

	error(documentId: string): string | null {
		return this.reads[documentId]?.error ?? null;
	}

	forDocument(documentId: string): Highlight[] {
		return this.highlights.filter((highlight) => highlight.documentId === documentId);
	}

	/**
	 * Run OCR over a document, once.
	 *
	 * Returns true when geometry is available afterwards, so a caller that
	 * needs boxes can tell the difference between "read it" and "cannot".
	 */
	async read(documentId: string): Promise<boolean> {
		const existing = this.reads[documentId];
		if (existing?.status === 'ready') return true;
		if (existing?.status === 'reading') return false;

		const document = documents.get(documentId);
		if (!document?.file) return false;
		if (!session.canOcr) {
			this.reads = {
				...this.reads,
				[documentId]: {
					status: 'error',
					pages: [],
					error: 'Add a Mistral key in settings to read the page itself.'
				}
			};
			return false;
		}

		this.reads = { ...this.reads, [documentId]: { status: 'reading', pages: [], error: null } };

		try {
			const body = new FormData();
			body.append('file', document.file);
			const response = await fetch('/api/ocr', {
				method: 'POST',
				headers: { 'x-mistral-key': session.mistralKey },
				body
			});

			const payload = (await response.json().catch(() => null)) as
				| { pages?: OcrPageView[]; message?: string }
				| null;

			if (!response.ok || !payload?.pages) {
				throw new Error(payload?.message ?? `The document could not be read (${response.status}).`);
			}

			this.reads = {
				...this.reads,
				[documentId]: { status: 'ready', pages: payload.pages, error: null }
			};
			return true;
		} catch (cause) {
			this.reads = {
				...this.reads,
				[documentId]: {
					status: 'error',
					pages: [],
					error: cause instanceof Error ? cause.message : 'That document could not be read.'
				}
			};
			return false;
		}
	}

	/** Point at a passage. Replaces any existing highlight of the same quote. */
	add(
		documentId: string,
		quote: string,
		note: string,
		severity: Highlight['severity'] = 'info'
	): Highlight {
		const trimmed = quote.trim();
		const existing = this.highlights.find(
			(highlight) => highlight.documentId === documentId && highlight.quote === trimmed
		);
		if (existing) {
			existing.note = note;
			existing.severity = severity;
			return existing;
		}

		const highlight: Highlight = {
			id: `hl${(counter += 1)}`,
			documentId,
			quote: trimmed,
			note,
			severity
		};
		this.highlights.push(highlight);
		return highlight;
	}

	/** Where a highlight lands on the page, or nothing when it cannot be placed. */
	locate(highlight: Highlight): BlockMatch[] {
		return locateQuote(highlight.quote, this.pages(highlight.documentId));
	}

	reveal(id: string): void {
		this.focus = { id, nonce: (this.focus?.nonce ?? 0) + 1 };
	}

	clear(): void {
		this.reads = {};
		this.highlights = [];
		this.focus = null;
	}
}

export const pages = new PagesState();
