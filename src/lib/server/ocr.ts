/**
 * Typed client for Mistral Document AI (OCR).
 *
 * We call the REST endpoint directly rather than through the SDK: the request
 * we need is a single POST, and this keeps the serverless bundle small and the
 * exact request shape visible at the call site.
 *
 * What this buys the app is geometry. OpenAI's models can read a document but
 * cannot say where on the page a sentence sits, so nothing can be pointed at.
 * Mistral returns typed blocks with bounding boxes, which is what lets a
 * finding be drawn on the page it came from.
 *
 * (Adapted from the Rowbot codebase; the retry policy is carried over intact.)
 */

export const OCR_MODEL = 'mistral-ocr-latest';
const ENDPOINT = 'https://api.mistral.ai/v1/ocr';

export interface OcrBlock {
	type: string;
	content: string;
	top_left_x: number;
	top_left_y: number;
	bottom_right_x: number;
	bottom_right_y: number;
}

export interface OcrPage {
	index: number;
	markdown: string;
	dimensions?: { dpi: number; height: number; width: number } | null;
	blocks?: OcrBlock[] | null;
}

export interface OcrResponse {
	pages: OcrPage[];
	model: string;
	usage_info?: { pages_processed: number; doc_size_bytes?: number | null };
}

export class MistralOcrError extends Error {
	constructor(
		message: string,
		readonly status?: number,
		readonly retryable = false
	) {
		super(message);
		this.name = 'MistralOcrError';
	}
}

export interface OcrOptions {
	/** Restrict to a page range, e.g. `'0-9'`. Page numbers start at 0. */
	pages?: string | number[];
	signal?: AbortSignal;
}

/**
 * Run OCR over a document.
 *
 * Blocks carry bounding boxes, which is the whole reason this exists — without
 * them a finding can be quoted but never shown.
 */
export async function runOcr(
	apiKey: string,
	bytes: Uint8Array,
	mimeType: string,
	filename: string,
	options: OcrOptions = {}
): Promise<OcrResponse> {
	const base64 = Buffer.from(bytes).toString('base64');
	const dataUri = `data:${mimeType};base64,${base64}`;

	const body = {
		model: OCR_MODEL,
		document: mimeType.startsWith('image/')
			? { type: 'image_url', image_url: dataUri }
			: { type: 'document_url', document_url: dataUri, document_name: filename },
		include_blocks: true,
		include_image_base64: false,
		...(options.pages !== undefined ? { pages: options.pages } : {})
	};

	// Mistral answers a rate limit or a bad minute with a 429 or a 5xx. These
	// are the failures that go away on their own, so they are waited out here
	// rather than handed to the reader as though the document were at fault.
	let last: MistralOcrError | null = null;

	for (let attempt = 0; attempt < RETRIES.length + 1; attempt += 1) {
		if (attempt > 0) await pause(RETRIES[attempt - 1], options.signal);
		try {
			return await attemptOcr(apiKey, body, options.signal);
		} catch (cause) {
			if (!(cause instanceof MistralOcrError) || !cause.retryable) throw cause;
			last = cause;
		}
	}

	throw last ?? new MistralOcrError('Mistral OCR failed');
}

/** Backoff between attempts, in ms. */
const RETRIES = [1_000, 4_000];

function pause(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener('abort', () => {
			clearTimeout(timer);
			reject(signal.reason);
		});
	});
}

async function attemptOcr(
	apiKey: string,
	body: unknown,
	signal?: AbortSignal
): Promise<OcrResponse> {
	let response: Response;
	try {
		response = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal
		});
	} catch (cause) {
		if ((cause as Error)?.name === 'AbortError') throw cause;
		throw new MistralOcrError(
			`Could not reach Mistral: ${(cause as Error).message}`,
			undefined,
			true
		);
	}

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		if (response.status === 401) {
			throw new MistralOcrError('That Mistral API key was rejected.', 401);
		}
		throw new MistralOcrError(
			`Mistral OCR failed (${response.status}): ${text.slice(0, 300)}`,
			response.status,
			response.status === 429 || response.status >= 500
		);
	}

	return (await response.json()) as OcrResponse;
}
