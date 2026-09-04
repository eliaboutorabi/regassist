import { describe, expect, it } from 'vitest';
import { Context, type ToolRegistry } from '$lib/harness';
import { xmlToText } from '$lib/sources/ecfr.js';
import { createHarness } from './index.js';
import { DocumentStore, documentsPlugin } from './documents.js';
import { REVIEW_RULES, scanDocument } from './review-rules.js';

describe('review rule pack', () => {
	it('gives every rule a unique id', () => {
		const ids = REVIEW_RULES.map((rule) => rule.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('flags an unqualified deductibility claim and quotes the sentence', () => {
		const findings = scanDocument(
			'We reviewed the ledger. Client meals are fully deductible against trading income. Invoices are on file.'
		);
		const finding = findings.find((match) => match.rule.id === 'absolute-deductibility');
		expect(finding).toBeDefined();
		expect(finding!.quote).toContain('fully deductible');
		expect(finding!.quote).not.toContain('Invoices are on file');
	});

	it('reports one finding per rule however often the phrase recurs', () => {
		const text = 'independent contractor. '.repeat(20);
		const matches = scanDocument(text).filter((m) => m.rule.id === 'worker-classification');
		expect(matches).toHaveLength(1);
	});

	it('orders findings by severity before position', () => {
		const findings = scanDocument(
			'State nexus is unclear. Separately, the arrangement is guaranteed to survive audit.'
		);
		expect(findings[0].rule.severity).toBe('high');
		expect(findings.at(-1)!.rule.severity).toBe('info');
	});

	it('returns nothing for prose with no regulatory trigger', () => {
		expect(scanDocument('The quarterly meeting is on Tuesday in the small conference room.')).toEqual(
			[]
		);
	});

	it('does not split a quote on a decimal point in a citation', () => {
		const findings = scanDocument('Treat it under 26 CFR 1.162-1 as fully deductible today.');
		expect(findings[0].quote).toContain('1.162-1');
	});
});

describe('eCFR XML flattening', () => {
	it('keeps paragraph structure and drops presentation markup', () => {
		const xml =
			'<DIV8><HEAD>§ 1.162-1 Business expenses.</HEAD><P>(a) <I>In general.</I> Costs are &amp; deductible.</P><P>(b) Second point.</P></DIV8>';
		expect(xmlToText(xml)).toBe(
			'§ 1.162-1 Business expenses.\n\n(a) In general. Costs are & deductible.\n\n(b) Second point.'
		);
	});

	it('returns an empty string for an empty document rather than throwing', () => {
		expect(xmlToText('<DIV8></DIV8>')).toBe('');
	});
});

describe('DocumentStore', () => {
	async function store() {
		const ctx = new Context();
		await ctx.plugin(documentsPlugin);
		return { ctx, documents: ctx.require<DocumentStore>('documents') };
	}

	it('resolves the only loaded document without a reference', async () => {
		const { ctx, documents } = await store();
		documents.put({ id: 'a', name: 'Engagement letter', text: 'x', kind: 'paste' });
		expect(documents.resolve()?.id).toBe('a');
		ctx.dispose();
	});

	it('will not guess when several documents are loaded', async () => {
		const { ctx, documents } = await store();
		documents.put({ id: 'a', name: 'A', text: 'x', kind: 'paste' });
		documents.put({ id: 'b', name: 'B', text: 'y', kind: 'paste' });
		expect(documents.resolve()).toBeUndefined();
		ctx.dispose();
	});

	it('resolves by name and by partial name', async () => {
		const { ctx, documents } = await store();
		documents.put({ id: 'a', name: 'Engagement letter', text: 'x', kind: 'paste' });
		documents.put({ id: 'b', name: 'Tax memo', text: 'y', kind: 'paste' });
		expect(documents.resolve('Tax memo')?.id).toBe('b');
		expect(documents.resolve('engagement')?.id).toBe('a');
		ctx.dispose();
	});
});

describe('harness assembly', () => {
	it('registers every regulation tool with a model-facing schema', async () => {
		const ctx = await createHarness();
		const schemas = ctx.require<ToolRegistry>('tools').schemas();
		const names = schemas.map((schema) => schema.name).sort();

		expect(names).toEqual([
			'find_rule_changes',
			'list_documents',
			'read_regulation',
			'review_document',
			'search_regulations'
		]);
		for (const schema of schemas) {
			expect(schema.description.length).toBeGreaterThan(40);
			expect(schema.parameters).toHaveProperty('type', 'object');
		}
		ctx.dispose();
	});

	it('surfaces a helpful error when review runs with no document loaded', async () => {
		const ctx = await createHarness();
		const result = await ctx.require<ToolRegistry>('tools').execute({
			callId: '1',
			name: 'review_document',
			arguments: {}
		});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/No document is loaded/);
		ctx.dispose();
	});

	it('reviews a loaded document end to end', async () => {
		const ctx = await createHarness({
			documents: [
				{
					id: 'memo',
					name: 'Client memo',
					kind: 'paste',
					text: 'The owner takes a minimal salary and the rest in distributions. Client meals are fully deductible.'
				}
			]
		});
		const result = await ctx.require<ToolRegistry>('tools').execute({
			callId: '1',
			name: 'review_document',
			arguments: {}
		});

		expect(result.isError).toBe(false);
		const view = result.view;
		expect(view?.card).toBe('review');
		const topics = (view as { findings: { topic: string }[] }).findings.map((f) => f.topic);
		expect(topics).toContain('Reasonable compensation');
		expect(topics).toContain('Unqualified deductibility claim');
		ctx.dispose();
	});
});

describe('loop guard', () => {
	/** review_document is entirely local, so the guard is testable offline. */
	async function localHarness() {
		return createHarness({
			documents: [
				{ id: 'memo', name: 'Memo', kind: 'paste', text: 'Client meals are fully deductible.' }
			]
		});
	}

	it('refuses an identical repeat and says what to do instead', async () => {
		const ctx = await localHarness();
		const tools = ctx.require<ToolRegistry>('tools');
		const call = { name: 'review_document', arguments: { document: 'memo' } };

		const first = await tools.execute({ callId: '1', ...call });
		const second = await tools.execute({ callId: '2', ...call });

		expect(first.isError).toBe(false);
		expect(second.isError).toBe(true);
		expect(second.content[0].text).toMatch(/already ran review_document/);
		ctx.dispose();
	});

	it('treats a differently-cased or spaced argument as the same call', async () => {
		const ctx = await localHarness();
		const tools = ctx.require<ToolRegistry>('tools');

		await tools.execute({ callId: '1', name: 'review_document', arguments: { document: 'memo' } });
		const repeat = await tools.execute({
			callId: '2',
			name: 'review_document',
			arguments: { document: '  MEMO  ' }
		});

		expect(repeat.isError).toBe(true);
		ctx.dispose();
	});

	it('does not confuse two different queries', async () => {
		const ctx = await localHarness();
		const tools = ctx.require<ToolRegistry>('tools');

		const first = await tools.execute({
			callId: '1',
			name: 'review_document',
			arguments: { document: 'memo' }
		});
		const second = await tools.execute({
			callId: '2',
			name: 'review_document',
			arguments: { document: 'memo', minSeverity: 'high' }
		});

		expect(first.isError).toBe(false);
		expect(second.isError).toBe(false);
		ctx.dispose();
	});

	it('lets a cheap local tool repeat freely', async () => {
		const ctx = await createHarness();
		const tools = ctx.require<ToolRegistry>('tools');

		const first = await tools.execute({ callId: '1', name: 'list_documents', arguments: {} });
		const second = await tools.execute({ callId: '2', name: 'list_documents', arguments: {} });

		expect(first.isError).toBe(false);
		expect(second.isError).toBe(false);
		ctx.dispose();
	});
});

describe('eCFR citation guidance', () => {
	it('rejects a part number with an explanation the model can act on', async () => {
		const ctx = await createHarness();
		const result = await ctx.require<ToolRegistry>('tools').execute({
			callId: '1',
			name: 'read_regulation',
			arguments: { title: 26, section: '280A' }
		});

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/part number, not a section number/);
		ctx.dispose();
	});
});
