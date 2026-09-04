/**
 * Harness assembly.
 *
 * Everything above is a plugin; this is the only file that knows the full set.
 * Mount order is bottom-up because dependencies are declared, not sequenced:
 * services first, then the plugins that inject them.
 */

import {
	agentPlugin,
	Context,
	llmPlugin,
	openaiPlugin,
	toolsPlugin,
	type ToolRegistry
} from '$lib/harness';
import { documentsPlugin, type DocumentStore, type StoredDocument } from './documents.js';
import { ecfrPlugin } from './ecfr.js';
import { federalRegisterPlugin } from './federal-register.js';
import { reviewPlugin } from './review.js';

export interface HarnessOptions {
	/** Documents to load into the session before the first turn. */
	documents?: StoredDocument[];
}

/**
 * Boot a fully-wired harness. Callers own the returned context and must
 * `dispose()` it — every registration unwinds with it.
 */
export async function createHarness(options: HarnessOptions = {}): Promise<Context> {
	const ctx = new Context();

	await ctx.use(
		toolsPlugin,
		llmPlugin,
		documentsPlugin,
		openaiPlugin,
		agentPlugin,
		ecfrPlugin,
		federalRegisterPlugin,
		reviewPlugin
	);

	const documents = ctx.require<DocumentStore>('documents');
	for (const document of options.documents ?? []) documents.put(document);

	return ctx;
}

/** The tool schemas, for handing to a realtime session at mint time. */
export async function toolSchemas() {
	const ctx = await createHarness();
	try {
		return ctx.require<ToolRegistry>('tools').schemas();
	} finally {
		ctx.dispose();
	}
}

export { MAX_DOCUMENT_CHARS, type DocumentStore, type StoredDocument } from './documents.js';
export { REVIEW_RULES, scanDocument, type ReviewRule, type Severity } from './review-rules.js';
