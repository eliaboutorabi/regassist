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
import { loopGuardPlugin } from './loop-guard.js';
import { reviewPlugin } from './review.js';

/** The tool-owning plugins a caller can mount. */
export type PackId = 'ecfr' | 'federal-register' | 'review';

export interface HarnessOptions {
	/** Documents to load into the session before the first turn. */
	documents?: StoredDocument[];
	/**
	 * Which tool packs to mount. Omitted means all of them.
	 *
	 * Switching a skill off in settings withholds the tools it owns rather than
	 * merely asking the model not to use them — an instruction the model is
	 * free to weigh against everything else in the prompt.
	 */
	packs?: readonly PackId[];
}

/**
 * Boot a fully-wired harness. Callers own the returned context and must
 * `dispose()` it — every registration unwinds with it.
 */
export async function createHarness(options: HarnessOptions = {}): Promise<Context> {
	const ctx = new Context();

	await ctx.use(toolsPlugin, llmPlugin, documentsPlugin, openaiPlugin, agentPlugin);

	const packs = new Set<PackId>(options.packs ?? ['ecfr', 'federal-register', 'review']);
	// The CFR is the whole point; a caller cannot leave the app with no way to
	// look anything up.
	packs.add('ecfr');

	if (packs.has('ecfr')) await ctx.plugin(ecfrPlugin);
	if (packs.has('federal-register')) await ctx.plugin(federalRegisterPlugin);
	if (packs.has('review')) await ctx.plugin(reviewPlugin);

	await ctx.plugin(loopGuardPlugin);

	const documents = ctx.require<DocumentStore>('documents');
	for (const document of options.documents ?? []) documents.put(document);

	return ctx;
}

/** The tool schemas, for handing to a realtime session at mint time. */
export async function toolSchemas(packs?: readonly PackId[]) {
	const ctx = await createHarness({ packs });
	try {
		return ctx.require<ToolRegistry>('tools').schemas();
	} finally {
		ctx.dispose();
	}
}

export { MAX_DOCUMENT_CHARS, type DocumentStore, type StoredDocument } from './documents.js';
export { REVIEW_RULES, scanDocument, type ReviewRule, type Severity } from './review-rules.js';
