import { describe, expect, it } from 'vitest';
import { locateQuote, normalise, refineBox, type OcrPageView } from './ocr-match.js';

const page = (blocks: { content: string; type?: string }[]): OcrPageView => ({
	index: 0,
	width: 800,
	height: 1000,
	markdown: '',
	blocks: blocks.map((block, index) => ({
		type: block.type ?? 'text',
		content: block.content,
		x: 50,
		y: 50 + index * 100,
		width: 700,
		height: 90
	}))
});

describe('normalise', () => {
	it('strips markdown and collapses whitespace', () => {
		expect(normalise('#  **Client**   dinners\nare  fully deductible')).toBe(
			'client dinners are fully deductible'
		);
	});

	it('folds curly quotes into straight ones', () => {
		expect(normalise('the “owner’s” salary')).toBe('the "owner\'s" salary');
	});
});

describe('locateQuote', () => {
	const pages = [
		page([
			{ content: '# Memorandum on Q3 planning', type: 'title' },
			{ content: 'Client dinners at the trade show are fully deductible; no receipts retained.' },
			{ content: 'The owner will take a minimal salary and the rest in distributions.' }
		])
	];

	it('finds the block a quote sits in', () => {
		const [match] = locateQuote('Client dinners at the trade show are fully deductible', pages);
		expect(match.block.content).toContain('Client dinners');
		expect(match.score).toBe(1);
	});

	it('still finds it when the OCR wrapped the line differently', () => {
		const wrapped = [page([{ content: 'Client dinners at the trade\nshow are **fully** deductible' }])];
		const [match] = locateQuote('Client dinners at the trade show are fully deductible', wrapped);
		expect(match).toBeDefined();
		expect(match.score).toBeGreaterThan(0.9);
	});

	it('falls back to word overlap when containment fails', () => {
		const [match] = locateQuote('the owner takes a minimal salary, rest as distributions', pages);
		expect(match.block.content).toContain('minimal salary');
		expect(match.score).toBeGreaterThan(0.34);
		expect(match.score).toBeLessThan(1);
	});

	it('returns nothing for a passage that is not on the page', () => {
		expect(locateQuote('depreciation of qualified improvement property', pages)).toEqual([]);
	});

	it('ignores a quote too short to identify anything', () => {
		expect(locateQuote('the', pages)).toEqual([]);
	});

	it('ranks an exact containment above a partial overlap', () => {
		const matches = locateQuote('minimal salary and the rest in distributions', pages);
		expect(matches[0].block.content).toContain('minimal salary');
		expect(matches[0].score).toBe(1);
	});
});

describe('refineBox', () => {
	const block = {
		type: 'list',
		content:
			'1. We will treat the four shop-floor staff as independent contractors on a 1099 basis for the rest of the year.\n2. The owner will take a minimal salary and the rest in distributions.\n3. Client dinners at the trade show are fully deductible; no receipts were retained.\n4. This treatment is guaranteed to survive audit.',
		x: 74,
		y: 89,
		width: 384,
		height: 183
	};

	it('marks the top of the block for the first item', () => {
		const box = refineBox(block, 'We will treat the four shop-floor staff as independent contractors');
		expect(box.y).toBeLessThan(block.y + block.height * 0.2);
		expect(box.height).toBeLessThan(block.height * 0.6);
	});

	it('marks the bottom of the block for the last item', () => {
		const box = refineBox(block, 'This treatment is guaranteed to survive audit');
		expect(box.y).toBeGreaterThan(block.y + block.height * 0.6);
	});

	it('keeps four separate items separate rather than stacking them', () => {
		const boxes = [
			'We will treat the four shop-floor staff',
			'The owner will take a minimal salary',
			'Client dinners at the trade show are fully deductible',
			'This treatment is guaranteed to survive audit'
		].map((quote) => refineBox(block, quote));

		for (let i = 1; i < boxes.length; i += 1) {
			expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y);
		}
		// None of them covers the whole block.
		for (const box of boxes) expect(box.height).toBeLessThan(block.height * 0.75);
	});

	it('never escapes the block it belongs to', () => {
		for (const quote of ['We will treat', 'guaranteed to survive audit']) {
			const box = refineBox(block, quote);
			expect(box.y).toBeGreaterThanOrEqual(block.y);
			expect(box.y + box.height).toBeLessThanOrEqual(block.y + block.height + 0.01);
		}
	});

	it('keeps a very short quote visible', () => {
		const box = refineBox(block, 'minimal salary');
		expect(box.height).toBeGreaterThan(block.height * 0.1);
	});

	it('falls back to the whole block when the quote is not inside it', () => {
		const box = refineBox(block, 'depreciation of qualified improvement property');
		expect(box).toEqual({ x: 74, y: 89, width: 384, height: 183 });
	});
});
