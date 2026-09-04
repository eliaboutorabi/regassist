/**
 * Finding a quote in a page's own text layer.
 *
 * OCR gives blocks, and a block can be a whole numbered list — four separate
 * findings inside one rectangle. The PDF's text layer is finer: it knows where
 * every run of characters was drawn. Matching a quote against the concatenated
 * runs and taking the union of the runs it spans puts the mark on the sentence
 * rather than the paragraph.
 *
 * Everything here is pure and works in the OCR's coordinate space, so the
 * result can be swapped in for a block box with no other change.
 */

import type { TextRun } from '$lib/client/pdf';
import type { Box } from '$lib/ocr-match';

/** Same normalisation on both sides, with an index back to the source. */
function flatten(runs: TextRun[]): { text: string; owner: number[] } {
	let text = '';
	const owner: number[] = [];

	runs.forEach((run, index) => {
		const cleaned = run.text.replace(/\s+/g, ' ');
		for (const character of cleaned) {
			const lower = character.toLowerCase();
			// Collapse runs of whitespace across run boundaries too, or a quote
			// spanning two runs picks up a double space and stops matching.
			if (lower === ' ' && text.endsWith(' ')) continue;
			text += lower;
			owner.push(index);
		}
		if (!text.endsWith(' ')) {
			text += ' ';
			owner.push(index);
		}
	});

	return { text, owner };
}

function simplify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/\s+/g, ' ')
		.trim();
}

/** The union of the runs a quote spans, or null when it is not on this page. */
export function locateInRuns(quote: string, runs: TextRun[]): Box | null {
	if (!runs.length) return null;

	const needle = simplify(quote);
	if (needle.length < 8) return null;

	const { text, owner } = flatten(runs);
	const start = text.indexOf(needle);
	if (start === -1) return null;

	const first = owner[start];
	const last = owner[Math.min(start + needle.length - 1, owner.length - 1)];
	if (first === undefined || last === undefined) return null;

	const spanned = runs.slice(first, last + 1);
	if (!spanned.length) return null;

	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;

	for (const run of spanned) {
		left = Math.min(left, run.x);
		top = Math.min(top, run.y);
		right = Math.max(right, run.x + run.width);
		bottom = Math.max(bottom, run.y + run.height);
	}

	// A little air so the mark frames the text rather than clipping it.
	const pad = Math.max(1, (bottom - top) * 0.16);
	return {
		x: left - pad,
		y: top - pad,
		width: right - left + pad * 2,
		height: bottom - top + pad * 2
	};
}
