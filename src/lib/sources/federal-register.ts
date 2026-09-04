/**
 * Federal Register (federalregister.gov).
 *
 * Free, no key. Where the eCFR says what the rule *is* today, this says what is
 * *changing*: proposed rules, final rules, effective dates and comment
 * deadlines. For an accountant that is often the more urgent half of the
 * question — "is the treatment I used last year still the treatment?"
 */

import type { RuleChange } from '$lib/harness';
import { fetchJson } from './http.js';

const SOURCE = 'the Federal Register';
const BASE = 'https://www.federalregister.gov/api/v1';

/** Agencies whose rule-making an accountant tracks. */
export const AGENCIES = {
	irs: { slug: 'internal-revenue-service', name: 'Internal Revenue Service' },
	treasury: { slug: 'treasury-department', name: 'Treasury Department' },
	sec: { slug: 'securities-and-exchange-commission', name: 'Securities and Exchange Commission' },
	labor: { slug: 'labor-department', name: 'Labor Department' },
	fed: { slug: 'federal-reserve-system', name: 'Federal Reserve System' },
	fasab: { slug: 'federal-accounting-standards-advisory-board', name: 'Federal Accounting Standards Advisory Board' }
} as const;

export type AgencyKey = keyof typeof AGENCIES;

export const DOCUMENT_TYPES = {
	rule: 'RULE',
	'proposed-rule': 'PRORULE',
	notice: 'NOTICE'
} as const;

export type DocumentTypeKey = keyof typeof DOCUMENT_TYPES;

const TYPE_LABELS: Record<string, string> = {
	Rule: 'Final rule',
	'Proposed Rule': 'Proposed rule',
	Notice: 'Notice',
	'Presidential Document': 'Presidential document'
};

interface FederalRegisterDocument {
	title: string;
	type: string;
	document_number: string;
	publication_date: string;
	effective_on: string | null;
	html_url: string;
	abstract: string | null;
	agencies?: { name?: string; raw_name?: string }[];
	cfr_references?: { title?: number; part?: string }[];
}

interface DocumentsResponse {
	count?: number;
	results?: FederalRegisterDocument[];
}

export interface RuleChangeOptions {
	query: string;
	agency?: AgencyKey;
	documentType?: DocumentTypeKey;
	/** Only return documents published on or after this ISO date. */
	since?: string;
	limit?: number;
	signal?: AbortSignal;
}

export interface RuleChangeOutcome {
	changes: RuleChange[];
	totalCount: number;
}

export async function searchRuleChanges(options: RuleChangeOptions): Promise<RuleChangeOutcome> {
	const limit = Math.min(Math.max(options.limit ?? 6, 1), 20);
	const params = new URLSearchParams({
		per_page: String(limit),
		order: 'newest',
		'conditions[term]': options.query
	});

	for (const field of [
		'title',
		'type',
		'document_number',
		'publication_date',
		'effective_on',
		'html_url',
		'abstract',
		'agencies',
		'cfr_references'
	]) {
		params.append('fields[]', field);
	}

	if (options.agency) params.append('conditions[agencies][]', AGENCIES[options.agency].slug);
	if (options.documentType) {
		params.append('conditions[type][]', DOCUMENT_TYPES[options.documentType]);
	}
	if (options.since) params.set('conditions[publication_date][gte]', options.since);

	const payload = await fetchJson<DocumentsResponse>(`${BASE}/documents.json?${params}`, {
		source: SOURCE,
		signal: options.signal,
		ttlMs: 30 * 60_000
	});

	const changes = (payload.results ?? []).map((document) => {
		// Sub-agencies come first in the array; the most specific name is the
		// useful one ("Internal Revenue Service", not "Treasury Department").
		const agency =
			document.agencies?.at(-1)?.name ?? document.agencies?.[0]?.name ?? 'Unattributed agency';
		return {
			title: document.title,
			type: TYPE_LABELS[document.type] ?? document.type,
			agency,
			publishedOn: document.publication_date,
			effectiveOn: document.effective_on ?? undefined,
			url: document.html_url,
			abstract: document.abstract?.trim() || undefined,
			cfrReferences: document.cfr_references
				?.filter((reference) => reference.title && reference.part)
				.map((reference) => `${reference.title} CFR part ${reference.part}`)
		} satisfies RuleChange;
	});

	return { changes, totalCount: payload.count ?? changes.length };
}
