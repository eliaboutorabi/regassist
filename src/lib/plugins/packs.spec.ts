import { describe, expect, it } from 'vitest';
import type { ToolRegistry } from '$lib/harness';
import { createHarness } from './index.js';

async function names(packs?: readonly ('ecfr' | 'federal-register' | 'review')[]) {
	const ctx = await createHarness({ packs });
	const list = ctx.require<ToolRegistry>('tools').names().sort();
	ctx.dispose();
	return list;
}

describe('tool packs', () => {
	it('mounts everything by default, including markup', async () => {
		expect(await names()).toEqual([
			'find_rule_changes',
			'highlight_document',
			'list_documents',
			'read_regulation',
			'review_document',
			'search_regulations'
		]);
	});

	it('withholds the review pack when its skill is off', async () => {
		const list = await names(['ecfr']);
		expect(list).not.toContain('review_document');
		expect(list).not.toContain('highlight_document');
		expect(list).toContain('search_regulations');
	});

	it('withholds rule-change lookups when that skill is off', async () => {
		expect(await names(['ecfr', 'review'])).not.toContain('find_rule_changes');
	});

	it('always keeps the CFR, whatever is asked for', async () => {
		expect(await names([])).toContain('search_regulations');
	});
});

describe('the loop guard across stateless calls', () => {
	const call = {
		name: 'review_document',
		arguments: { document: 'memo' }
	} as const;

	const documents = [
		{ id: 'memo', name: 'memo', kind: 'paste' as const, text: 'Client dinners are fully deductible.' }
	];

	it('refuses a repeat the caller already made in an earlier request', async () => {
		// Each voice tool call is its own request with its own context, so the
		// guard only knows what the client tells it.
		const ctx = await createHarness({ documents, priorCalls: [call] });
		const result = await ctx
			.require<ToolRegistry>('tools')
			.execute({ callId: '1', ...call });

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/already ran review_document/);
		ctx.dispose();
	});

	it('allows a call the conversation has not made', async () => {
		const ctx = await createHarness({
			documents,
			priorCalls: [{ name: 'review_document', arguments: { document: 'something else' } }]
		});
		const result = await ctx.require<ToolRegistry>('tools').execute({ callId: '1', ...call });
		expect(result.isError).toBe(false);
		ctx.dispose();
	});

	it('starts empty when no history is supplied', async () => {
		const ctx = await createHarness({ documents });
		const result = await ctx.require<ToolRegistry>('tools').execute({ callId: '1', ...call });
		expect(result.isError).toBe(false);
		ctx.dispose();
	});

	it('never blocks the cheap local tools, however often they repeat', async () => {
		const ctx = await createHarness({
			documents,
			priorCalls: [{ name: 'list_documents', arguments: {} }]
		});
		const result = await ctx
			.require<ToolRegistry>('tools')
			.execute({ callId: '1', name: 'list_documents', arguments: {} });
		expect(result.isError).toBe(false);
		ctx.dispose();
	});
})
