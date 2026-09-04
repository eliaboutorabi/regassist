/**
 * Stops a model from asking the same question twice.
 *
 * A research agent that gets a thin result often rephrases and tries again,
 * which is usually the right instinct — but it can also settle into re-running
 * a query it has already run, burning steps without new information. This
 * refuses the exact repeat and tells the model what to do instead, which is
 * more useful to it than another identical result would be.
 *
 * It is a plain `tools/pre-execute` listener, so it composes with any other
 * policy and unwinds with its plugin.
 */

import type { Context } from '$lib/harness';
import type { JsonValue } from '$lib/harness';

/** Repeats of these are harmless — they are cheap and locally computed. */
const EXEMPT = new Set(['list_documents']);

function fingerprint(name: string, args: Record<string, JsonValue>): string {
	const normalised = Object.entries(args)
		.filter(([, value]) => value !== undefined && value !== null)
		.map(([key, value]) => [key, typeof value === 'string' ? value.trim().toLowerCase() : value])
		.sort(([a], [b]) => String(a).localeCompare(String(b)));
	return `${name}:${JSON.stringify(normalised)}`;
}

export const loopGuardPlugin = {
	name: 'loop-guard',
	inject: ['tools'] as const,

	apply(ctx: Context) {
		const seen = new Set<string>();

		return ctx.on(
			'tools/pre-execute',
			({ name, args }: { name: string; args: Record<string, JsonValue> }) => {
				if (EXEMPT.has(name)) return undefined;

				const key = fingerprint(name, args);
				if (!seen.has(key)) {
					seen.add(key);
					return undefined;
				}

				return {
					deny: `you already ran ${name} with these exact arguments in this session. Use the result you already have. If it was not enough, change the query substantially — a different legal term, fewer words, or a different title — or read one of the citations you were already given.`
				};
			}
		);
	}
};
