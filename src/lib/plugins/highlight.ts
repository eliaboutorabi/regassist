/**
 * Pointing at the page.
 *
 * Quoting a passage back in the transcript is fine as far as it goes, but the
 * question an accountant actually asks is "where in my document?" — and the
 * answer is a place, not a sentence. This tool lets Verity name passages; the
 * browser matches each one to the block OCR found it in and draws it on the
 * page it came from.
 *
 * The tool deliberately does no matching itself. Geometry lives in the tab
 * that holds the file, and the file never reaches the server.
 */

import { defineTool, type Context, type ToolRegistry } from '$lib/harness';
import type { DocumentStore } from './documents.js';

const SEVERITIES = ['high', 'medium', 'low', 'info'] as const;

export const highlightPlugin = {
	name: 'document-highlight',
	inject: ['tools', 'documents'] as const,

	apply(ctx: Context) {
		const documents = ctx.require<DocumentStore>('documents');

		ctx.require<ToolRegistry>('tools').register(
			defineTool({
				name: 'highlight_document',
				label: 'Marking up the document',
				description: [
					'Mark passages on the page of a loaded document so the user can see exactly where you mean.',
					'Quote each passage word for word from the document — the quote is what locates it on the page, and an approximation will not be found.',
					'Use this after review_document when the user asks where something is, or when a finding is easier to see than to describe. Two to five marks is a useful number; twenty is a wall of colour.'
				].join(' '),
				parameters: {
					document: {
						type: 'string',
						description:
							'Document id or name. Omit when exactly one document is loaded and you mean that one.'
					},
					marks: {
						type: 'array',
						required: true,
						description: 'The passages to mark, in the order the reader should see them.',
						items: {
							type: 'object',
							additionalProperties: false,
							properties: {
								quote: {
									type: 'string',
									required: true,
									description: 'The passage, copied exactly from the document.'
								},
								note: {
									type: 'string',
									required: true,
									description: 'A short label for the mark — a few words, not a paragraph.'
								},
								severity: {
									type: 'string',
									enum: SEVERITIES,
									description: 'How much it matters. Defaults to info.'
								}
							}
						}
					}
				},
				output: {
					schema: {
						type: 'object',
						additionalProperties: false,
						properties: {
							documentId: { type: 'string', required: true },
							documentName: { type: 'string', required: true },
							marks: {
								type: 'array',
								required: true,
								items: {
									type: 'object',
									additionalProperties: false,
									properties: {
										quote: { type: 'string', required: true },
										note: { type: 'string', required: true },
										severity: { type: 'string', enum: SEVERITIES, required: true }
									}
								}
							},
							missing: {
								type: 'array',
								required: true,
								items: { type: 'string' },
								description: 'Quotes that do not appear in the document text.'
							}
						}
					},
					render: (_args, value) => {
						const lines = value.marks.map((mark) => `• ${mark.note} — “${mark.quote}”`);
						const notes = [
							value.marks.length
								? `Marked ${value.marks.length} passage(s) on "${value.documentName}". The user can see them on the page.`
								: `Nothing was marked on "${value.documentName}".`,
							...lines
						];
						if (value.missing.length) {
							notes.push(
								'',
								`These quotes are not in the document, so they were dropped: ${value.missing
									.map((quote) => `“${quote}”`)
									.join(', ')}. Quote the document exactly.`
							);
						}
						return [{ type: 'text', text: notes.join('\n') }];
					}
				},
				presentCall: (args) => ({
					card: 'review',
					title: 'Marking up',
					documentName: args.document ?? 'the loaded document'
				}),
				presentResult: (_args, value) => ({
					card: 'highlight',
					title: 'On the page',
					documentId: value.documentId,
					documentName: value.documentName,
					marks: value.marks
				}),
				execute(args) {
					const document = documents.resolve(args.document);
					if (!document) {
						const loaded = documents.list();
						throw new Error(
							loaded.length
								? `No document matches "${args.document ?? ''}". Loaded: ${loaded.map((doc) => doc.name).join(', ')}.`
								: 'No document is loaded, so there is nothing to mark up.'
						);
					}

					// A quote the document does not contain cannot be placed, and
					// silently dropping it teaches the model nothing. Checking here
					// means the model is told to quote properly on the same turn.
					const haystack = normalise(document.text);
					const marks: { quote: string; note: string; severity: (typeof SEVERITIES)[number] }[] =
						[];
					const missing: string[] = [];

					for (const mark of args.marks) {
						const quote = mark.quote.trim();
						if (!quote) continue;
						if (haystack.includes(normalise(quote))) {
							marks.push({
								quote,
								note: mark.note.trim().slice(0, 120),
								severity: mark.severity ?? 'info'
							});
						} else {
							missing.push(quote.slice(0, 80));
						}
					}

					return {
						documentId: document.id,
						documentName: document.name,
						marks,
						missing
					};
				}
			})
		);
	}
};

/** Loose enough to survive the whitespace and punctuation a model re-types. */
function normalise(text: string): string {
	return text
		.toLowerCase()
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/\s+/g, ' ')
		.trim();
}
