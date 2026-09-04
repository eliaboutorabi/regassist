/**
 * A second pair of eyes on the answer.
 *
 * The mechanical check in `verify.ts` catches what can be proved wrong from
 * the turn's own record — an invented citation, a claimed action nobody took.
 * This catches the rest: an answer that is true but does not answer, a
 * qualification the source carried and the answer dropped, a confident
 * sentence resting on a section that says something narrower.
 *
 * One call, a cheap model, and a hard requirement that every objection be
 * specific enough to act on. A critic that says "consider adding more detail"
 * costs a round trip and buys nothing, so the prompt refuses that shape and
 * the parser drops anything that comes back vague anyway.
 */

import type { Context, LLMService, ToolResult, TurnStopping } from '$lib/harness';
import type { Credentials } from './index.js';

/**
 * Deliberately small. This is a reading-comprehension task against text that
 * is already in front of it, not a research task, and a slow check would just
 * make every answer late.
 */
const CRITIC_MODEL = 'gpt-5.4-mini';

/** Enough of the record to judge against, without resending whole sections. */
const PER_RESULT_CHARS = 1400;
const MAX_RESULTS = 12;

function digest(record: readonly ToolResult[]): string {
	if (!record.length) return '(no tools were called this turn)';

	return record
		.slice(0, MAX_RESULTS)
		.map((result, index) => {
			const text = result.content
				.map((block) => block.text)
				.join('\n')
				.slice(0, PER_RESULT_CHARS);
			const status = result.isError ? 'FAILED' : 'ok';
			return `[${index + 1}] ${result.name} (${status})\n${text}`;
		})
		.join('\n\n');
}

const INSTRUCTIONS = `You are checking another assistant's draft answer before a user sees it.

The assistant researches federal regulations. It has just produced a draft, and you can see every tool result it had. Your only job is to find defects that the tool results themselves prove.

Report a defect only when it is all three of:
  - **specific** — you can name the sentence or the citation at fault;
  - **grounded** — the tool results show it is wrong, missing, or overstated;
  - **actionable** — you can say what the corrected answer should do.

Things that are defects:
  - a statement the tool results contradict, or do not support at all;
  - a condition, limit, exception or date the source carries and the answer drops;
  - a citation attached to a claim it does not actually support;
  - the user's actual question going unanswered while adjacent material is explained;
  - confident phrasing over something the lookups left unresolved.

Things that are NOT defects, and must never be reported:
  - the answer being short, or long, or plainly written;
  - a suggestion to add caveats, context, examples or next steps;
  - a preference about tone, structure or formatting;
  - anything you would need to look up yourself to check;
  - the answer declining to give tax advice — that is correct behaviour.

Most drafts are fine. Returning an empty list is the normal outcome and is the right answer whenever you are not sure.

Reply with JSON only, in this shape:
{"defects":[{"problem":"<what is wrong, one sentence>","fix":"<what the corrected answer should do, one sentence>"}]}`;

interface Defect {
	problem: string;
	fix: string;
}

/** Parse the critic's reply, keeping only objections worth acting on. */
export function parseDefects(raw: string): Defect[] {
	const start = raw.indexOf('{');
	const end = raw.lastIndexOf('}');
	if (start === -1 || end <= start) return [];

	let parsed: { defects?: unknown };
	try {
		parsed = JSON.parse(raw.slice(start, end + 1)) as { defects?: unknown };
	} catch {
		return [];
	}
	if (!Array.isArray(parsed.defects)) return [];

	return parsed.defects
		.flatMap((entry) => {
			if (typeof entry !== 'object' || entry === null) return [];
			const { problem, fix } = entry as Record<string, unknown>;
			if (typeof problem !== 'string' || typeof fix !== 'string') return [];
			const trimmedProblem = problem.trim();
			const trimmedFix = fix.trim();
			// A one-word objection is noise however confidently it is phrased.
			if (trimmedProblem.length < 20 || trimmedFix.length < 15) return [];
			return [{ problem: trimmedProblem, fix: trimmedFix }];
		})
		// Two is the most a single rewrite can act on properly.
		.slice(0, 2);
}

export const criticPlugin = {
	name: 'critic',
	inject: ['llm', 'credentials'] as const,

	apply(ctx: Context) {
		const llm = ctx.require<LLMService>('llm');
		const credentials = ctx.require<Credentials>('credentials');

		return ctx.on('agent/turn-stopping', async (stopping: TurnStopping) => {
			// Nothing to check against, and nothing that could be contradicted.
			if (!stopping.draft.trim() || !stopping.record.length) return;

			const request = [
				`## The user asked\n\n${stopping.question}`,
				`## What the tools returned\n\n${digest(stopping.record)}`,
				`## The draft answer\n\n${stopping.draft}`
			].join('\n\n');

			let reply = '';
			try {
				const stream = llm.stream({
					messages: [
						{ role: 'system', content: INSTRUCTIONS },
						{ role: 'user', content: request }
					],
					tools: [],
					model: CRITIC_MODEL,
					apiKey: credentials.apiKey,
					signal: stopping.signal,
					maxOutputTokens: 700
				});

				for await (const event of stream) {
					if (event.type === 'text-delta') reply += event.text;
					if (event.type === 'error') return;
				}
			} catch {
				// A critic that cannot run must not be able to stop a good answer.
				return;
			}

			for (const defect of parseDefects(reply)) {
				stopping.steer(`${defect.problem} ${defect.fix}`, defect.problem);
			}
		});
	}
};
