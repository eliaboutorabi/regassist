/**
 * Which models this key can actually reach.
 *
 * Bring-your-own-key means access differs per account, so the picker is built
 * from the caller's own model list intersected with the ones worth offering,
 * rather than from a hardcoded menu that might be half-unusable.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { DEFAULT_MODEL, openaiAdapter, PREFERRED_MODELS } from '$lib/harness';
import { describeError, requireApiKey } from '$lib/server/request';
import { REALTIME_MODEL } from '$lib/voices';

export const config = { runtime: 'nodejs22.x' };

export const GET: RequestHandler = async ({ request }) => {
	const apiKey = requireApiKey(request);

	let available: string[];
	try {
		available = await openaiAdapter.listModels!(apiKey, AbortSignal.timeout(15_000));
	} catch (cause) {
		error(401, describeError(cause));
	}

	const owned = new Set(available);
	const models = PREFERRED_MODELS.filter((model) => owned.has(model));

	return json({
		models: models.length ? models : [DEFAULT_MODEL],
		defaultModel: models.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : (models[0] ?? DEFAULT_MODEL),
		realtimeAvailable: owned.has(REALTIME_MODEL)
	});
};
