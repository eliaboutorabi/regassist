/**
 * A section, shortened for someone listening.
 *
 * Regulation text is written to be looked at. A single Treasury section runs to
 * twelve thousand characters, and a third of it can be cross-references —
 * "(a)-(b) [Reserved]. For further guidance, see § 1.274-5T(a) and (b)." — which
 * a reader skims past and a voice model has to swallow whole before it can
 * begin answering.
 *
 * This is not summarisation: nothing is paraphrased and nothing is invented.
 * Runs of reserved paragraphs collapse into one line that says where the text
 * actually lives, and what remains is cut at a paragraph boundary with the cut
 * declared, so the model knows to offer the rest rather than pretend it read it.
 */

/**
 * A paragraph that exists only to say the text is somewhere else.
 *
 * Matching on the marker plus the shape rather than on a prefix: the marker can
 * sit well into a paragraph — "(2) Substantiation by adequate records—(i) and
 * (ii) [Reserved]." — and an earlier version that anchored to the start missed
 * exactly those, which are the commonest kind.
 */
function isReserved(paragraph: string): boolean {
	if (!/\[reserved\]/i.test(paragraph)) return false;
	return /for further guidance/i.test(paragraph) || paragraph.length < 200;
}

/** "For further guidance, see § 1.274-5T(c)(1)." → `1.274-5T`. */
function pointsAt(paragraph: string): string | null {
	const match = /see\s+§+\s*([\d][\w.\-]*)/i.exec(paragraph);
	// The base section, not the paragraph: naming six paragraphs of the same
	// section is longer than the text it replaced.
	return match ? match[1].replace(/[.\s]+$/, '') : null;
}

export interface Condensed {
	text: string;
	/** True when paragraphs were dropped, so the caller can say so. */
	truncated: boolean;
}

export function condenseSection(body: string, maxChars = 2400): Condensed {
	const paragraphs = body
		.split(/\n{2,}/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean);

	const kept: string[] = [];
	let reservedRun: string[] = [];

	const flushReserved = () => {
		if (!reservedRun.length) return;
		const targets = [...new Set(reservedRun.map(pointsAt).filter(Boolean))] as string[];
		kept.push(
			targets.length
				? `[${reservedRun.length} paragraph${reservedRun.length === 1 ? '' : 's'} reserved here; the operative text is in § ${targets.join(', § ')}.]`
				: `[${reservedRun.length} paragraph${reservedRun.length === 1 ? '' : 's'} reserved here.]`
		);
		reservedRun = [];
	};

	for (const paragraph of paragraphs) {
		if (isReserved(paragraph)) {
			reservedRun.push(paragraph);
			continue;
		}
		flushReserved();
		kept.push(paragraph);
	}
	flushReserved();

	let text = '';
	let truncated = false;
	for (const paragraph of kept) {
		if (text.length + paragraph.length + 2 > maxChars) {
			truncated = true;
			break;
		}
		text += (text ? '\n\n' : '') + paragraph;
	}

	// A section that is one enormous paragraph still has to fit somewhere.
	if (!text && kept.length) {
		text = kept[0].slice(0, maxChars);
		truncated = true;
	}

	return { text, truncated };
}
