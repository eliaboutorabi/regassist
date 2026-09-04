import { describe, expect, it } from 'vitest';
import { locateInRuns } from './text-locate.js';
import type { TextRun } from './client/pdf.js';

/** Four list items, each wrapping onto two lines, as pdf.js reports them. */
const runs: TextRun[] = [
	{ text: '1. We will treat the four shop-floor staff as independent', x: 60, y: 100, width: 380, height: 12 },
	{ text: 'contractors on a 1099 basis for the rest of the year.', x: 78, y: 116, width: 340, height: 12 },
	{ text: '2. The owner will take a minimal salary and the rest in', x: 60, y: 148, width: 370, height: 12 },
	{ text: 'distributions.', x: 78, y: 164, width: 90, height: 12 },
	{ text: '3. Client dinners at the trade show are fully deductible;', x: 60, y: 196, width: 375, height: 12 },
	{ text: 'no receipts were retained.', x: 78, y: 212, width: 170, height: 12 },
	{ text: '4. This treatment is guaranteed to survive audit.', x: 60, y: 244, width: 330, height: 12 }
];

describe('locateInRuns', () => {
	it('lands on the line a short quote sits in', () => {
		const box = locateInRuns('This treatment is guaranteed to survive audit', runs)!;
		expect(box).not.toBeNull();
		expect(box.y).toBeGreaterThan(240);
		expect(box.y).toBeLessThan(250);
	});

	it('spans both lines of a wrapped sentence', () => {
		const box = locateInRuns(
			'The owner will take a minimal salary and the rest in distributions.',
			runs
		)!;
		expect(box.y).toBeLessThan(150);
		expect(box.y + box.height).toBeGreaterThan(174);
	});

	it('keeps four items apart rather than covering the block', () => {
		const boxes = [
			'We will treat the four shop-floor staff',
			'The owner will take a minimal salary',
			'Client dinners at the trade show are fully deductible',
			'This treatment is guaranteed to survive audit'
		].map((quote) => locateInRuns(quote, runs)!);

		expect(boxes.every(Boolean)).toBe(true);
		for (let i = 1; i < boxes.length; i += 1) {
			expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y);
			// No overlap: each mark is its own item.
			expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y + boxes[i - 1].height - 4);
		}
	});

	it('matches across a line break, where the raw text has none', () => {
		expect(locateInRuns('as independent contractors on a 1099 basis', runs)).not.toBeNull();
	});

	it('is unfazed by curly quotes and extra spacing', () => {
		expect(locateInRuns('  Client   dinners at the trade show  ', runs)).not.toBeNull();
	});

	it('returns null for text that is not on the page', () => {
		expect(locateInRuns('depreciation of qualified improvement property', runs)).toBeNull();
	});

	it('returns null for a page with no text layer', () => {
		expect(locateInRuns('anything at all here', [])).toBeNull();
	});

	it('ignores a quote too short to identify anything', () => {
		expect(locateInRuns('the', runs)).toBeNull();
	});
});
