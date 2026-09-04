import { describe, expect, it } from 'vitest';
import { condenseSection } from './condense.js';

const REAL = `(a)-(b) [Reserved]. For further guidance, see § 1.274-5T(a) and (b).

(c) Rules of substantiation—(1) [Reserved]. For further guidance, see § 1.274-5T(c)(1).

(2) Substantiation by adequate records—(i) and (ii) [Reserved]. For further guidance, see § 1.274-5T(c)(2)(i) and (ii).

(iii) Documentary evidence—(A) Except as provided in paragraph (c)(2)(iii)(B), documentary evidence, such as receipts, paid bills, or similar evidence sufficient to support an expenditure, is required for—

(1) Any expenditure for lodging while traveling away from home, and

(2) Any other expenditure of $75 or more except, for transportation charges, documentary evidence will not be required if not readily available.`;

describe('condenseSection', () => {
	it('collapses a run of reserved paragraphs and says where the text lives', () => {
		const { text } = condenseSection(REAL);
		expect(text).toMatch(/\[3 paragraphs reserved here; the operative text is in § 1\.274-5T/);
		expect(text).not.toContain('For further guidance');
	});

	it('keeps every operative paragraph intact and unparaphrased', () => {
		const { text } = condenseSection(REAL);
		expect(text).toContain('documentary evidence, such as receipts, paid bills');
		expect(text).toContain('Any other expenditure of $75 or more');
	});

	it('makes a real dent in the length', () => {
		expect(condenseSection(REAL).text.length).toBeLessThan(REAL.length * 0.75);
	});

	it('reports a cut rather than hiding it', () => {
		const long = Array.from({ length: 40 }, (_, i) => `(${i}) A paragraph of operative text.`).join(
			'\n\n'
		);
		const { text, truncated } = condenseSection(long, 300);
		expect(truncated).toBe(true);
		expect(text.length).toBeLessThanOrEqual(300);
	});

	it('cuts at a paragraph boundary, never mid-sentence', () => {
		const long = ['(a) First paragraph here.', '(b) Second paragraph here.'].join('\n\n');
		const { text } = condenseSection(long, 30);
		expect(text).toBe('(a) First paragraph here.');
	});

	it('still returns something for one enormous paragraph', () => {
		const wall = `(a) ${'text '.repeat(2000)}`;
		const { text, truncated } = condenseSection(wall, 200);
		expect(text.length).toBe(200);
		expect(truncated).toBe(true);
	});

	it('leaves a short section alone', () => {
		const short = '(a) Business expenses are deductible.';
		expect(condenseSection(short)).toEqual({ text: short, truncated: false });
	});

	it('handles a section that is nothing but reserved paragraphs', () => {
		const allReserved = '(a) [Reserved].\n\n(b) [Reserved]. For further guidance, see § 1.1-1.';
		const { text } = condenseSection(allReserved);
		expect(text).toMatch(/2 paragraphs reserved/);
	});
});
