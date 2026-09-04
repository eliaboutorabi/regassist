/**
 * Mints an ephemeral client secret for a realtime voice session.
 *
 * The browser cannot call OpenAI's session endpoint directly — no CORS — and
 * we would not want it holding a long-lived credential on the wire anyway. So
 * the caller's own key comes in on this request, is spent immediately on one
 * short-lived token, and is never retained. The browser then opens the WebRTC
 * connection to OpenAI with that token and nothing else.
 *
 * The full session — instructions, voice, turn detection, and the tool schemas
 * straight off the harness registry — is fixed at mint time, so the client has
 * no say in what the model is told or what it may call.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { toolSchemas } from '$lib/plugins';
import { composeInstructions, VOICE_INSTRUCTIONS } from '$lib/prompts';
import { CHARACTERS, isCharacterId, REALTIME_MODEL } from '$lib/voices';
import { describeError, parseBrain, requireApiKey } from '$lib/server/request';

export const config = { runtime: 'nodejs22.x' };

export const POST: RequestHandler = async ({ request }) => {
	const apiKey = requireApiKey(request);
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const character = isCharacterId(body.character) ? body.character : 'classic';
	const profile = CHARACTERS[character];
	const brain = parseBrain(body.brain);

	const session = {
		type: 'realtime',
		model: REALTIME_MODEL,
		output_modalities: ['audio'],
		instructions: `${composeInstructions(VOICE_INSTRUCTIONS, brain)}\n\n${profile.style}`,
		tools: (await toolSchemas(brain.packs)).map((tool) => ({
			type: 'function',
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters
		})),
		tool_choice: 'auto',
		max_output_tokens: 4096,
		audio: {
			input: {
				noise_reduction: { type: 'near_field' },
				transcription: { model: 'gpt-4o-mini-transcribe' },
				turn_detection: {
					type: 'server_vad',
					threshold: 0.45,
					prefix_padding_ms: 300,
					silence_duration_ms: 500,
					create_response: true,
					// Barge-in: speaking over Verity cuts her off, as it should.
					interrupt_response: true
				}
			},
			output: { voice: profile.voice }
		}
	};

	let response: Response;
	try {
		response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ session }),
			signal: AbortSignal.timeout(20_000)
		});
	} catch (cause) {
		error(502, `Could not reach OpenAI to start a voice session. ${describeError(cause)}`);
	}

	const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

	if (!response.ok) {
		const detail =
			(payload?.error as { message?: string })?.message ?? `OpenAI returned ${response.status}.`;
		if (response.status === 401) {
			error(401, 'That OpenAI API key was rejected. Check the key and try again.');
		}
		if (response.status === 403 || response.status === 404) {
			error(
				403,
				`This key cannot reach the realtime model (${REALTIME_MODEL}). Realtime access is granted per account — the text mode will still work.`
			);
		}
		error(response.status === 429 ? 429 : 502, detail);
	}

	const value = payload?.value;
	if (typeof value !== 'string') {
		error(502, 'OpenAI did not return a usable client secret.');
	}

	return json({
		clientSecret: value,
		expiresAt: payload?.expires_at ?? null,
		model: REALTIME_MODEL,
		character,
		voice: profile.voice
	});
};
