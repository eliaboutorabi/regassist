/**
 * OpenAI adapter, spoken over the Responses API.
 *
 * The Responses API is the right seam for the gpt-5 family: reasoning items
 * stay server-side, tool calls arrive as first-class output items, and the
 * streaming event names are stable. We translate its events into the small
 * provider-neutral `StreamEvent` union the agent loop consumes.
 */

import type { Context } from './context.js';
import {
	ProviderError,
	type ChatMessage,
	type CompletionRequest,
	type LLMAdapter,
	type LLMService,
	type StreamEvent,
	type ToolCallRecord
} from './llm.js';
import type { JsonValue } from './schema.js';

const API_BASE = 'https://api.openai.com/v1';

export const DEFAULT_MODEL = 'gpt-5.4-mini';

/**
 * Which of a key's models to offer, newest first.
 *
 * A hardcoded allowlist goes stale the week after it is written — the picker
 * was still offering gpt-5.5 as its best option months after newer models had
 * shipped, because nobody had edited the array. This works the other way
 * round: take what the key actually reports, drop what cannot hold a
 * tool-using text conversation, and rank the rest by version.
 */
const NOT_CHAT =
	/(realtime|audio|transcribe|tts|embedding|moderation|image|dall-e|search|codex|instruct|deep-research)/;

/** Dated snapshots duplicate their alias; the alias is the better default. */
const DATED = /-\d{4}-\d{2}-\d{2}$/;

function versionOf(id: string): number {
	// "gpt-5.4-mini" → 5.4, "gpt-4.1" → 4.1, "o4-mini" → 4.
	const gpt = /^gpt-(\d+)(?:\.(\d+))?/.exec(id);
	if (gpt) return Number(gpt[1]) + Number(gpt[2] ?? 0) / 100;
	const o = /^o(\d+)/.exec(id);
	if (o) return Number(o[1]) - 1;
	return 0;
}

/** Full models before mini before nano, so the picker's first entry is the best one. */
function sizeRank(id: string): number {
	if (/-nano/.test(id)) return 3;
	if (/-mini/.test(id)) return 2;
	if (/-pro/.test(id)) return 1;
	return 0;
}

export function selectChatModels(available: string[], limit = 14): string[] {
	return available
		.filter((id) => /^(gpt-|o\d)/.test(id) && !NOT_CHAT.test(id) && !DATED.test(id))
		.sort((a, b) => {
			const version = versionOf(b) - versionOf(a);
			if (version !== 0) return version;
			const size = sizeRank(a) - sizeRank(b);
			if (size !== 0) return size;
			return a.localeCompare(b);
		})
		.slice(0, limit);
}

type ResponsesInputItem =
	| { role: 'system' | 'user' | 'assistant'; content: { type: string; text: string }[] }
	| { type: 'function_call'; call_id: string; name: string; arguments: string }
	| { type: 'function_call_output'; call_id: string; output: string };

/** Flatten our neutral message list into Responses API input items. */
function toInput(messages: ChatMessage[]): {
	instructions: string;
	input: ResponsesInputItem[];
} {
	const instructions: string[] = [];
	const input: ResponsesInputItem[] = [];

	for (const message of messages) {
		switch (message.role) {
			case 'system':
				instructions.push(message.content);
				break;
			case 'user':
				input.push({ role: 'user', content: [{ type: 'input_text', text: message.content }] });
				break;
			case 'assistant':
				if (message.content) {
					input.push({
						role: 'assistant',
						content: [{ type: 'output_text', text: message.content }]
					});
				}
				for (const call of message.toolCalls ?? []) {
					input.push({
						type: 'function_call',
						call_id: call.callId,
						name: call.name,
						arguments: JSON.stringify(call.arguments)
					});
				}
				break;
			case 'tool':
				input.push({
					type: 'function_call_output',
					call_id: message.callId,
					output: message.content
				});
				break;
		}
	}

	return { instructions: instructions.join('\n\n'), input };
}

function parseArguments(raw: string, name: string): Record<string, JsonValue> {
	if (!raw.trim()) return {};
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			throw new Error('not an object');
		}
		return parsed as Record<string, JsonValue>;
	} catch {
		throw new ProviderError(`The model produced malformed arguments for "${name}".`);
	}
}

