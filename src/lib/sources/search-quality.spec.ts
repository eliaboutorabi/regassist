/**
 * Search-quality regressions.
 *
 * These pin the behaviour that matters most: asking for a subject in an
 * accountant's words has to surface the provision that actually governs it,
 * near the top. They hit the live eCFR, so they run only with `LIVE=1`.
 *
 *   LIVE=1 npx vitest run --project server src/lib/sources/search-quality.spec.ts
 */

import { describe, expect, it } from 'vitest';
import { searchRegulations } from './ecfr.js';

const live = process.env.LIVE === '1';

/** [query, title, the citation a reviewer would expect near the top] */
const PROBES: [string, number, string][] = [
	['substantiation requirements travel', 26, '26 CFR § 1.274-5'],
	['compensation for personal services', 26, '26 CFR § 1.162-7'],
	['amounts paid to improve tangible property', 26, '26 CFR § 1.263(a)-3'],
	['charitable contributions', 26, '26 CFR § 1.170A-6'],
	['auditor independence', 17, '17 CFR § 240.10A-2'],
	['reports of foreign financial accounts', 31, '31 CFR § 1010.350'],
	['employee benefit plan', 29, '29 CFR § 2510.3-3']
];

describe.skipIf(!live)('regulation search quality', () => {
	it.each(PROBES)('“%s” surfaces %s', async (query, title, expected) => {
		const { hits } = await searchRegulations({ query, title, limit: 4 });
		expect(hits.map((hit) => hit.citation)).toContain(expected);
	}, 60_000);

	it('returns hits with a citation, heading and working eCFR url', async () => {
		const { hits } = await searchRegulations({ query: 'charitable contributions', title: 26 });
		expect(hits.length).toBeGreaterThan(0);
		for (const hit of hits) {
			expect(hit.citation).toMatch(/^\d+ CFR/);
			expect(hit.heading.length).toBeGreaterThan(2);
			expect(hit.url).toMatch(/^https:\/\/www\.ecfr\.gov\/current\/title-\d+/);
		}
	}, 60_000);

	it('never returns the same section twice', async () => {
		const { hits } = await searchRegulations({ query: 'substantiation', title: 26, limit: 12 });
		const citations = hits.map((hit) => hit.citation);
		expect(new Set(citations).size).toBe(citations.length);
	}, 60_000);
});
