import { describe, expect, it, vi } from 'vitest';
import { Context } from './context.js';
import { agentPlugin, type AgentEvent, type AgentService } from './agent.js';
import { llmPlugin, ProviderError, type LLMAdapter, type LLMService } from './llm.js';
import { defineTool, toolsPlugin, type ToolRegistry } from './tools.js';
import { deadlinePlugin, retryPlugin } from './resilience.js';

/** Fails a set number of times, then succeeds. */
function flakyAdapter(failures: number, error: () => unknown): LLMAdapter {
	let seen = 0;
	return {
		id: 'flaky',
		async *stream() {
			if (seen++ < failures) throw error();
			yield { type: 'text-delta' as const, text: 'recovered' };
			yield { type: 'done' as const, finishReason: 'stop' as const };
		}
	};
}

async function run(adapter: LLMAdapter, withRetry = true) {
	const ctx = new Context();
	await ctx.use(toolsPlugin, llmPlugin, agentPlugin);
	if (withRetry) await ctx.plugin(retryPlugin);
	ctx.require<LLMService>('llm').register(adapter);

	const events: AgentEvent[] = [];
	let text = '';
	for await (const event of ctx.require<AgentService>('agent').run({
		messages: [{ role: 'user', content: 'hello' }],
		apiKey: 'sk-test',
		model: 'test'
	})) {
		events.push(event);
		if (event.type === 'text') text += event.delta;
	}
	ctx.dispose();
	return { events, text };
}

describe('retryPlugin', () => {
	it('rides out a rate limit', async () => {
		const { text, events } = await run(flakyAdapter(1, () => new ProviderError('slow down', 429)));
		expect(text).toBe('recovered');
		expect(events.some((event) => event.type === 'error')).toBe(false);
	}, 20_000);

	it('rides out a network failure with no status at all', async () => {
		const { text } = await run(flakyAdapter(1, () => new Error('fetch failed')));
		expect(text).toBe('recovered');
	}, 20_000);

	it('does not retry a rejected key', async () => {
		const { text, events } = await run(
			flakyAdapter(1, () => new ProviderError('bad key', 401))
		);
		expect(text).toBe('');
		const failure = events.find((event) => event.type === 'error') as { status?: number };
		expect(failure.status).toBe(401);
	});

	it('gives up after two attempts', async () => {
		const { events } = await run(flakyAdapter(9, () => new ProviderError('down', 503)));
		expect(events.some((event) => event.type === 'error')).toBe(true);
	}, 20_000);

	it('surfaces the failure when nothing is retrying', async () => {
		const { events } = await run(flakyAdapter(1, () => new ProviderError('slow down', 429)), false);
		expect(events.some((event) => event.type === 'error')).toBe(true);
	});

	it('never prints a partial answer twice', async () => {
		// Fails after emitting text: replaying would repeat what was shown.
		let call = 0;
		const adapter: LLMAdapter = {
			id: 'half',
			async *stream() {
				call += 1;
				yield { type: 'text-delta' as const, text: 'half an answer' };
				if (call === 1) throw new ProviderError('dropped', 503);
				yield { type: 'done' as const, finishReason: 'stop' as const };
			}
		};
		const { text } = await run(adapter);
		expect(text).toBe('half an answer');
		expect(call).toBe(1);
	});
});

describe('deadlinePlugin', () => {
	it('fails a wedged tool with something the model can act on', async () => {
		vi.useFakeTimers();
		try {
			const ctx = new Context();
			await ctx.plugin(toolsPlugin);
			await ctx.plugin(deadlinePlugin(1000));

			const tools = ctx.require<ToolRegistry>('tools');
			tools.register(
				defineTool({
					name: 'wedged',
					description: 'Never returns.',
					parameters: {},
					output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: '' }] },
					execute: () => new Promise<string>(() => {})
				})
			);

			const pending = tools.execute({ callId: '1', name: 'wedged', arguments: {} });
			await vi.advanceTimersByTimeAsync(1200);
			const result = await pending;

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toMatch(/did not finish within 1 second/);
		} finally {
			vi.useRealTimers();
		}
	});

	it('leaves a tool that answers in time alone', async () => {
		const ctx = new Context();
		await ctx.plugin(toolsPlugin);
		await ctx.plugin(deadlinePlugin(5000));

		const tools = ctx.require<ToolRegistry>('tools');
		tools.register(
			defineTool({
				name: 'quick',
				description: 'Answers.',
				parameters: {},
				output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
				execute: () => 'done'
			})
		);

		const result = await tools.execute({ callId: '1', name: 'quick', arguments: {} });
		expect(result.isError).toBe(false);
		expect(result.value).toBe('done');
		ctx.dispose();
	});
});
