/**
 * The check Verity runs on herself before she stops talking.
 *
 * Everything here is mechanical: it compares the answer against what the turn
 * actually did, and nothing else. That is deliberate. Asking a model whether
 * it is confident produces confident answers; asking whether the citation it
 * just used appears anywhere in the tools it just called produces a fact.
 *
 * It listens on `agent/turn-stopping`, so an objection reopens the turn and
 * the model gets one step to put it right — the user sees the corrected
 * answer, not the draft plus an apology.
 */

import type { Context, ToolResult, TurnStopping } from '$lib/harness';

/** `26 CFR § 1.274-12`, `17 CFR 210.2-01`, and the ways models write them. */
const CITATION = /\b(\d{1,2})\s*CFR\s*(?:§+\s*)?(\d[\w.()\-]*)/gi;

export function citationsIn(text: string): string[] {
	const found = new Set<string>();
	for (const match of text.matchAll(CITATION)) {
		found.add(`${match[1]} CFR § ${match[2].replace(/[.,;:]+$/, '')}`);
	}
	return [...found];
}

/**
 * The section a citation belongs to, dropping any paragraph suffix.
 *
 * `26 CFR § 1.274-5(c)(2)(iii)` is a paragraph of `26 CFR § 1.274-5`. Pointing
 * at the paragraph you relied on is good practice, not invention, so the check
 * compares sections — otherwise every properly precise answer gets flagged for
 * citing something it plainly did read.
 */
