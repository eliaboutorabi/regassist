/**
 * Every review rule promises the assistant a lookup that settles its finding.
 * If a lookup returns nothing, the model is sent chasing an empty search at
 * exactly the moment it is trying to verify a flagged passage.
 *
 *   LIVE=1 npx vitest run --project server src/lib/plugins/rule-lookups.spec.ts
 */

import { describe, expect, it } from 'vitest';
import { REVIEW_RULES } from './review-rules.js';
import { searchRegulations } from '$lib/sources/ecfr.js';

const live = process.env.LIVE === '1';
const scoped = REVIEW_RULES.filter((rule) => rule.title !== undefined);

describe.skipIf(!live)('review rule lookups', () => {
	it.each(scoped.map((rule) => [rule.id, rule.lookup, rule.title!] as const))(
		'%s finds sections for "%s"',
		async (_id, lookup, title) => {
			const { hits } = await searchRegulations({ query: lookup, title, limit: 3 });
			expect(hits.length).toBeGreaterThan(0);
			expect(hits[0].citation).toMatch(new RegExp(`^${title} CFR`));
		},
		60_000
	);

	/** The lookups where a specific provision is the whole point of the rule. */
	it.each([
		['worker-classification', '26 CFR § 31.3121(d)-1'],
		['reasonable-compensation', '26 CFR § 1.162-7'],
		['travel-substantiation', '26 CFR § 1.274-5'],
		['capitalize-vs-repair', '26 CFR § 1.263(a)-3'],
		['transfer-pricing', '26 CFR § 1.482-1'],
		['foreign-accounts', '31 CFR § 1010.350'],
		['digital-assets', '26 CFR § 1.6045-1'],
		['auditor-independence', '17 CFR § 210.2-01'],
		['privileged-advice', '31 CFR § 10.37']
	])('%s lands on %s', async (id, expected) => {
		const rule = REVIEW_RULES.find((candidate) => candidate.id === id)!;
		const { hits } = await searchRegulations({ query: rule.lookup, title: rule.title, limit: 3 });
		expect(hits.map((hit) => hit.citation)).toContain(expected);
	}, 60_000);
});
