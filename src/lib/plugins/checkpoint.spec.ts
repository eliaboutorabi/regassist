/**
 * The stop-boundary checkpoint, end to end.
 *
 * Uses a scripted LLM adapter rather than a real one: the point is that an
 * objection reopens the turn and the corrected answer is what comes out, and
 * that needs no model to demonstrate.
 */

import { describe, expect, it } from 'vitest';
import {
	agentPlugin,
	Context,
	llmPlugin,
	toolsPlugin,
	type AgentEvent,
	type AgentService,
	type LLMAdapter,
	type LLMService,
	type TurnStopping
} from '$lib/harness';

/** Replies in order, one per request. */
function scriptedAdapter(replies: string[]): LLMAdapter {
	let call = 0;
	return {
		id: 'scripted',
		async *stream() {
			const text = replies[Math.min(call++, replies.length - 1)];
			yield { type: 'text-delta' as const, text };
			yield { type: 'done' as const, finishReason: 'stop' as const };
		}
	};
}

async function harness(replies: string[]) {
	const ctx = new Context();
	await ctx.use(toolsPlugin, llmPlugin, agentPlugin);
	ctx.require<LLMService>('llm').register(scriptedAdapter(replies));
	return ctx;
}

async function drain(ctx: Context) {
	const events: AgentEvent[] = [];
	let text = '';
	for await (const event of ctx.require<AgentService>('agent').run({
		messages: [{ role: 'user', content: 'what is the rule?' }],
		apiKey: 'sk-test',
		model: 'test'
	})) {
		events.push(event);
		if (event.type === 'text') text += event.delta;
	}
	return { events, text };
}

describe('agent/turn-stopping', () => {
	it('closes the turn when nobody objects', async () => {
		const ctx = await harness(['The answer.']);
		ctx.on('agent/turn-stopping', () => {});

		const { events, text } = await drain(ctx);
		expect(text).toBe('The answer.');
		expect(
			events.filter((event) => event.type === 'review').map((event) => event.status)
		).toEqual(['checking', 'clean']);
		ctx.dispose();
	});

	it('reopens the turn when a listener objects, and yields the correction', async () => {
		const ctx = await harness(['A wrong answer.', 'A corrected answer.']);
		let objected = false;
		ctx.on('agent/turn-stopping', (stopping: TurnStopping) => {
			if (objected) return;
			objected = true;
			stopping.steer('Fix the citation.', 'cited something it never read');
		});

		const { events, text } = await drain(ctx);
		expect(text).toBe('A wrong answer.A corrected answer.');

		const review = events.filter((event) => event.type === 'review');
		expect(review.map((event) => event.status)).toEqual([
			'checking',
			'revising',
			'checking',
			'clean'
		]);
		expect((review[1] as { reasons: string[] }).reasons).toEqual([
			'cited something it never read'
		]);
		expect((events.find((event) => event.type === 'done') as { revised: boolean }).revised).toBe(
			true
		);
		ctx.dispose();
	});

	it('revises at most once, however stubborn the critic', async () => {
		const ctx = await harness(['One.', 'Two.', 'Three.']);
		ctx.on('agent/turn-stopping', (stopping: TurnStopping) => {
			stopping.steer('Still wrong.', 'never satisfied');
		});

		const { text } = await drain(ctx);
		// Two model calls, not three: the loop does not argue with its critic.
		expect(text).toBe('One.Two.');
		ctx.dispose();
	});

	it('a listener that throws cannot end a good turn', async () => {
		const ctx = await harness(['The answer.']);
		ctx.on('agent/turn-stopping', () => {
			throw new Error('the critic exploded');
		});

		const { text, events } = await drain(ctx);
		expect(text).toBe('The answer.');
		expect(events.some((event) => event.type === 'error')).toBe(false);
		ctx.dispose();
	});

	it('says nothing about checking when nothing is listening', async () => {
		const ctx = await harness(['The answer.']);
		const { events } = await drain(ctx);
		expect(events.some((event) => event.type === 'review')).toBe(false);
		ctx.dispose();
	});

	it('gives the checkpoint the question and the draft', async () => {
		const ctx = await harness(['The answer.']);
		let seen: TurnStopping | null = null;
		ctx.on('agent/turn-stopping', (stopping: TurnStopping) => {
			seen = stopping;
		});

		await drain(ctx);
		expect(seen).not.toBeNull();
		expect(seen!.question).toBe('what is the rule?');
		expect(seen!.draft).toBe('The answer.');
		ctx.dispose();
	});
});
