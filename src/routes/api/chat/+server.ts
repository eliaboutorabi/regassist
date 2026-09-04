/**
 * The text agent, streamed as server-sent events.
 *
 * Each frame is one `AgentEvent`, so the client renders tool cards the moment
 * a call starts rather than waiting for the turn to finish.
 */

import { error, type RequestHandler } from '@sveltejs/kit';
import { DEFAULT_MODEL, type AgentService, type ChatMessage } from '$lib/harness';
import { createHarness } from '$lib/plugins';
import { composeInstructions, TEXT_INSTRUCTIONS } from '$lib/prompts';
import { describeError, parseBrain, parseDocuments, requireApiKey } from '$lib/server/request';

export const config = { runtime: 'nodejs22.x' };

const MAX_TURNS = 60;

function parseMessages(raw: unknown): ChatMessage[] {
	if (!Array.isArray(raw) || raw.length === 0) error(400, 'messages must be a non-empty array.');
	if (raw.length > MAX_TURNS) error(400, `Conversations are capped at ${MAX_TURNS} turns.`);

	return raw.map((entry, index) => {
		const { role, content } = (entry ?? {}) as Record<string, unknown>;
		if (role !== 'user' && role !== 'assistant') {
			error(400, `messages[${index}].role must be "user" or "assistant".`);
		}
		if (typeof content !== 'string') error(400, `messages[${index}].content must be a string.`);
		return { role, content: content.slice(0, 40_000) } as ChatMessage;
	});
}

export const POST: RequestHandler = async ({ request }) => {
	const apiKey = requireApiKey(request);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) error(400, 'Expected a JSON body.');

	const messages = parseMessages(body.messages);
	const documents = parseDocuments(body.documents);
	const brain = parseBrain(body.brain);
	const model = typeof body.model === 'string' && body.model ? body.model : DEFAULT_MODEL;

	const ctx = await createHarness({ documents, packs: brain.packs });
	const agent = ctx.require<AgentService>('agent');
	const encoder = new TextEncoder();

	// The client's abort must reach the provider and the in-flight tool calls.
	const controller = new AbortController();
	request.signal.addEventListener('abort', () => controller.abort(), { once: true });

	const stream = new ReadableStream<Uint8Array>({
		async start(sink) {
			const send = (payload: unknown) =>
				sink.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

			try {
				for await (const event of agent.run({
					messages: [
						{ role: 'system', content: composeInstructions(TEXT_INSTRUCTIONS, brain) },
						...messages
					],
					apiKey,
					model,
					signal: controller.signal
				})) {
					// `done` carries the full internal message list, tool calls and
					// all. The client only needs to know the turn ended.
					send(event.type === 'done' ? { type: 'done' } : event);
				}
			} catch (cause) {
				if (!controller.signal.aborted) {
					send({ type: 'error', message: describeError(cause) });
				}
			} finally {
				ctx.dispose();
				sink.close();
			}
		},
		cancel() {
			controller.abort();
			ctx.dispose();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			// Vercel and nginx both buffer SSE without this.
			'X-Accel-Buffering': 'no'
		}
	});
};
