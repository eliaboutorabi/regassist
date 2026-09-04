/**
 * Document review tools.
 *
 * `review_document` never decides anything. It finds the passages a reviewer
 * would stop at, names the concern, and hands back the lookup that settles it —
 * so the assistant's next move is to go read the actual regulation rather than
 * to improvise one.
 */

import { defineTool, type Context, type ToolRegistry } from '$lib/harness';
import { REVIEW_RULES, scanDocument, type Severity } from './review-rules.js';
import type { DocumentStore } from './documents.js';

const SEVERITY_ORDER: Severity[] = ['high', 'medium', 'low', 'info'];

export const reviewPlugin = {
	name: 'document-review',
	inject: ['tools', 'documents'] as const,

	apply(ctx: Context) {
		const tools = ctx.require<ToolRegistry>('tools');
		const documents = ctx.require<DocumentStore>('documents');

		tools.register(
			defineTool({
				name: 'list_documents',
				label: 'Checking loaded documents',
				description:
					'List the documents the user has loaded into this session, with their ids. Call it when you are unsure whether a document is available or which one the user means.',
				parameters: {},
				output: {
					schema: {
						type: 'object',
						additionalProperties: false,
						properties: {
							documents: {
								type: 'array',
								required: true,
								items: {
									type: 'object',
									additionalProperties: false,
									properties: {
										id: { type: 'string', required: true },
										name: { type: 'string', required: true },
										characters: { type: 'integer', required: true }
									}
								}
							}
						}
					},
					render: (_args, value) =>
						value.documents.length
							? [
									{
										type: 'text',
										text: value.documents
											.map((doc) => `• ${doc.name} (id: ${doc.id}, ${doc.characters} characters)`)
											.join('\n')
									}
								]
							: [
									{
										type: 'text',
										text: 'No document is loaded. Ask the user to paste text or drop a file into the document panel.'
									}
								]
				},
				execute: () => ({ documents: documents.list() })
			})
		);

		tools.register(
			defineTool({
				name: 'review_document',
				label: 'Reviewing the document',
				description: [
					'Scan a loaded document for passages that carry a federal regulatory exposure, and return each one with the concern and the lookup that would settle it.',
					'Call this first whenever the user asks you to look at, check, or review something they have loaded.',
					'The findings are leads, not conclusions: follow the strongest ones into search_regulations and read_regulation before you tell the user what the rule requires.'
				].join(' '),
				parameters: {
					document: {
						type: 'string',
						description:
							'Document id or name. Omit when exactly one document is loaded and you mean that one.'
					},
					minSeverity: {
						type: 'string',
						enum: SEVERITY_ORDER,
						description: 'Drop findings below this severity. Defaults to returning everything.'
					}
				},
				output: {
					schema: {
						type: 'object',
						additionalProperties: false,
						properties: {
							documentName: { type: 'string', required: true },
							summary: { type: 'string', required: true },
							findings: {
								type: 'array',
								required: true,
								items: {
									type: 'object',
									additionalProperties: false,
									properties: {
										severity: { type: 'string', enum: SEVERITY_ORDER, required: true },
										topic: { type: 'string', required: true },
										quote: { type: 'string', required: true },
										concern: { type: 'string', required: true },
										lookup: { type: 'string', required: true },
										title: { type: 'integer' }
									}
								}
							}
						}
					},
					render: (_args, value) => {
						if (!value.findings.length) {
							return [
								{
									type: 'text',
									text: `Reviewed "${value.documentName}". No passage matched a known federal regulatory trigger. That is not a clean bill of health — say so plainly, and offer to look at a specific concern the user has in mind.`
								}
							];
						}
						const lines = value.findings.map(
							(finding) =>
								[
									`[${finding.severity.toUpperCase()}] ${finding.topic}`,
									`  Passage: "${finding.quote}"`,
									`  Concern: ${finding.concern}`,
									`  Next: search_regulations({ query: "${finding.lookup}"${finding.title ? `, title: ${finding.title}` : ''} })`
								].join('\n')
						);
						return [
							{
								type: 'text',
								text: [
									`Reviewed "${value.documentName}". ${value.summary}`,
									'',
									...lines,
									'',
									'Now verify the most significant findings against the actual regulation before summarising for the user. Do not present these as conclusions.'
								].join('\n')
							}
						];
					}
				},
				presentCall: (args) => ({
					card: 'review',
					title: 'Reviewing',
					documentName: args.document ?? 'the loaded document'
				}),
				presentResult: (_args, value) => ({
					card: 'review',
					title: 'Review findings',
					documentName: value.documentName,
					findings: value.findings,
					summary: value.summary
				}),
				execute(args) {
					const document = documents.resolve(args.document);
					if (!document) {
						const loaded = documents.list();
						throw new Error(
							loaded.length
								? `No document matches "${args.document ?? ''}". Loaded documents: ${loaded.map((doc) => doc.name).join(', ')}.`
								: 'No document is loaded. Ask the user to paste text or drop a file into the document panel first.'
						);
					}

					const floor = SEVERITY_ORDER.indexOf(args.minSeverity ?? 'info');
					const findings = scanDocument(document.text, REVIEW_RULES)
						.filter((match) => SEVERITY_ORDER.indexOf(match.rule.severity) <= floor)
						.map((match) => ({
							severity: match.rule.severity,
							topic: match.rule.topic,
							quote: match.quote,
							concern: match.rule.concern,
							lookup: match.rule.lookup,
							title: match.rule.title
						}));

					const counts = findings.reduce<Record<string, number>>((totals, finding) => {
						totals[finding.severity] = (totals[finding.severity] ?? 0) + 1;
						return totals;
					}, {});
					const summary = findings.length
						? `${findings.length} passage(s) flagged: ${SEVERITY_ORDER.filter((severity) => counts[severity])
								.map((severity) => `${counts[severity]} ${severity}`)
								.join(', ')}.`
						: 'Nothing matched the review pack.';

					return { documentName: document.name, summary, findings };
				}
			})
		);
	}
};
