/** Tools over the eCFR: find the provision, then read it. */

import { defineTool, type Context, type ToolRegistry } from '$lib/harness';
import { RELEVANT_TITLES, readSection, searchRegulations } from '$lib/sources/ecfr.js';
import { condenseSection } from '$lib/sources/condense.js';

const CITATION_SCHEMA = {
	type: 'object' as const,
	additionalProperties: false,
	properties: {
		citation: { type: 'string' as const, required: true as const },
		heading: { type: 'string' as const, required: true as const },
		hierarchy: { type: 'string' as const, required: true as const },
		url: { type: 'string' as const, required: true as const },
		excerpt: { type: 'string' as const },
		titleName: { type: 'string' as const }
	}
};

const TITLE_ENUM = RELEVANT_TITLES.map((title) => title.number);
const TITLE_GUIDE = RELEVANT_TITLES.map(
	(title) => `${title.number} (${title.name}: ${title.blurb})`
).join('; ');

export const ecfrPlugin = {
	name: 'source-ecfr',
	inject: ['tools'] as const,

	apply(ctx: Context) {
		const tools = ctx.require<ToolRegistry>('tools');

		tools.register(
			defineTool({
				name: 'search_regulations',
				label: 'Searching the eCFR',
				description: [
					'Search the current Code of Federal Regulations by keyword and return matching sections with citations.',
					'This is the first tool to reach for on any question about what a federal rule requires.',
					`Narrow with the title argument when the subject clearly belongs to one: ${TITLE_GUIDE}.`,
					'Search in the vocabulary of the regulation itself rather than the caller’s words: "ordinary and necessary business expense" finds more than "can I write off lunch".'
				].join(' '),
				parameters: {
					query: {
						type: 'string',
						required: true,
						description:
							'Two to five words of regulatory language. Longer queries match fewer sections, not more — prefer "business use of home" over "exclusive use home office principal place of business".'
					},
					title: {
						type: 'integer',
						enum: TITLE_ENUM,
						description: 'Restrict to one CFR title. Omit to search every title.'
					},
					limit: {
						type: 'integer',
						minimum: 1,
						maximum: 12,
						description: 'How many sections to return. Defaults to 6.'
					}
				},
				output: {
					schema: {
						type: 'object',
						additionalProperties: false,
						properties: {
							hits: { type: 'array', items: CITATION_SCHEMA, required: true },
							totalCount: { type: 'integer', required: true },
							query: { type: 'string', required: true }
						}
					},
					render: (args, value) => {
						if (!value.hits.length) {
							return [
								{
									type: 'text',
									text: [
										`No CFR section matched "${args.query}".`,
										'Shorten the query — the index matches phrases, so three or four words find far more than eight.',
										'Try the core legal term on its own ("business use of home", "exclusive use"), and drop the title filter if that still returns nothing.'
									].join(' ')
								}
							];
						}
						const lines = value.hits.map(
							(hit, index) =>
								`${index + 1}. ${hit.citation} — ${hit.heading}\n   ${hit.hierarchy}\n   ${hit.excerpt ?? 'No excerpt available.'}`
						);
						return [
							{
								type: 'text',
								text: [
									`${value.totalCount} section(s) match "${args.query}". Showing ${value.hits.length}:`,
									'',
									...lines,
									'',
									'Call read_regulation on the most relevant citation before advising on it — these are excerpts, not the operative text.'
								].join('\n')
							}
						];
					},
					// Spoken: the citation and what it is called. A breadcrumb read
					// aloud is forty words of Department of the Treasury, and a URL
					// read aloud is worse.
					speak: (args, value) =>
						value.hits.length
							? [
									{
										type: 'text',
										text: [
											`${value.totalCount} sections match "${args.query}". The closest:`,
											...value.hits
												.slice(0, 4)
												.map((hit, index) => `${index + 1}. ${hit.citation} — ${hit.heading}`),
											'Read one before saying what it requires.'
										].join('\n')
									}
								]
							: [
									{
										type: 'text',
										text: `Nothing matched "${args.query}". Try three or four words of the regulation's own language.`
									}
								]
				},
				presentCall: (args) => ({
					card: 'search',
					title: args.title ? `Title ${args.title}` : 'All CFR titles',
					query: args.query
				}),
				presentResult: (args, value) => ({
					card: 'results',
					title: args.title ? `Title ${args.title} results` : 'eCFR results',
					query: args.query,
					hits: value.hits,
					truncated: value.totalCount > value.hits.length
				}),
				async execute(args, exec) {
					const outcome = await searchRegulations({
						query: args.query,
						title: args.title,
						limit: args.limit,
						signal: exec.signal
					});
					return { hits: outcome.hits, totalCount: outcome.totalCount, query: args.query };
				}
			})
		);

		tools.register(
			defineTool({
				name: 'read_regulation',
				label: 'Reading the regulation',
				description: [
					'Read the full current text of one CFR section, straight from the eCFR.',
					'Use it before stating what a rule requires — a search excerpt is not the operative text.',
					'The section argument is the number as it appears in the citation: "1.162-1" for 26 CFR § 1.162-1, "210.4-08" for 17 CFR § 210.4-08.'
				].join(' '),
				parameters: {
					title: {
						type: 'integer',
						required: true,
						description: 'The CFR title number, for example 26 for the Treasury regulations.'
					},
					section: {
						type: 'string',
						required: true,
						description: 'The section number without the section sign, for example "1.162-1".'
					}
				},
				output: {
					schema: {
						type: 'object',
						additionalProperties: false,
						properties: {
							section: { ...CITATION_SCHEMA, required: true },
							body: { type: 'string', required: true },
							truncated: { type: 'boolean', required: true }
						}
					},
					render: (_args, value) => [
						{
							type: 'text',
							text: [
								`${value.section.citation} — ${value.section.heading}`,
								value.section.url,
								'',
								value.body,
								value.truncated
									? '\n[The section was truncated. Read the linked source for the remainder.]'
									: ''
							]
								.join('\n')
								.trim()
						}
					],
					/**
					 * Spoken: a section runs to twelve thousand characters, a third
					 * of it cross-references. All of that has to be swallowed before
					 * she can begin talking, and none of it can be said out loud.
					 * Nothing is paraphrased — reserved runs collapse to a pointer
					 * and the cut is declared, so she offers the rest rather than
					 * pretending she read it.
					 */
					speak: (_args, value) => {
						const condensed = condenseSection(value.body);
						return [
							{
								type: 'text',
								text: [
									`${value.section.citation} — ${value.section.heading}`,
									'',
									condensed.text,
									condensed.truncated || value.truncated
										? '\n[Shortened. Say so if the caller needs a part you cannot see, and read it again.]'
										: ''
								]
									.join('\n')
									.trim()
							}
						];
					}
				},
				presentCall: (args) => ({
					card: 'regulation',
					title: 'Reading',
					citation: `${args.title} CFR § ${args.section}`
				}),
				presentResult: (_args, value) => ({
					card: 'regulation',
					title: value.section.citation,
					section: value.section,
					body: value.body
				}),
				async execute(args, exec) {
					const outcome = await readSection({
						title: args.title,
						section: args.section,
						signal: exec.signal
					});
					return {
						section: outcome.citation,
						body: outcome.body,
						truncated: outcome.truncated
					};
				}
			})
		);
	}
};
