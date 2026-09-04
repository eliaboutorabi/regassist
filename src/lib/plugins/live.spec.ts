/**
 * Live integration checks against the real public APIs and a real OpenAI key.
 *
 * Skipped unless `LIVE=1`, because they cost network time and (for the agent
 * case) tokens. Run with:
 *
 *   LIVE=1 npx vitest run --project server src/lib/plugins/live.spec.ts
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, type AgentEvent, type AgentService, type ToolRegistry } from '$lib/harness';
import { TEXT_INSTRUCTIONS } from '$lib/prompts.js';
import { createHarness } from './index.js';

const live = process.env.LIVE === '1';
const apiKey = process.env.OPENAI_API_KEY ?? '';

describe.skipIf(!live)('live regulation sources', () => {
	it('finds real CFR sections for a tax question', async () => {
		const ctx = await createHarness();
		const result = await ctx.require<ToolRegistry>('tools').execute({
			callId: '1',
			name: 'search_regulations',
			arguments: { query: 'ordinary and necessary business expenses', title: 26, limit: 3 }
		});

		expect(result.isError).toBe(false);
		const view = result.view as { hits: { citation: string; url: string }[] };
		expect(view.hits.length).toBeGreaterThan(0);
		expect(view.hits[0].citation).toMatch(/^26 CFR/);
		expect(view.hits[0].url).toContain('ecfr.gov');
		ctx.dispose();
	}, 40_000);

	it('reads the full text of a known section', async () => {
		const ctx = await createHarness();
		const result = await ctx.require<ToolRegistry>('tools').execute({
			callId: '1',
			name: 'read_regulation',
			arguments: { title: 26, section: '1.162-1' }
		});

		expect(result.isError).toBe(false);
		const view = result.view as { body: string; section: { citation: string } };
		expect(view.section.citation).toBe('26 CFR § 1.162-1');
		expect(view.body.toLowerCase()).toContain('ordinary and necessary');
		ctx.dispose();
	}, 60_000);

	it('reports a helpful error for a section that does not exist', async () => {
		const ctx = await createHarness();
		const result = await ctx.require<ToolRegistry>('tools').execute({
			callId: '1',
			name: 'read_regulation',
			arguments: { title: 26, section: '1.999999-42' }
		});
		expect(result.isError).toBe(true);
		ctx.dispose();
	}, 60_000);

	it('finds recent IRS rule-making', async () => {
		const ctx = await createHarness();
		const result = await ctx.require<ToolRegistry>('tools').execute({
			callId: '1',
			name: 'find_rule_changes',
			arguments: { query: 'depreciation', agency: 'irs', limit: 3 }
		});

		expect(result.isError).toBe(false);
		const view = result.view as { changes: { url: string; publishedOn: string }[] };
		expect(view.changes.length).toBeGreaterThan(0);
		expect(view.changes[0].url).toContain('federalregister.gov');
		ctx.dispose();
	}, 40_000);
});

describe.skipIf(!live || !apiKey)('live agent loop', () => {
	it('answers a regulation question by calling tools and citing what it read', async () => {
		const ctx = await createHarness();
		const agent = ctx.require<AgentService>('agent');

		const events: AgentEvent[] = [];
		let answer = '';
		for await (const event of agent.run({
			apiKey,
			model: DEFAULT_MODEL,
			messages: [
				{ role: 'system', content: TEXT_INSTRUCTIONS },
				{
					role: 'user',
					content: 'What does the CFR require for an expense to be deductible as a business expense?'
				}
			]
		})) {
			events.push(event);
			if (event.type === 'text') answer += event.delta;
		}

		const toolCalls = events.filter((event) => event.type === 'tool-call');
		const errors = events.filter((event) => event.type === 'error');

		expect(errors).toEqual([]);
		expect(toolCalls.length).toBeGreaterThan(0);
		expect(answer).toMatch(/CFR/);
		ctx.dispose();
	}, 180_000);

	it('reviews a loaded document and follows the findings into the regulation', async () => {
		const ctx = await createHarness({
			documents: [
				{
					id: 'memo',
					name: 'Client memo',
					kind: 'paste',
					text: 'Per our discussion: all client dinners are fully deductible, and we will treat the two site workers as independent contractors on 1099 basis. This position is guaranteed to survive audit.'
				}
			]
		});
		const agent = ctx.require<AgentService>('agent');

		const called: string[] = [];
		let answer = '';
		for await (const event of agent.run({
			apiKey,
			model: DEFAULT_MODEL,
			messages: [
				{ role: 'system', content: TEXT_INSTRUCTIONS },
				{ role: 'user', content: 'Review the memo I loaded and tell me what worries you.' }
			]
		})) {
			if (event.type === 'tool-call') called.push(event.name);
			if (event.type === 'text') answer += event.delta;
			if (event.type === 'error') throw new Error(event.message);
		}

		expect(called).toContain('review_document');
		expect(called.some((name) => name.startsWith('search_') || name.startsWith('read_'))).toBe(true);
		expect(answer.length).toBeGreaterThan(120);
		ctx.dispose();
	}, 240_000);
});
