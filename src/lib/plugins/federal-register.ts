/** Tools over the Federal Register: what is changing, and when it bites. */

import { defineTool, type Context, type ToolRegistry } from '$lib/harness';
import { AGENCIES, searchRuleChanges } from '$lib/sources/federal-register.js';

const AGENCY_KEYS = Object.keys(AGENCIES) as (keyof typeof AGENCIES)[];

export const federalRegisterPlugin = {
	name: 'source-federal-register',
	inject: ['tools'] as const,

	apply(ctx: Context) {
		ctx.require<ToolRegistry>('tools').register(
			defineTool({
				name: 'find_rule_changes',
				label: 'Checking the Federal Register',
				description: [
					'Search the Federal Register for rule-making: proposed rules, final rules and notices, with their publication and effective dates.',
					'The eCFR says what the rule is today; this says what is about to change.',
					'Reach for it whenever the question involves timing — "is this still current", "what changed this year", "when does it take effect", "is there a comment deadline" — or when the caller is relying on a treatment from a prior year.'
				].join(' '),
				parameters: {
					query: {
						type: 'string',
						required: true,
						description: 'Subject keywords, for example "bonus depreciation" or "auditor independence".'
					},
					agency: {
						type: 'string',
						enum: AGENCY_KEYS,
						description: 'Restrict to one agency. Omit to search across all of them.'
					},
					documentType: {
						type: 'string',
						enum: ['rule', 'proposed-rule', 'notice'] as const,
						description: 'Restrict to final rules, proposed rules, or notices.'
					},
					since: {
						type: 'string',
						description: 'Only documents published on or after this date, as YYYY-MM-DD.'
					},
					limit: {
						type: 'integer',
						minimum: 1,
						maximum: 12,
						description: 'How many documents to return. Defaults to 6.'
					}
				},
				output: {
					schema: {
						type: 'object',
						additionalProperties: false,
						properties: {
							query: { type: 'string', required: true },
							totalCount: { type: 'integer', required: true },
							changes: {
								type: 'array',
								required: true,
								items: {
									type: 'object',
									additionalProperties: false,
									properties: {
										title: { type: 'string', required: true },
										type: { type: 'string', required: true },
										agency: { type: 'string', required: true },
										publishedOn: { type: 'string', required: true },
										effectiveOn: { type: 'string' },
										url: { type: 'string', required: true },
										abstract: { type: 'string' },
										cfrReferences: { type: 'array', items: { type: 'string' } }
									}
								}
							}
						}
					},
					render: (args, value) => {
						if (!value.changes.length) {
							return [
								{
									type: 'text',
									text: `The Federal Register has nothing matching "${args.query}" under those filters. Consider widening the date range or dropping the agency filter.`
								}
							];
						}
						const lines = value.changes.map((change) => {
							const effective = change.effectiveOn
								? `effective ${change.effectiveOn}`
								: 'no effective date given';
							return [
								`• ${change.type} — ${change.title}`,
								`  ${change.agency}, published ${change.publishedOn}, ${effective}`,
								change.cfrReferences?.length ? `  Amends ${change.cfrReferences.join(', ')}` : null,
								change.abstract ? `  ${change.abstract.slice(0, 400)}` : null,
								`  ${change.url}`
							]
								.filter(Boolean)
								.join('\n');
						});
						return [
							{
								type: 'text',
								text: [
									`${value.totalCount} document(s) match "${args.query}". Most recent ${value.changes.length}:`,
									'',
									...lines
								].join('\n')
							}
						];
					},
					speak: (args, value) =>
						value.changes.length
							? [
									{
										type: 'text',
										text: [
											`${value.totalCount} documents match "${args.query}". Most recent:`,
											...value.changes.slice(0, 4).map((change) => {
												const when = change.effectiveOn
													? `effective ${change.effectiveOn}`
													: `published ${change.publishedOn}, no effective date`;
												return `• ${change.type}: ${change.title} — ${change.agency}, ${when}`;
											})
										].join('\n')
									}
								]
							: [{ type: 'text', text: `No rule-making matches "${args.query}".` }]
				},
				presentCall: (args) => ({
					card: 'search',
					title: args.agency ? AGENCIES[args.agency].name : 'Federal Register',
					query: args.query
				}),
				presentResult: (args, value) => ({
					card: 'changes',
					title: args.agency ? `${AGENCIES[args.agency].name} rule-making` : 'Recent rule-making',
					query: args.query,
					changes: value.changes
				}),
				async execute(args, exec) {
					const outcome = await searchRuleChanges({
						query: args.query,
						agency: args.agency,
						documentType: args.documentType,
						since: args.since,
						limit: args.limit,
						signal: exec.signal
					});
					return {
						query: args.query,
						totalCount: outcome.totalCount,
						changes: outcome.changes
					};
				}
			})
		);
	}
};
