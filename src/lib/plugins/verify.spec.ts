import { describe, expect, it } from 'vitest';
import type { ToolResult } from '$lib/harness';
import { auditTurn, citationsIn, spokenCorrection } from './verify.js';

const result = (over: Partial<ToolResult> & { name: string }): ToolResult => ({
	callId: 'c1',
	arguments: {},
	value: null,
	content: [{ type: 'text', text: '' }],
	isError: false,
	durationMs: 10,
	...over
});

const searched = (text: string) =>
	result({ name: 'search_regulations', content: [{ type: 'text', text }] });

const read = (citation: string, body = 'the operative text') =>
	result({
		name: 'read_regulation',
		content: [{ type: 'text', text: `${citation} — ${body}` }],
		value: { section: { citation }, body, truncated: false }
	});

describe('citationsIn', () => {
	it('finds the shapes a model actually writes', () => {
		expect(citationsIn('see 26 CFR § 1.274-12 and 17 CFR 210.2-01.')).toEqual([
			'26 CFR § 1.274-12',
			'17 CFR § 210.2-01'
		]);
	});

	it('does not mistake a statute for a regulation', () => {
		expect(citationsIn('the test is in 26 U.S.C. § 280A(c)(1)')).toEqual([]);
	});

	it('drops trailing punctuation from a citation', () => {
		expect(citationsIn('under 26 CFR § 1.162-1.')).toEqual(['26 CFR § 1.162-1']);
	});
});

describe('auditTurn', () => {
	it('passes an answer grounded in what the turn read', () => {
		const record = [searched('26 CFR § 1.274-5 Substantiation requirements.'), read('26 CFR § 1.274-5')];
		const draft = 'Under 26 CFR § 1.274-5 you must substantiate amount, time, place and purpose.';
		expect(auditTurn(draft, record)).toEqual([]);
	});

	it('objects to a citation no tool returned', () => {
		const record = [searched('26 CFR § 1.274-5 Substantiation requirements.'), read('26 CFR § 1.274-5')];
		const draft = 'See 26 CFR § 1.999-9, which sets the limit.';
		const [objection] = auditTurn(draft, record);
		expect(objection.reason).toMatch(/without looking/);
		expect(objection.instruction).toContain('26 CFR § 1.999-9');
	});

	it('says nothing about citations when the turn made no lookups at all', () => {
		// Answering from earlier in the conversation is not the same as inventing.
		expect(auditTurn('As I said, 26 CFR § 1.162-1 is the general rule.', [])).toEqual([]);
	});

	it('objects to describing a requirement from a search excerpt', () => {
		const record = [searched('26 CFR § 1.162-17 Reporting and substantiation.')];
		const draft = '26 CFR § 1.162-17 requires employees to substantiate their expenses.';
		const [objection] = auditTurn(draft, record);
		expect(objection.reason).toMatch(/without reading it/);
	});

	it('accepts a requirement once the section was actually read', () => {
		const record = [searched('26 CFR § 1.162-17 Reporting.'), read('26 CFR § 1.162-17')];
		const draft = '26 CFR § 1.162-17 requires employees to substantiate their expenses.';
		expect(auditTurn(draft, record)).toEqual([]);
	});

	it('accepts merely listing sections without describing what they require', () => {
		const record = [searched('26 CFR § 1.162-17 Reporting and substantiation.')];
		const draft = 'Two sections look relevant: 26 CFR § 1.162-17 and 26 CFR § 1.274-5.';
		expect(auditTurn(draft, record).filter((o) => /without reading/.test(o.reason))).toEqual([]);
	});

	it('catches a claim to have marked up a document that was never marked', () => {
		const draft = 'Here are the worst passages marked up on the document page.';
		const [objection] = auditTurn(draft, [searched('anything')]);
		expect(objection.reason).toMatch(/highlight document/);
	});

	it('catches markup that ran but marked nothing', () => {
		const record = [
			result({ name: 'highlight_document', value: { marks: [], missing: ['x'] } })
		];
		const draft = 'I have highlighted the problem passages on the page.';
		expect(auditTurn(draft, record).some((o) => /highlight/.test(o.reason))).toBe(true);
	});

	it('accepts markup that actually marked something', () => {
		const record = [
			result({ name: 'highlight_document', value: { marks: [{ quote: 'a', note: 'b' }] } })
		];
		const draft = 'I have highlighted the problem passages on the page.';
		expect(auditTurn(draft, record)).toEqual([]);
	});

	it('catches a claim to have checked the Federal Register', () => {
		const draft = 'I checked the Federal Register and nothing has changed.';
		const [objection] = auditTurn(draft, [searched('x')]);
		expect(objection.reason).toMatch(/find rule changes/);
	});

	it('objects when a failed lookup goes unmentioned', () => {
		const record = [result({ name: 'read_regulation', isError: true })];
		const [objection] = auditTurn('The rule is straightforward.', record);
		expect(objection.reason).toMatch(/failed/);
	});

	it('accepts a failure the answer owns up to', () => {
		const record = [result({ name: 'read_regulation', isError: true })];
		const draft = 'I could not read that section — the eCFR rate-limited the request.';
		expect(auditTurn(draft, record)).toEqual([]);
	});

	it('objects to an empty draft when the turn did work', () => {
		// Superseded by the "answer that never arrives" case below: a blank
		// bubble under a stack of cards reads as the app being broken.
		const [objection] = auditTurn('   ', [searched('x')]);
		expect(objection.reason).toMatch(/did not answer/);
	});
});

