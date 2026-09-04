/**
 * Electronic Code of Federal Regulations (ecfr.gov).
 *
 * Free, no key, no rate-limit registration. It carries the current consolidated
 * text of every CFR title, which is the actual body of tax and financial
 * regulation an accountant would cite: 26 CFR for the Treasury regulations,
 * 17 CFR for securities, 12 CFR for banking, 29 CFR for benefits and ERISA.
 */

import type { RegulationCitation } from '$lib/harness';
import { decodeEntities, fetchJson, fetchText, stripHighlights, SourceError } from './http.js';

const SOURCE = 'the eCFR';
const BASE = 'https://www.ecfr.gov/api';

/** The titles that carry tax, financial and reporting regulation. */
export const RELEVANT_TITLES = [
	{ number: 12, name: 'Banks and Banking', blurb: 'Bank capital, lending, and Federal Reserve rules' },
	{ number: 17, name: 'Commodity and Securities Exchanges', blurb: 'SEC and CFTC rules, including Regulation S-X accounting' },
	{ number: 26, name: 'Internal Revenue', blurb: 'The Treasury regulations under the Internal Revenue Code' },
	{ number: 29, name: 'Labor', blurb: 'ERISA, employee benefit plans, and wage rules' },
	{ number: 31, name: 'Money and Finance: Treasury', blurb: 'Treasury, FinCEN, and anti-money-laundering rules' },
	{ number: 48, name: 'Federal Acquisition Regulations', blurb: 'Government contract cost accounting standards' }
] as const;

export type RelevantTitle = (typeof RELEVANT_TITLES)[number]['number'];

const TITLE_NAMES = new Map<number, string>(
	RELEVANT_TITLES.map((title) => [title.number, title.name])
);

interface SearchHierarchy {
	title: string | null;
	subtitle: string | null;
	chapter: string | null;
	subchapter: string | null;
	part: string | null;
	subpart: string | null;
	subject_group: string | null;
	section: string | null;
	appendix: string | null;
}

interface SearchResult {
	type: string;
	hierarchy: SearchHierarchy;
	hierarchy_headings: Partial<SearchHierarchy>;
	headings: Partial<SearchHierarchy>;
	full_text_excerpt?: string;
	score?: number;
	reserved?: boolean;
	removed?: boolean;
}

interface SearchResponse {
	results?: SearchResult[];
	meta?: { total_count?: number };
}

/** Build the citation a professional would actually write. */
function citationFor(hierarchy: SearchHierarchy): string {
	const title = hierarchy.title ?? '?';
	if (hierarchy.section) return `${title} CFR § ${hierarchy.section}`;
	if (hierarchy.appendix) return `${title} CFR part ${hierarchy.part}, appendix ${hierarchy.appendix}`;
	if (hierarchy.part) return `${title} CFR part ${hierarchy.part}`;
	return `${title} CFR`;
}

function urlFor(hierarchy: SearchHierarchy): string {
	const title = hierarchy.title ?? '';
	if (hierarchy.section) return `https://www.ecfr.gov/current/title-${title}/section-${hierarchy.section}`;
	if (hierarchy.part) return `https://www.ecfr.gov/current/title-${title}/part-${hierarchy.part}`;
	return `https://www.ecfr.gov/current/title-${title}`;
}

/** A breadcrumb an accountant can orient by, skipping empty rungs. */
function hierarchyLabel(result: SearchResult): string {
	const headings = result.headings ?? {};
	const parts = [
		result.hierarchy.title ? `Title ${result.hierarchy.title}` : null,
		headings.chapter ?? null,
		headings.subchapter ?? null,
		headings.subject_group ?? null
	].filter((part): part is string => Boolean(part));
	return parts.join(' › ');
}

export interface SearchOptions {
	query: string;
	title?: number;
	limit?: number;
	signal?: AbortSignal;
}

export interface SearchOutcome {
	hits: RegulationCitation[];
	totalCount: number;
}

