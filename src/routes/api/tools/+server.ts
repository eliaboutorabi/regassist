/**
 * Tool execution for the voice agent.
 *
 * In voice mode the model's function calls arrive in the browser over the
 * WebRTC data channel, but the tools themselves must run server-side: the
 * government APIs send no CORS headers, and the response cache is worth
 * sharing. The browser posts the call here and gets back both the model-facing
 * content and the card to render — the same pair the text agent produces,
 * from the same registry.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import type { ToolRegistry } from '$lib/harness';
import { createHarness } from '$lib/plugins';
import { describeError, parseBrain, parseDocuments } from '$lib/server/request';

export const config = { runtime: 'nodejs22.x' };

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) error(400, 'Expected a JSON body.');

	const { name, callId } = body;
	if (typeof name !== 'string' || !name) error(400, 'name must be a string.');
	if (typeof callId !== 'string' || !callId) error(400, 'callId must be a string.');

	const args = body.arguments;
	if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
		error(400, 'arguments must be an object.');
	}

	const documents = parseDocuments(body.documents);
	const brain = parseBrain(body.brain);
	const ctx = await createHarness({ documents, packs: brain.packs });

	try {
		const result = await ctx.require<ToolRegistry>('tools').execute({
			callId,
			name,
			arguments: (args ?? {}) as Record<string, never>,
			signal: request.signal
		});

		return json({
			callId: result.callId,
			name: result.name,
			isError: result.isError,
			/** What goes back to the model as the function call output. */
			output: result.content.map((block) => block.text).join('\n'),
			view: result.view ?? null,
			durationMs: result.durationMs
		});
	} catch (cause) {
		error(500, describeError(cause));
	} finally {
		ctx.dispose();
	}
};
