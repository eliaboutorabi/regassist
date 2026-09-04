/** Text-mode transport: post a turn, read the agent's event stream back. */

import type { AgentEvent } from '$lib/harness';
import type { StoredDocument } from '$lib/plugins';

export interface ChatTurn {
	apiKey: string;
	model: string;
	messages: { role: 'user' | 'assistant'; content: string }[];
	documents: StoredDocument[];
	/** Knowledge, skills and the tool packs those skills need. */
	brain?: unknown;
	signal?: AbortSignal;
}

/** Yields one `AgentEvent` per server-sent frame. */
export async function* streamTurn(turn: ChatTurn): AsyncGenerator<AgentEvent> {
	const response = await fetch('/api/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'x-openai-key': turn.apiKey },
		signal: turn.signal,
		body: JSON.stringify({
			messages: turn.messages,
			documents: turn.documents,
			model: turn.model,
			brain: turn.brain
		})
	});

	if (!response.ok || !response.body) {
		const body = (await response.json().catch(() => null)) as { message?: string } | null;
		yield {
			type: 'error',
			message: body?.message ?? `The server returned ${response.status}.`,
			status: response.status
		};
		return;
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			let boundary: number;
			while ((boundary = buffer.indexOf('\n\n')) !== -1) {
				const frame = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				for (const line of frame.split('\n')) {
					if (!line.startsWith('data:')) continue;
					const payload = line.slice(5).trim();
					if (!payload) continue;
					try {
						yield JSON.parse(payload) as AgentEvent;
					} catch {
						// A partial frame is not worth ending the turn over.
					}
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}