export async function searchRegulations(options: SearchOptions): Promise<SearchOutcome> {
	const limit = Math.min(Math.max(options.limit ?? 6, 1), 20);
	const params = new URLSearchParams({
		query: options.query,
		per_page: String(limit),
		order: 'relevance',
		paginate_by: 'results'
	});
	if (options.title) params.set('hierarchy[title]', String(options.title));

	const payload = await fetchJson<SearchResponse>(
		`${BASE}/search/v1/results?${params}`,
		{ source: SOURCE, signal: options.signal, ttlMs: 15 * 60_000 }
	);

	const hits = (payload.results ?? [])
		.filter((result) => !result.removed)
		.map((result) => {
			const heading =
				stripHighlights(result.headings?.section ?? '') ||
				stripHighlights(result.headings?.part ?? '') ||
				'Untitled provision';
			return {
				citation: citationFor(result.hierarchy),
				heading,
				hierarchy: hierarchyLabel(result),
				url: urlFor(result.hierarchy),
				excerpt: result.full_text_excerpt ? stripHighlights(result.full_text_excerpt) : undefined,
				titleName: result.hierarchy.title
					? TITLE_NAMES.get(Number(result.hierarchy.title)) ??
						stripHighlights(result.headings?.title ?? '')
					: undefined
			} satisfies RegulationCitation;
		});

	return { hits, totalCount: payload.meta?.total_count ?? hits.length };
}

// ------------------------------------------------------------ section text

interface TitlesResponse {
	titles?: { number: number; name: string; up_to_date_as_of: string | null; reserved?: boolean }[];
}

/** The eCFR versioner needs a date; ask it which one each title is current to. */
async function currentDateFor(title: number, signal?: AbortSignal): Promise<string> {
	const payload = await fetchJson<TitlesResponse>(`${BASE}/versioner/v1/titles.json`, {
		source: SOURCE,
		signal,
		ttlMs: 6 * 60 * 60_000
	});
	const entry = payload.titles?.find((candidate) => candidate.number === title);
	if (!entry?.up_to_date_as_of) {
		throw new SourceError(`The eCFR has no current issue date for title ${title}.`, SOURCE);
	}
	return entry.up_to_date_as_of;
}

/**
 * Flatten the eCFR's XML into readable prose.
 *
 * The versioner returns GPO-flavoured XML (`DIV8`, `HEAD`, `P`, `I`, `CITA`).
 * A tag-aware flattening keeps paragraph boundaries and drops presentation,
 * which is all a language model or a receipt printer needs.
 */
export function xmlToText(xml: string): string {
	return decodeEntities(
		xml
			// Structural boundaries become blank lines before tags are erased.
			.replace(/<\/(HEAD|P|FP|HED|SECTNO|SUBJECT|CITA|EXTRACT|NOTE)>/gi, '\n\n')
			.replace(/<(BR|br)\s*\/?>/g, '\n')
			.replace(/<[^>]+>/g, '')
	)
		.split('\n')
		.map((line) => line.replace(/[ \t]+/g, ' ').trim())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export interface SectionRequest {
	title: number;
	section: string;
	signal?: AbortSignal;
}

export interface SectionText {
	citation: RegulationCitation;
	body: string;
	truncated: boolean;
}

const MAX_SECTION_CHARS = 12_000;

export async function readSection(request: SectionRequest): Promise<SectionText> {
	const section = request.section.replace(/^§\s*/, '').trim();
	// A section number's leading component is its part: 1.162-1 lives in part 1,
	// 240.10b-5 in part 240. The versioner needs both to scope the extraction.
	const part = section.split('.')[0];
	if (!part) throw new SourceError(`"${request.section}" is not a section number.`, SOURCE);

	const date = await currentDateFor(request.title, request.signal);
	const params = new URLSearchParams({ part, section });
	const xml = await fetchText(
		`${BASE}/versioner/v1/full/${date}/title-${request.title}.xml?${params}`,
		{ source: SOURCE, signal: request.signal, ttlMs: 60 * 60_000, accept: 'application/xml' }
	);

	const text = xmlToText(xml);
	if (!text) {
		throw new SourceError(
			`The eCFR has no text for ${request.title} CFR § ${section}. Check the section number.`,
			SOURCE
		);
	}

	const [heading, ...rest] = text.split('\n\n');
	const body = rest.join('\n\n').trim() || text;
	const truncated = body.length > MAX_SECTION_CHARS;

	return {
		citation: {
			citation: `${request.title} CFR § ${section}`,
			heading: heading.replace(/^§\s*[\d.\-A-Za-z]+\s*/, '').trim() || `§ ${section}`,
			hierarchy: `Title ${request.title} › Part ${part}`,
			url: `https://www.ecfr.gov/current/title-${request.title}/section-${section}`,
			titleName: TITLE_NAMES.get(request.title)
		},
		body: truncated ? `${body.slice(0, MAX_SECTION_CHARS)}\n\n[…section truncated…]` : body,
		truncated
	};
}
