/**
 * What a listener is handed, versus what a reader is.
 *
 * The numbers here are the point: a realtime session pays for every token in
 * latency before she can start talking.
 */

import { describe, expect, it } from 'vitest';
import type { ToolRegistry } from '$lib/harness';
import { createHarness } from './index.js';

const live = process.env.LIVE === '1';

/**
 * One harness per modality.
 *
 * Sharing one would run the same call twice and the loop guard would — quite
 * correctly — refuse the second. The comparison needs two sessions, not one
 * session asked the same question twice.
 */
async function render(name: string, args: Record<string, unknown>, modality?: 'voice') {
	const ctx = await createHarness();
	const result = await ctx.require<ToolRegistry>('tools').execute({
		callId: '1',
		name,
		arguments: args as never,
		modality
	});
	ctx.dispose();
	return result.content.map((block) => block.text).join('\n');
}

async function both(name: string, args: Record<string, unknown>) {
	const [text, voice] = await Promise.all([render(name, args), render(name, args, 'voice')]);
	return { text, voice };
}

describe.skipIf(!live)('spoken tool output', () => {
	it('gives a listener a fraction of a section', async () => {
		const { text, voice } = await both('read_regulation', { title: 26, section: '1.274-5' });
		expect(text.length).toBeGreaterThan(6000);
		expect(voice.length).toBeLessThan(text.length / 3);
		// Nothing is invented: what survives is the regulation's own words.
		expect(voice).toContain('1.274-5');
	}, 60_000);

	it('never hands a listener a URL to read out', async () => {
		const { text, voice } = await both('read_regulation', { title: 26, section: '1.162-1' });
		expect(text).toContain('https://');
		expect(voice).not.toContain('https://');
	}, 60_000);

	it('drops the breadcrumbs from search results', async () => {
		const { text, voice } = await both('search_regulations', {
			query: 'substantiation requirements',
			title: 26,
			limit: 4
		});
		expect(text).toContain('Department of the Treasury');
		expect(voice).not.toContain('Department of the Treasury');
		// The citations survive, because they are the answer.
		expect(voice).toMatch(/26 CFR § 1\.274-5/);
	}, 60_000);

	it('leaves the reading rendering exactly as it was', async () => {
		const { text } = await both('search_regulations', { query: 'charitable', title: 26, limit: 2 });
		expect(text).toContain('›');
	}, 60_000);
});

describe('spoken output without the network', () => {
	it('falls back to the reading rendering for a tool with nothing shorter to say', async () => {
		const documents = [
			{ id: 'd', name: 'Memo', text: 'Client dinners are fully deductible.', kind: 'paste' as const }
		];
		const a = await createHarness({ documents });
		const b = await createHarness({ documents });
		const text = await a.require<ToolRegistry>('tools').execute({
			callId: '1',
			name: 'list_documents',
			arguments: {}
		});
		const voice = await b.require<ToolRegistry>('tools').execute({
			callId: '1',
			name: 'list_documents',
			arguments: {},
			modality: 'voice'
		});
		expect(voice.content).toEqual(text.content);
		a.dispose();
		b.dispose();
	});

	it('shortens a review for a listener', async () => {
		const documents = [
			{
				id: 'd',
				name: 'Memo',
				kind: 'paste' as const,
				text: 'Client dinners are fully deductible. The owner takes a minimal salary and the rest in distributions.'
			}
		];
		const a = await createHarness({ documents });
		const b = await createHarness({ documents });
		const text = await a
			.require<ToolRegistry>('tools')
			.execute({ callId: '1', name: 'review_document', arguments: {} });
		const voice = await b
			.require<ToolRegistry>('tools')
			.execute({ callId: '1', name: 'review_document', arguments: {}, modality: 'voice' });

		const textOut = text.content.map((block) => block.text).join('\n');
		const voiceOut = voice.content.map((block) => block.text).join('\n');
		expect(voiceOut.length).toBeLessThan(textOut.length);
		// The tool-call scaffolding a reader's model needs is not spoken.
		expect(textOut).toContain('search_regulations({');
		expect(voiceOut).not.toContain('search_regulations({');
		a.dispose();
		b.dispose();
	});
});
