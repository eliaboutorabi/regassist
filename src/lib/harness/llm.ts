/**
 * The model seam. Nothing above this file knows which provider is in use: the
 * agent loop asks `ctx.llm` for a stream of events and gets text deltas and
 * tool calls back, whoever produced them.
 */

import type { Context, Disposer } from './context.js';
import type { JsonValue } from './schema.js';
import type { ToolSchema } from './tools.js';

export interface ToolCallRecord {
	callId: string;
	name: string;
	arguments: Record<string, JsonValue>;
}

export type ChatMessage =
	| { role: 'system'; content: string }
	| { role: 'user'; content: string }
	| { role: 'assistant'; content: string; toolCalls?: ToolCallRecord[] }
	| { role: 'tool'; callId: string; name: string; content: string };

export interface CompletionRequest {
	messages: ChatMessage[];
	tools: ToolSchema[];
	model: string;
	signal?: AbortSignal;
	/** Provider credential. Supplied per request — this app is bring-your-own-key. */
	apiKey: string;
	maxOutputTokens?: number;
}

export type StreamEvent =
	| { type: 'text-delta'; text: string }
	| { type: 'reasoning'; summary: string }
	| { type: 'tool-call'; call: ToolCallRecord }
	| { type: 'done'; finishReason: 'stop' | 'tool-calls' | 'length' }
	| { type: 'error'; message: string; status?: number };

export interface LLMAdapter {
	readonly id: string;
	/** List model ids the supplied credential can actually reach. */
	listModels?(apiKey: string, signal?: AbortSignal): Promise<string[]>;
	stream(request: CompletionRequest): AsyncIterable<StreamEvent>;
}

/** A provider-facing error carrying the upstream status where we have one. */
export class ProviderError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'ProviderError';
	}
}

export class LLMService {
	readonly #adapters = new Map<string, LLMAdapter>();
	#defaultId: string | null = null;

	constructor(private readonly ctx: Context) {}

	register(adapter: LLMAdapter): Disposer {
		return this.ctx.effect(() => {
			this.#adapters.set(adapter.id, adapter);
			this.#defaultId ??= adapter.id;
			return () => {
				this.#adapters.delete(adapter.id);
				if (this.#defaultId === adapter.id) {
					this.#defaultId = this.#adapters.keys().next().value ?? null;
				}
			};
		});
	}

	adapter(id?: string): LLMAdapter {
		const key = id ?? this.#defaultId;
		const adapter = key ? this.#adapters.get(key) : undefined;
		if (!adapter) throw new ProviderError(`No LLM adapter registered for "${key ?? 'default'}".`);
		return adapter;
	}

	stream(request: CompletionRequest, adapterId?: string): AsyncIterable<StreamEvent> {
		return this.adapter(adapterId).stream(request);
	}
}

/** Provides `ctx.llm`. */
export const llmPlugin = {
	name: 'llm',
	apply(ctx: Context) {
		ctx.provide('llm', new LLMService(ctx));
	}
};
