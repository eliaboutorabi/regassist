/**
 * Finding a quoted passage on the page.
 *
 * The review pack quotes a sentence; Mistral describes the page as typed
 * blocks with boxes. Nothing joins the two but the text itself, and the two
 * texts are never quite identical — OCR inserts markdown, breaks lines
 * differently, and reads a hyphen or a quote mark its own way. So matching is
 * done on a normalised form, and falls back to word overlap when a clean
 * containment check fails.
 */

export interface OcrBlockView {
	type: string;
	content: string;
	/** In the OCR's own pixel space; the viewer normalises against page size. */
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface OcrPageView {
	index: number;
	width: number | null;
	height: number | null;
	markdown: string;
	blocks: OcrBlockView[];
}

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface BlockMatch {
	page: number;
	block: OcrBlockView;
	/** 0–1. Containment scores 1; overlap scores the fraction of words shared. */
	score: number;
	/**
	 * Where to draw.
	 *
	 * Usually narrower than the block. Mistral segments a numbered list as one
	 * block, so four separate findings in one list would otherwise stack into a
	 * single rectangle covering all of it — which points at everything and
	 * therefore at nothing.
	 */
	box: Box;
}

/** Lowercase, strip markdown and punctuation, collapse whitespace. */
export function normalise(text: string): string {
	return text
		.toLowerCase()
		.replace(/[#*_`>|]/g, ' ')
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/[^a-z0-9'"$%.,()/-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

const STOPWORDS = new Set([
	'the', 'and', 'for', 'are', 'was', 'were', 'that', 'this', 'with', 'from', 'will', 'have',
	'has', 'not', 'but', 'all', 'any', 'can', 'his', 'her', 'its', 'our', 'their'
]);

function words(text: string): string[] {
	return normalise(text)
		.split(' ')
		.map((word) => word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
		.filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/** A minimum any mark stays legible at, as a fraction of the block. */
const MIN_SLICE = 0.12;

/**
 * Narrow a block's box to the part of it the quote occupies.
 *
 * Proportional to characters rather than lines: a long wrapped item takes more
 * vertical space than a short one, and character count tracks that far better
 * than counting the newlines the OCR happened to emit. It is an estimate, and
 * an estimate that puts the mark on the right paragraph beats an exact box
 * around the whole page.
 */
export function refineBox(block: OcrBlockView, quote: string): Box {
	const whole: Box = { x: block.x, y: block.y, width: block.width, height: block.height };

	const hay = normalise(block.content);
	const needle = normalise(quote);
	if (!hay || !needle) return whole;

	const start = hay.indexOf(needle);
	if (start === -1) return whole;

	const from = start / hay.length;
	const span = Math.max(needle.length / hay.length, MIN_SLICE);
	const to = Math.min(1, from + span);

	// Bleed a little above and below so the mark frames the text rather than
	// clipping its ascenders.
	const pad = block.height * 0.012;
	const top = block.y + from * block.height - pad;
	const height = (to - from) * block.height + pad * 2;

	return {
		x: block.x,
		y: Math.max(block.y, top),
		width: block.width,
		height: Math.min(height, block.y + block.height - Math.max(block.y, top))
	};
}

/**
 * The blocks a quote appears in, best first.
 *
 * A quote can legitimately span two blocks — a sentence broken across a
 * paragraph boundary — so this returns every block above the threshold rather
 * than only the winner.
 */
export function locateQuote(
	quote: string,
	pages: OcrPageView[],
	options: { minScore?: number; limit?: number } = {}
): BlockMatch[] {
	const minScore = options.minScore ?? 0.34;
	const needle = normalise(quote);
	if (needle.length < 8) return [];

	const needleWords = new Set(words(quote));
	if (!needleWords.size) return [];

	const matches: BlockMatch[] = [];

	for (const page of pages) {
		for (const block of page.blocks) {
			const hay = normalise(block.content);
			let score = 0;

			if (hay.includes(needle)) {
				score = 1;
			} else {
				// Fraction of the quote's distinctive words present in the block.
				const blockWords = new Set(words(block.content));
				let shared = 0;
				for (const word of needleWords) if (blockWords.has(word)) shared += 1;
				score = shared / needleWords.size;
			}

			if (score >= minScore) {
				matches.push({
					page: page.index,
					block,
					score,
					// A word-overlap match has no position inside the block to
					// narrow to, so it keeps the whole of it.
					box: score === 1 ? refineBox(block, quote) : {
						x: block.x,
						y: block.y,
						width: block.width,
						height: block.height
					}
				});
			}
		}
	}

	return matches
		.sort((a, b) => b.score - a.score || a.page - b.page)
		.slice(0, options.limit ?? 4);
}
