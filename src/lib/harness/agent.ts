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

/**
 * The turn is about to close: the model owes no response and made no tool
 * calls. Awaited before the boundary commits — a listener that objects steers,
 * and the loop runs another step with that instruction in hand.
 *
 * Data decides, so listener order cannot change the outcome: every listener
 * sees the same draft and the same record, and any one of them steering is
 * enough to reopen the turn.
 *
 * Modelled on the upstream `agent/turn-stopping` serial checkpoint.
 */
export interface TurnStopping {
	readonly turn: number;
	/** What the user actually asked, so a critic can judge relevance. */
	readonly question: string;
	/** The prose the model is about to end on. */
	readonly draft: string;
	/** Every tool result this turn produced, in order. */
	readonly record: readonly ToolResult[];
	readonly signal?: AbortSignal;
	/** Object, and say what the model should do about it. */
	steer(instruction: string, reason: string): void;
}

export interface Steer {
	instruction: string;
	reason: string;
}

/**
 * A model request failed before it produced anything.
 *
 * Listeners return a retry action or nothing, in which case the error stands.
 * Only ever dispatched when the step emitted no text and no tool call — a
 * stream that half-succeeded cannot be replayed without repeating itself, so
 * that failure is surfaced rather than retried.
 *
 * Modelled on the upstream `agent/request-error` waterfall.
 */
export interface RequestError {
	readonly error: unknown;
	readonly status?: number;
	/** How many times this step has already been retried. */
	readonly attempt: number;
}

export interface RetryAction {
	retry: true;
	/** How long to wait first. */
	delayMs: number;
	/** Shown to nobody; kept for diagnostics. */
	reason: string;
}

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
	| {
			/** A turn-stopping listener objected; the loop is fixing it. */
			type: 'review';
			status: 'checking' | 'clean' | 'revising';
			reasons: string[];
	  }
	| { type: 'done'; messages: ChatMessage[]; revised: boolean }
	| { type: 'error'; message: string; status?: number };

export interface AgentRunOptions {
	messages: ChatMessage[];
	apiKey: string;
	model: string;
	signal?: AbortSignal;
	/** Guard against a tool-calling model that never settles. Defaults to 12. */
	maxSteps?: number;
	/**
	 * How many times a turn may be reopened by a checkpoint objection.
	 *
	 * One by default. A second pass on the same answer almost never finds
	 * something the first missed, and an agent that argues with its own critic
	 * is worse than one that states its limits and stops.
	 */
	maxRevisions?: number;
	maxOutputTokens?: number;
}

export class AgentService {
	constructor(private readonly ctx: Context) {}

	/** Run one user turn to completion, yielding events as they happen. */
	async *run(options: AgentRunOptions): AsyncGenerator<AgentEvent> {
		const llm = this.ctx.require<LLMService>('llm');
		const tools = this.ctx.require<ToolRegistry>('tools');
		const maxSteps = options.maxSteps ?? 12;
		const maxRevisions = options.maxRevisions ?? 1;
		const messages: ChatMessage[] = [...options.messages];

		/** Every tool result this turn, for the checkpoint to reason over. */
		const record: ToolResult[] = [];
		const question =
			[...options.messages].reverse().find((message) => message.role === 'user')?.content ?? '';
		let revisions = 0;
		let draft = '';

		for (let step = 0; step < maxSteps; step += 1) {
			let text = '';
			let calls: ToolCallRecord[] = [];
			let failed = false;
			let attempt = 0;

			// One step, retried while it has produced nothing. A stream that
			// half-succeeded cannot be replayed without repeating itself.
			for (;;) {
				text = '';
				calls = [];
				failed = false;
				const pending: AgentEvent[] = [];
				let started = false;
				let failure: { error: unknown; status?: number } | null = null;

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
								started = true;
								text += event.text;
								pending.push({ type: 'text', delta: event.text });
								break;
							case 'reasoning':
								pending.push({ type: 'reasoning', summary: event.summary });
								break;
							case 'tool-call':
								started = true;
								calls.push(event.call);
								pending.push({
									type: 'tool-call',
									callId: event.call.callId,
									name: event.call.name,
									label: tools.label(event.call.name),
									view: tools.presentCall(event.call.name, event.call.arguments)
								});
								break;
							case 'error':
								failure = { error: new ProviderError(event.message, event.status), status: event.status };
								break;
							case 'done':
								break;
						}
						// Nothing is yielded until the step is past the point where a
						// retry is possible, so a retried step never double-prints.
						if (started) {
							for (const queued of pending.splice(0)) yield queued;
						}
					}
				} catch (error) {
					if (options.signal?.aborted) return;
					failure = {
						error,
						status: error instanceof ProviderError ? error.status : undefined
					};
				}

				if (!failure) {
					for (const queued of pending) yield queued;
					break;
				}

				const action =
					!started && !options.signal?.aborted
						? this.ctx.bail<RetryAction>('agent/request-error', {
								error: failure.error,
								status: failure.status,
								attempt
							} satisfies RequestError)
						: undefined;

				if (!action) {
					for (const queued of pending) yield queued;
					yield {
						type: 'error',
						message:
							failure.error instanceof Error ? failure.error.message : String(failure.error),
						status: failure.status
					};
					failed = true;
					break;
				}

				attempt += 1;
				await new Promise((resolve) => setTimeout(resolve, action.delayMs));
				if (options.signal?.aborted) return;
			}

			if (failed) return;

			messages.push({
				role: 'assistant',
				content: text,
				...(calls.length ? { toolCalls: calls } : {})
			});

			if (!calls.length) {
				draft = text;

				// The turn is at its stop boundary. Anyone who objects gets one
				// more step to have it put right.
				const checked = this.ctx.listenerCount('agent/turn-stopping') > 0;
				if (checked) yield { type: 'review', status: 'checking', reasons: [] };

				const steers = await this.#checkpoint({
					turn: step,
					question,
					draft,
					record,
					signal: options.signal
				});

				if (!steers.length || revisions >= maxRevisions) {
					if (checked) yield { type: 'review', status: 'clean', reasons: [] };
					yield { type: 'done', messages, revised: revisions > 0 };
					return;
				}

				revisions += 1;
				yield {
					type: 'review',
					status: 'revising',
					reasons: steers.map((steer) => steer.reason)
				};

				messages.push({
					role: 'user',
					content: [
						'A check of that answer against what you actually did found the following.',
						'',
						...steers.map((steer) => `- ${steer.instruction}`),
						'',
						'Rewrite the answer so it is right. Do not mention this check, do not apologise, and do not describe what you are changing — just give the corrected answer. If fixing it needs a lookup you have not done, do it now.'
					].join('\n')
				});
				continue;
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

			record.push(...results);

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

	/**
	 * Run the stop-boundary checkpoint.
	 *
	 * Serial and awaited, with no `next()`: every listener sees the same turn
	 * and any one of them objecting is enough. Listeners that throw are
	 * ignored — a broken critic must not be able to end a good turn.
	 */
	async #checkpoint(payload: {
		turn: number;
		question: string;
		draft: string;
		record: readonly ToolResult[];
		signal?: AbortSignal;
	}): Promise<Steer[]> {
		const steers: Steer[] = [];
		const stopping: TurnStopping = {
			...payload,
			steer: (instruction, reason) => {
				steers.push({ instruction, reason });
			}
		};

		try {
			// Parallel rather than ordered: the contract is that data decides, so
			// no listener's position may change the outcome.
			await this.ctx.parallel('agent/turn-stopping', stopping);
		} catch (error) {
			console.error('[harness] turn-stopping checkpoint threw', error);
		}
		return steers;
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
