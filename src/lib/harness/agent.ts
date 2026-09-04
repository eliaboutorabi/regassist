/**
 * The agent loop: stream a turn, run whatever tools the model asked for, feed
 * the results back, repeat until the model answers in prose.
 *
 * It yields a flat event stream rather than returning a finished message, so a
 * transport can forward tool cards to the UI the moment a call starts — which
 * is what makes regulations appear on screen while the robot is still talking.
 */

import type { Context } from './context.js';
import type { ChatMessage, LLMService, ToolCallRecord } from './llm.js';
import { ProviderError } from './llm.js';
import type { ToolCallView, ToolRegistry, ToolResult, ToolResultView } from './tools.js';

export type AgentEvent =
	| { type: 'text'; delta: string }
	| { type: 'reasoning'; summary: string }
	| { type: 'tool-call'; callId: string; name: string; label: string; view?: ToolCallView }
	| {
			type: 'tool-result';
			callId: string;
			name: string;
			isError: boolean;
			view?: ToolResultView;
			durationMs: number;
	  }
	| { type: 'done'; messages: ChatMessage[] }
	| { type: 'error'; message: string; status?: number };

export interface AgentRunOptions {
	messages: ChatMessage[];
	apiKey: string;
	model: string;
	signal?: AbortSignal;
	/** Guard against a tool-calling model that never settles. Defaults to 12. */
	maxSteps?: number;
	maxOutputTokens?: number;
}

export class AgentService {
	constructor(private readonly ctx: Context) {}

	/** Run one user turn to completion, yielding events as they happen. */
	async *run(options: AgentRunOptions): AsyncGenerator<AgentEvent> {
		const llm = this.ctx.require<LLMService>('llm');
		const tools = this.ctx.require<ToolRegistry>('tools');
		const maxSteps = options.maxSteps ?? 12;
		const messages: ChatMessage[] = [...options.messages];

		for (let step = 0; step < maxSteps; step += 1) {
			let text = '';
			const calls: ToolCallRecord[] = [];
			let failed = false;

			try {
				const stream = llm.stream({
					messages,
					tools: tools.schemas(),
					model: options.model,
					apiKey: options.apiKey,
					signal: options.signal,
					maxOutputTokens: options.maxOutputTokens
				});

				for await (const event of stream) {
					switch (event.type) {
						case 'text-delta':
							text += event.text;
							yield { type: 'text', delta: event.text };
							break;
						case 'reasoning':
							yield { type: 'reasoning', summary: event.summary };
							break;
						case 'tool-call':
							calls.push(event.call);
							yield {
								type: 'tool-call',
								callId: event.call.callId,
								name: event.call.name,
								label: tools.label(event.call.name),
								view: tools.presentCall(event.call.name, event.call.arguments)
							};
							break;
						case 'error':
							failed = true;
							yield { type: 'error', message: event.message, status: event.status };
							break;
						case 'done':
							break;
					}
				}
			} catch (error) {
				if (options.signal?.aborted) return;
				const provider = error instanceof ProviderError ? error : null;
				yield {
					type: 'error',
					message: error instanceof Error ? error.message : String(error),
					status: provider?.status
				};
				return;
			}

			if (failed) return;

			messages.push({
				role: 'assistant',
				content: text,
				...(calls.length ? { toolCalls: calls } : {})
			});

			if (!calls.length) {
				yield { type: 'done', messages };
				return;
			}

			// Tool calls in one model turn are independent; run them together.
			const results = await Promise.all(
				calls.map((call) =>
					tools.execute({
						callId: call.callId,
						name: call.name,
						arguments: call.arguments,
						signal: options.signal
					})
				)
			);

			for (const result of results) {
				yield {
					type: 'tool-result',
					callId: result.callId,
					name: result.name,
					isError: result.isError,
					view: result.view,
					durationMs: result.durationMs
				};
				messages.push({
					role: 'tool',
					callId: result.callId,
					name: result.name,
					content: renderToolContent(result)
				});
			}

			if (options.signal?.aborted) return;
		}

		yield {
			type: 'error',
			message: `Verity kept looking things up past ${maxSteps} steps without settling on an answer, so the turn was stopped. Try asking for one specific thing.`
		};
	}
}

function renderToolContent(result: ToolResult): string {
	const text = result.content
		.map((block) => block.text)
		.join('\n')
		.trim();
	return text || (result.isError ? 'The tool call failed.' : 'The tool returned no content.');
}

/** Provides `ctx.agent`. */
export const agentPlugin = {
	name: 'agent',
	inject: ['llm', 'tools'] as const,
	apply(ctx: Context) {
		ctx.provide('agent', new AgentService(ctx));
	}
};