/** Read an SSE body as a stream of parsed `data:` payloads. */
async function* readEventStream(
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal
): AsyncGenerator<Record<string, unknown>> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		while (true) {
			if (signal?.aborted) return;
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			let boundary: number;
			while ((boundary = buffer.indexOf('\n\n')) !== -1) {
				const chunk = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				for (const line of chunk.split('\n')) {
					if (!line.startsWith('data:')) continue;
					const payload = line.slice(5).trim();
					if (!payload || payload === '[DONE]') continue;
					try {
						yield JSON.parse(payload) as Record<string, unknown>;
					} catch {
						// A truncated frame is not worth failing the whole turn over.
					}
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}

async function describeFailure(response: Response): Promise<never> {
	const text = await response.text().catch(() => '');
	let detail = text.slice(0, 400);
	try {
		const parsed = JSON.parse(text) as { error?: { message?: string } };
		if (parsed.error?.message) detail = parsed.error.message;
	} catch {
		// keep the raw body
	}
	if (response.status === 401) {
		throw new ProviderError('That OpenAI API key was rejected. Check the key and try again.', 401);
	}
	if (response.status === 429) {
		throw new ProviderError(
			'OpenAI rate-limited this key, or the account is out of quota.',
			429
		);
	}
	throw new ProviderError(detail || `OpenAI returned ${response.status}.`, response.status);
}

export const openaiAdapter: LLMAdapter = {
	id: 'openai',

	async listModels(apiKey, signal) {
		const response = await fetch(`${API_BASE}/models`, {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal
		});
		if (!response.ok) await describeFailure(response);
		const payload = (await response.json()) as { data?: { id: string }[] };
		return (payload.data ?? []).map((model) => model.id);
	},

	async *stream(request: CompletionRequest): AsyncIterable<StreamEvent> {
		const { instructions, input } = toInput(request.messages);

		const response = await fetch(`${API_BASE}/responses`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${request.apiKey}`,
				'Content-Type': 'application/json'
			},
			signal: request.signal,
			body: JSON.stringify({
				model: request.model,
				stream: true,
				store: false,
				...(instructions ? { instructions } : {}),
				input,
				...(request.maxOutputTokens ? { max_output_tokens: request.maxOutputTokens } : {}),
				...(request.tools.length
					? {
							tools: request.tools.map((tool) => ({
								type: 'function',
								name: tool.name,
								description: tool.description,
								parameters: tool.parameters
							})),
							tool_choice: 'auto'
						}
					: {})
			})
		});

		if (!response.ok || !response.body) await describeFailure(response);

		// call_id keyed by the streaming item id, so deltas land on the right call.
		const pending = new Map<string, { callId: string; name: string; args: string }>();
		const emitted: ToolCallRecord[] = [];
		let sawText = false;
		let incomplete: string | null = null;

		for await (const event of readEventStream(response.body!, request.signal)) {
			const type = event.type as string;

			switch (type) {
				case 'response.output_text.delta': {
					const text = event.delta as string;
					if (text) {
						sawText = true;
						yield { type: 'text-delta', text };
					}
					break;
				}

				case 'response.reasoning_summary_text.delta': {
					const summary = event.delta as string;
					if (summary) yield { type: 'reasoning', summary };
					break;
				}

				case 'response.output_item.added': {
					const item = event.item as
						| { id?: string; type?: string; call_id?: string; name?: string }
						| undefined;
					if (item?.type === 'function_call' && item.call_id && item.name) {
						pending.set(String(item.id ?? item.call_id), {
							callId: item.call_id,
							name: item.name,
							args: ''
						});
					}
					break;
				}

				case 'response.function_call_arguments.delta': {
					const entry = pending.get(String(event.item_id));
					if (entry) entry.args += (event.delta as string) ?? '';
					break;
				}

				case 'response.function_call_arguments.done': {
					const entry = pending.get(String(event.item_id));
					if (!entry) break;
					pending.delete(String(event.item_id));
					const raw = (event.arguments as string) ?? entry.args;
					const call: ToolCallRecord = {
						callId: entry.callId,
						name: entry.name,
						arguments: parseArguments(raw, entry.name)
					};
					emitted.push(call);
					yield { type: 'tool-call', call };
					break;
				}

				case 'response.incomplete': {
					const details = (event.response as { incomplete_details?: { reason?: string } })
						?.incomplete_details;
					incomplete = details?.reason ?? 'incomplete';
					break;
				}

				case 'error':
				case 'response.failed': {
					const message =
						((event.error ?? (event.response as { error?: { message?: string } })?.error) as {
							message?: string;
						})?.message ?? 'The model stream failed.';
					yield { type: 'error', message };
					return;
				}

				default:
					break;
			}
		}

		if (emitted.length) yield { type: 'done', finishReason: 'tool-calls' };
		else if (incomplete === 'max_output_tokens') yield { type: 'done', finishReason: 'length' };
		else if (!sawText && !incomplete) yield { type: 'done', finishReason: 'stop' };
		else yield { type: 'done', finishReason: 'stop' };
	}
};

/** Registers the OpenAI adapter on `ctx.llm`. */
export const openaiPlugin = {
	name: 'llm-openai',
	inject: ['llm'] as const,
	apply(ctx: Context) {
		ctx.require<LLMService>('llm').register(openaiAdapter);
	}
};