export function sectionOf(citation: string): string {
	return citation.replace(/\s*\(.*$/, '').trim();
}

/** Every citation the turn's tools actually returned. */
function citationsSeen(record: readonly ToolResult[]): Set<string> {
	const seen = new Set<string>();
	for (const result of record) {
		for (const citation of citationsIn(result.content.map((block) => block.text).join('\n'))) {
			seen.add(sectionOf(citation));
		}
	}
	return seen;
}

/**
 * Which sections the turn actually opened, as opposed to merely listed.
 *
 * Reads the canonical value where there is one, and falls back to the call's
 * own arguments where there is not — the voice client assembles its record
 * from what crossed the wire, which carries the arguments but not the twelve
 * thousand characters of section text.
 */
function citationsRead(record: readonly ToolResult[]): Set<string> {
	const read = new Set<string>();
	for (const result of record) {
		if (result.name !== 'read_regulation' || result.isError) continue;

		const value = result.value as { section?: { citation?: string } } | null;
		if (value?.section?.citation) {
			read.add(sectionOf(value.section.citation));
			continue;
		}

		const { title, section } = result.arguments as { title?: unknown; section?: unknown };
		if (typeof title === 'number' && typeof section === 'string') {
			read.add(sectionOf(`${title} CFR § ${section}`));
		}
	}
	return read;
}

function called(record: readonly ToolResult[], name: string): ToolResult[] {
	return record.filter((result) => result.name === name && !result.isError);
}

/**
 * Claims that name an action, and the tool that would have had to run.
 *
 * This is the check that catches the failure that started all this: a turn
 * that researched thoroughly, never called the markup tool, and then said
 * "here are the passages marked up on the document".
 */
const CLAIMS: { pattern: RegExp; tool: string; instruction: string }[] = [
	{
		pattern: /\b(marked|highlighted|flagged)\b[^.]{0,60}\b(page|document|memo|pdf)\b/i,
		tool: 'highlight_document',
		instruction:
			'You said the document is marked up, but you never called highlight_document, so there are no marks. Either call it now with exact quotes from the document, or drop the claim.'
	},
	{
		pattern: /\bI (?:have )?(?:read|pulled|opened|reviewed)\b[^.]{0,40}\b(section|regulation)\b/i,
		tool: 'read_regulation',
		instruction:
			'You said you read the section, but read_regulation was never called this turn. Either read it now or say you are going on the search excerpt.'
	},
	{
		pattern: /\b(checked|searched|looked at)\b[^.]{0,40}\bfederal register\b/i,
		tool: 'find_rule_changes',
		instruction:
			'You referred to checking the Federal Register, but find_rule_changes was never called this turn. Either check it now or drop the claim.'
	},
	{
		pattern: /\bI (?:have )?reviewed\b[^.]{0,40}\b(document|memo|letter|engagement)\b/i,
		tool: 'review_document',
		instruction:
			'You said you reviewed the document, but review_document was never called this turn. Run it, or say plainly that you read the text without running the review.'
	}
];

/** Language that turns a citation into a statement about what the law requires. */
const ASSERTS =
	/\b(requires?|must|shall|provides? that|states? that|says? that|allows?|permits?|prohibits?|disallows?|limits?|mandates?)\b/i;

export interface Objection {
	instruction: string;
	reason: string;
}

/** The whole check, as a pure function so it can be tested without a model. */
export function auditTurn(draft: string, record: readonly ToolResult[]): Objection[] {
	const objections: Objection[] = [];

	// A turn that did the work and then said nothing. Rare, but it shows as a
	// blank bubble under a stack of cards, which reads as the app being broken.
	if (!draft.trim()) {
		if (record.some((result) => !result.isError)) {
			objections.push({
				reason: 'ran the lookups but did not answer',
				instruction:
					'You made the lookups and then said nothing. Give the answer now, in prose, using what those lookups returned.'
			});
		}
		return objections;
	}

	const cited = citationsIn(draft);
	const seen = citationsSeen(record);
	const read = citationsRead(record);
	const madeLookups = record.some((result) => !result.isError);

	// 1. A citation nobody looked up.
	const invented = cited.filter((citation) => !seen.has(sectionOf(citation)));
	if (invented.length && madeLookups) {
		objections.push({
			reason: `cited ${invented.join(', ')} without looking ${invented.length === 1 ? 'it' : 'them'} up`,
			instruction: `You cited ${invented.join(', ')}, and no tool call this turn returned ${invented.length === 1 ? 'that citation' : 'those citations'}. Look ${invented.length === 1 ? 'it' : 'them'} up now and correct the citation if it is wrong, or remove it. Never cite from memory.`
		});
	}

	// 2. Describing what a section requires, from a search excerpt.
	if (ASSERTS.test(draft)) {
		const unread = [
			...new Set(
				cited
					.map(sectionOf)
					.filter((section) => seen.has(section) && !read.has(section))
			)
		];
		if (unread.length) {
			objections.push({
				reason: `described what ${unread[0]} requires without reading it`,
				instruction: `You describe what ${unread.join(' and ')} require, but you only saw ${unread.length === 1 ? 'it' : 'them'} in search results — a search excerpt is not the operative text. Call read_regulation on ${unread.length === 1 ? 'it' : 'each'}, then say what it actually provides.`
			});
		}
	}

	// 3. An action claimed but never taken.
	for (const claim of CLAIMS) {
		if (!claim.pattern.test(draft)) continue;
		const ran = called(record, claim.tool);
		if (ran.length) {
			// highlight_document can succeed and still mark nothing.
			if (claim.tool !== 'highlight_document') continue;
			const marks = ran.reduce(
				(total, result) => total + ((result.value as { marks?: unknown[] })?.marks?.length ?? 0),
				0
			);
			if (marks > 0) continue;
		}
		objections.push({
			reason: `claimed to have used ${claim.tool.replace(/_/g, ' ')} without doing it`,
			instruction: claim.instruction
		});
	}

	// 4. A failed lookup the answer does not own up to.
	const failed = record.filter((result) => result.isError);
	if (failed.length && !/\b(could not|couldn'?t|unable|failed|did not return|rate.?limit)\b/i.test(draft)) {
		const names = [...new Set(failed.map((result) => result.name.replace(/_/g, ' ')))];
		objections.push({
			reason: `${failed.length} lookup${failed.length === 1 ? '' : 's'} failed and the answer does not say so`,
			instruction: `${failed.length} tool call${failed.length === 1 ? '' : 's'} failed this turn (${names.join(', ')}) and your answer does not mention it. Say in one sentence which part you could not verify, or retry the lookup.`
		});
	}

	return objections;
}

/**
 * The same audit, phrased for someone talking.
 *
 * A listener is not looking at a badge, so a correction has to be said. The
 * instruction is written to produce a sentence a person would actually say —
 * "actually, let me correct that" — rather than a paragraph of contrition, and
 * to keep the machinery out of it: nobody wants to hear that a checker fired.
 *
 * Returns null when there is nothing to correct, which is the normal case.
 */
export function spokenCorrection(
	spoken: string,
	record: readonly ToolResult[]
): { instruction: string; reasons: string[] } | null {
	// Nothing was looked up, so there is nothing to check the words against.
	if (!record.length) return null;

	const objections = auditTurn(spoken, record);
	if (!objections.length) return null;

	return {
		reasons: objections.map((objection) => objection.reason),
		instruction: [
			'[System check — the caller did not say this and cannot see it.]',
			'',
			'What you just said does not match what you actually looked up:',
			...objections.map((objection) => `- ${objection.instruction}`),
			'',
			'Correct yourself out loud now, in one or two sentences. Start naturally — "actually, let me correct that" — say what the right position is, and stop. Do not mention being checked, do not apologise at length, and do not repeat the whole answer. If putting it right needs a lookup you have not done, do it first.'
		].join('\n')
	};
}

export const verifyPlugin = {
	name: 'verify-claims',

	apply(ctx: Context) {
		return ctx.on('agent/turn-stopping', (stopping: TurnStopping) => {
			for (const objection of auditTurn(stopping.draft, stopping.record)) {
				stopping.steer(objection.instruction, objection.reason);
			}
		});
	}
};
