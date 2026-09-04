/**
 * The default policies for things that go wrong on their own.
 *
 * Both are plugins rather than loop internals, so a deployment can replace
 * either without touching the agent: the loop only knows that
 * `agent/request-error` may return a retry action, and that `tools/execute`
 * wraps dispatch.
 */

import type { Context } from './context.js';
import type { RequestError, RetryAction } from './agent.js';
import type { ToolExecution } from './tools.js';

/** Statuses that mean "the provider had a bad moment", not "you are wrong". */
const TRANSIENT = new Set([408, 409, 429, 500, 502, 503, 504]);

const BACKOFF = [700, 2200];

/**
 * Retry a model request that failed before producing anything.
 *
 * A rate limit or a bad gateway used to end the turn and put a red notice in
 * front of someone who had done nothing wrong. Two quick retries cover almost
 * all of it, and a request that has already started streaming is never retried
 * because replaying it would repeat what the reader has seen.
 */
export const retryPlugin = {
	name: 'retry-requests',

	apply(ctx: Context) {
		return ctx.on('agent/request-error', (failure: RequestError): RetryAction | undefined => {
			if (failure.attempt >= BACKOFF.length) return undefined;

			const status = failure.status;
			// A network failure has no status at all, and is the most retryable
			// thing there is.
			const transient = status === undefined || TRANSIENT.has(status);
			if (!transient) return undefined;

			return {
				retry: true,
				delayMs: BACKOFF[failure.attempt],
				reason: status ? `provider returned ${status}` : 'the request did not complete'
			};
		});
	}
};

/**
 * A deadline around every tool call.
 *
 * The source clients have their own timeouts, but this is the backstop for the
 * case they cannot cover: a body that streams forever, a promise that never
 * settles. Without it one wedged call holds a turn open until the user gives
 * up, with the robot thinking and nothing to show for it.
 */
export const DEFAULT_TOOL_DEADLINE_MS = 45_000;

export function deadlinePlugin(ms = DEFAULT_TOOL_DEADLINE_MS) {
	return {
		name: 'tool-deadline',

		apply(ctx: Context) {
			return ctx.on(
				'tools/execute',
				async (exec: ToolExecution, next: () => Promise<unknown>) => {
					let timer: ReturnType<typeof setTimeout> | undefined;
					try {
						return await Promise.race([
							next(),
							new Promise<never>((_, reject) => {
								timer = setTimeout(
									() =>
										reject(
											new Error(
												`${exec.name} did not finish within ${Math.round(ms / 1000)} seconds. The source may be slow or down — try once more, or answer without it and say so.`
											)
										),
									ms
								);
							})
						]);
					} finally {
						clearTimeout(timer);
					}
				}
			);
		}
	};
}
