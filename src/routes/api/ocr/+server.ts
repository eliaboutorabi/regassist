/**
 * Read a document, with geometry.
 *
 * The browser holds the file and posts it here with the caller's own Mistral
 * key; we forward it and hand back pages, their dimensions, and typed blocks
 * with bounding boxes. Nothing is stored — the bytes live for the length of
 * this request, and the boxes go back to the tab that asked.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { MistralOcrError, runOcr } from '$lib/server/ocr';

export const config = { runtime: 'nodejs22.x' };

/** Comfortably inside a serverless body limit, and a big engagement letter. */
const MAX_BYTES = 8 * 1024 * 1024;

const KEY_HEADER = 'x-mistral-key';

export const POST: RequestHandler = async ({ request }) => {
	const apiKey = request.headers.get(KEY_HEADER)?.trim();
	if (!apiKey) {
		error(401, 'No Mistral API key was supplied. Add one in settings to read a PDF.');
	}

	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof File)) error(400, 'Expected a file.');
	if (file.size > MAX_BYTES) {
		error(413, `That document is ${(file.size / 1e6).toFixed(1)} MB. The limit is 8 MB.`);
	}

	const bytes = new Uint8Array(await file.arrayBuffer());

	try {
		const result = await runOcr(apiKey, bytes, file.type || 'application/pdf', file.name, {
			signal: request.signal
		});

		// Only what the viewer draws with: page shape, and the boxes plus the
		// text inside them. The rest of Mistral's payload is not ours to keep.
		return json({
			pages: result.pages.map((page) => ({
				index: page.index,
				width: page.dimensions?.width ?? null,
				height: page.dimensions?.height ?? null,
				markdown: page.markdown,
				blocks: (page.blocks ?? []).map((block) => ({
					type: block.type,
					content: block.content,
					x: block.top_left_x,
					y: block.top_left_y,
					width: block.bottom_right_x - block.top_left_x,
					height: block.bottom_right_y - block.top_left_y
				}))
			}))
		});
	} catch (cause) {
		if (cause instanceof MistralOcrError) {
			error(cause.status === 401 ? 401 : 502, cause.message);
		}
		error(502, cause instanceof Error ? cause.message : 'That document could not be read.');
	}
};
