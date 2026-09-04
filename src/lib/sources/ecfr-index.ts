/**
 * A section-heading index over the CFR titles this app covers.
 *
 * The eCFR's own full-text search ranks by term frequency across whole section
 * bodies, which for a conceptual question is close to useless — "home office
 * exclusive use" returns building-and-loan associations, because those sections
 * happen to say "home", "loan" and "use" a great many times.
 *
 * A section's *heading* is the precise signal: "Substantiation requirements",
 * "Charitable contributions by individuals". Every title's structure is one
 * small JSON document (a few hundred kilobytes for tens of thousands of
 * sections), so we index the headings and match against those first, falling
 * back to full text for anything headings cannot reach.
 */

import { fetchJson } from './http.js';
import { RELEVANT_TITLES } from './ecfr-titles.js';

const SOURCE = 'the eCFR';
const BASE = 'https://www.ecfr.gov/api';

export interface IndexedSection {
	title: number;
	/** Section number as it appears in a citation, e.g. "1.274-5". */
	identifier: string;
	heading: string;
	/** Breadcrumb of the enclosing chapter, subchapter and part headings. */
	context: string;
}

interface StructureNode {
	type?: string;
	identifier?: string;
	label_description?: string;
	label?: string;
	reserved?: boolean;
	children?: StructureNode[];
}

interface TitleIssue {
	titles?: { number: number; up_to_date_as_of: string | null }[];
}

/**
 * Structure documents change at most daily, and an index rebuild costs a
 * parse of tens of thousands of nodes, so both the document and the flattened
 * index are held for the life of the process.
 */
const indexes = new Map<number, IndexedSection[]>();

async function issueDateFor(title: number, signal?: AbortSignal): Promise<string> {
	const payload = await fetchJson<TitleIssue>(`${BASE}/versioner/v1/titles.json`, {
		source: SOURCE,
		signal,
		ttlMs: 6 * 60 * 60_000
	});
	const entry = payload.titles?.find((candidate) => candidate.number === title);
	if (!entry?.up_to_date_as_of) throw new Error(`No current issue date for title ${title}.`);
	return entry.up_to_date_as_of;
}

/** Flatten one title's structure into (section, heading, breadcrumb) triples. */
export async function sectionIndex(
	title: number,
	signal?: AbortSignal
): Promise<IndexedSection[]> {
	const cached = indexes.get(title);
	if (cached) return cached;

	const date = await issueDateFor(title, signal);
	const structure = await fetchJson<StructureNode>(
		`${BASE}/versioner/v1/structure/${date}/title-${title}.json`,
		{ source: SOURCE, signal, ttlMs: 12 * 60 * 60_000, timeoutMs: 25_000 }
	);

	const sections: IndexedSection[] = [];
	const CONTEXT_TYPES = new Set(['chapter', 'subchapter', 'part', 'subject_group']);

	const walk = (node: StructureNode, trail: string[]) => {
		const label = node.label_description ?? node.label ?? '';

		if (node.type === 'section' && node.identifier && !node.reserved && label) {
			sections.push({
				title,
				identifier: node.identifier,
				heading: label,
				context: trail.join(' › ')
			});
			return;
		}

		const nextTrail =
			node.type && CONTEXT_TYPES.has(node.type) && label ? [...trail, label] : trail;
		for (const child of node.children ?? []) walk(child, nextTrail);
	};

	walk(structure, []);
	indexes.set(title, sections);
	return sections;
}

// ------------------------------------------------------------------ matching

/**
 * Words carrying no discriminating power in a corpus of regulation headings.
 * "Tax" and "requirements" are dropped for the same reason "the" is: nearly
 * every heading in Title 26 could match them.
 */
const STOPWORDS = new Set([
	'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from', 'how',
	'i', 'in', 'is', 'it', 'my', 'of', 'on', 'or', 'that', 'the', 'to', 'under', 'what', 'when',
	'which', 'with', 'cfr', 'irs', 'regulation', 'regulations', 'rule', 'rules', 'section',
	'tax', 'taxes'
]);

export function tokenize(query: string): string[] {
	return query
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, ' ')
		.split(/\s+/)
		.filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/** Crude but effective stemming for the plural/possessive pairs that dominate. */
function variants(token: string): string[] {
	const forms = [token];
	if (token.endsWith('ies')) forms.push(`${token.slice(0, -3)}y`);
	else if (token.endsWith('es')) forms.push(token.slice(0, -2));
	if (token.endsWith('s')) forms.push(token.slice(0, -1));
	else forms.push(`${token}s`);
	return forms;
}

function scoreHeading(heading: string, context: string, tokens: string[], phrase: string): number {
	const lowerHeading = heading.toLowerCase();
	const lowerContext = context.toLowerCase();
	let score = 0;
	let matched = 0;

	if (phrase.length > 6 && lowerHeading.includes(phrase)) score += 40;

	for (const token of tokens) {
		const forms = variants(token);
		if (forms.some((form) => new RegExp(`\\b${form}\\b`).test(lowerHeading))) {
			score += 12;
			matched += 1;
		} else if (forms.some((form) => lowerHeading.includes(form))) {
			score += 6;
			matched += 1;
		} else if (forms.some((form) => new RegExp(`\\b${form}\\b`).test(lowerContext))) {
			// A part heading match is weak evidence, but it is evidence.
			score += 2;
		}
	}

	if (!matched) return 0;
	// Every query term present is far stronger than most of them.
	if (matched === tokens.length) score += 25;
	// Prefer the tighter of two headings that match equally.
	score -= Math.min(lowerHeading.length / 40, 6);
	return score;
}

export interface HeadingSearchOptions {
	query: string;
	titles?: number[];
	limit?: number;
	signal?: AbortSignal;
}

/** Sections whose heading matches the query, best first. */
export async function searchHeadings(
	options: HeadingSearchOptions
): Promise<IndexedSection[]> {
	const tokens = tokenize(options.query);
	if (!tokens.length) return [];

	const titles = options.titles ?? RELEVANT_TITLES.map((title) => title.number);
	const phrase = options.query.toLowerCase().trim();

	// One title failing must not lose the matches from the others.
	const loaded = await Promise.all(
		titles.map((title) =>
			sectionIndex(title, options.signal).catch(() => [] as IndexedSection[])
		)
	);

	const scored: { section: IndexedSection; score: number }[] = [];
	for (const sections of loaded) {
		for (const section of sections) {
			const score = scoreHeading(section.heading, section.context, tokens, phrase);
			if (score > 0) scored.push({ section, score });
		}
	}

	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, options.limit ?? 8).map((entry) => entry.section);
}
