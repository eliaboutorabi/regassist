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