describe('paragraph citations', () => {
	const record = [
		searched('26 CFR § 1.274-5 Substantiation requirements.'),
		read('26 CFR § 1.274-5')
	];

	it('accepts a paragraph of a section that was read', () => {
		const draft =
			'Under 26 CFR § 1.274-5(c)(2)(iii)(A) you must keep documentary evidence, and § 1.274-5(g) allows an allowance method.';
		expect(auditTurn(draft, record)).toEqual([]);
	});

	it('still objects to a paragraph of a section nobody looked at', () => {
		const draft = 'See 26 CFR § 1.999-9(a)(2), which requires a written election.';
		const [objection] = auditTurn(draft, record);
		expect(objection.instruction).toContain('1.999-9');
	});

	it('does not ask for the same section to be read twice', () => {
		const onlySearched = [searched('26 CFR § 1.162-17 Reporting and substantiation.')];
		const draft =
			'26 CFR § 1.162-17(a) requires substantiation, and § 1.162-17(b)(2) requires records.';
		const unread = auditTurn(draft, onlySearched).filter((o) => /without reading/.test(o.reason));
		expect(unread).toHaveLength(1);
		expect(unread[0].instruction).toContain('26 CFR § 1.162-17');
	});
});

describe('an answer that never arrives', () => {
	it('objects when the turn looked things up and then said nothing', () => {
		const [objection] = auditTurn('', [searched('26 CFR § 1.162-1 Business expenses.')]);
		expect(objection.reason).toMatch(/did not answer/);
	});

	it('says nothing when there was no work to report either', () => {
		expect(auditTurn('', [])).toEqual([]);
	});
})

describe('a record assembled from the wire', () => {
	// What the voice client can see: names, arguments, and the rendered text.
	const wireRead = (title: number, section: string) =>
		result({
			name: 'read_regulation',
			arguments: { title, section },
			value: null,
			content: [{ type: 'text', text: `${title} CFR § ${section} — the operative text` }]
		});

	it('counts a section as read from the arguments alone', () => {
		const record = [wireRead(26, '1.274-5')];
		const draft = '26 CFR § 1.274-5 requires adequate records.';
		expect(auditTurn(draft, record)).toEqual([]);
	});

	it('still objects to a section that was only searched', () => {
		const record = [searched('26 CFR § 1.162-17 Reporting.')];
		const draft = '26 CFR § 1.162-17 requires substantiation.';
		expect(auditTurn(draft, record).some((o) => /without reading/.test(o.reason))).toBe(true);
	});
})

describe('spokenCorrection', () => {
	it('says nothing when the turn looked nothing up', () => {
		expect(spokenCorrection('Anything at all.', [])).toBeNull();
	});

	it('says nothing about an answer its lookups support', () => {
		const record = [searched('26 CFR § 1.274-5 Substantiation requirements.'), read('26 CFR § 1.274-5')];
		expect(
			spokenCorrection('Under twenty-six CFR one point two seven four dash five, keep records.', record)
		).toBeNull();
	});

	it('asks her to correct herself when she went past her lookups', () => {
		const record = [searched('26 CFR § 1.170A-17 Qualified appraisal and qualified appraiser.')];
		const correction = spokenCorrection(
			'26 CFR § 1.170A-17 requires a qualified appraisal from a qualified appraiser.',
			record
		)!;
		expect(correction).not.toBeNull();
		expect(correction.reasons[0]).toMatch(/without reading it/);
	});

	it('tells her to speak the correction, not describe the check', () => {
		const record = [searched('26 CFR § 1.170A-17 Qualified appraisal.')];
		const correction = spokenCorrection('26 CFR § 1.170A-17 requires an appraisal.', record)!;
		expect(correction.instruction).toMatch(/Correct yourself out loud/);
		expect(correction.instruction).toMatch(/Do not mention being checked/);
		expect(correction.instruction).toMatch(/one or two sentences/);
	});

	it('carries every objection into one correction', () => {
		const record = [
			searched('26 CFR § 1.170A-17 Qualified appraisal.'),
			result({ name: 'read_regulation', isError: true })
		];
		const correction = spokenCorrection(
			'26 CFR § 1.170A-17 requires an appraisal, and 26 CFR § 1.999-9 sets the threshold.',
			record
		)!;
		expect(correction.reasons.length).toBeGreaterThan(1);
	});
})
