/**
 * The conversation, shared by both modes.
 *
 * Voice and text write into the same transcript, so a user can start by typing,
 * switch to speaking, and keep one continuous thread — and the regulation cards
 * a voice turn produced are still on screen afterwards.
 */

import type { AgentEvent, ToolCallView, ToolResultView } from '$lib/harness';

export type EntrySource = 'voice' | 'text';

export type Entry =
	| { kind: 'user'; id: string; text: string; source: EntrySource }
	| { kind: 'assistant'; id: string; text: string; streaming: boolean; source: EntrySource }
	| {
			kind: 'tool';
			id: string;
			callId: string;
			name: string;
			label: string;
			call?: ToolCallView;
			result?: ToolResultView;
			state: 'running' | 'done' | 'error';
			durationMs?: number;
	  }
	| { kind: 'notice'; id: string; text: string; tone: 'error' | 'info' };

/** Every regulation the session has surfaced, newest first, deduped. */
export interface Citation {
	citation: string;
	heading: string;
	url: string;
}

let counter = 0;
const nextId = () => `e${(counter += 1)}`;

class ConversationState {
	entries = $state<Entry[]>([]);
	citations = $state<Citation[]>([]);
	/** True while either mode is mid-turn; the composer disables on it. */
	busy = $state(false);

	readonly isEmpty = $derived(this.entries.length === 0);

	reset(): void {
		this.entries = [];
		this.citations = [];
		this.busy = false;
	}

	addUser(text: string, source: EntrySource): void {
		this.entries.push({ kind: 'user', id: nextId(), text, source });
	}

	addNotice(text: string, tone: 'error' | 'info' = 'error'): void {
		this.entries.push({ kind: 'notice', id: nextId(), text, tone });
	}

	/** Start (or find) the assistant bubble that deltas append to. */
	#openAssistant(source: EntrySource): Extract<Entry, { kind: 'assistant' }> {
		const last = this.entries.at(-1);
		if (last?.kind === 'assistant' && last.streaming && last.source === source) return last;
		const entry: Entry = { kind: 'assistant', id: nextId(), text: '', streaming: true, source };
		this.entries.push(entry);
		return entry as Extract<Entry, { kind: 'assistant' }>;
	}

	appendAssistant(delta: string, source: EntrySource): void {
		this.#openAssistant(source).text += delta;
	}

	/** Close any open assistant bubble. Safe to call more than once. */
	settleAssistant(): void {
		for (const entry of this.entries) {
			if (entry.kind === 'assistant') entry.streaming = false;
		}
	}

	startTool(callId: string, name: string, label: string, call?: ToolCallView): void {
		this.settleAssistant();
		this.entries.push({
			kind: 'tool',
			id: nextId(),
			callId,
			name,
			label,
			call,
			state: 'running'
		});
	}

	finishTool(callId: string, isError: boolean, view?: ToolResultView, durationMs?: number): void {
		const entry = this.entries.findLast(
			(candidate) => candidate.kind === 'tool' && candidate.callId === callId
		) as Extract<Entry, { kind: 'tool' }> | undefined;

		if (!entry) return;
		entry.state = isError ? 'error' : 'done';
		entry.result = view;
		entry.durationMs = durationMs;
		if (view) this.#collect(view);
	}

	/** Pull every citation a result surfaced into the session's reference rail. */
	#collect(view: ToolResultView): void {
		const found: Citation[] = [];
		if (view.card === 'results') {
			for (const hit of view.hits) {
				found.push({ citation: hit.citation, heading: hit.heading, url: hit.url });
			}
		} else if (view.card === 'regulation') {
			found.push({
				citation: view.section.citation,
				heading: view.section.heading,
				url: view.section.url
			});
		}

		for (const citation of found) {
			if (this.citations.some((existing) => existing.citation === citation.citation)) continue;
			this.citations.unshift(citation);
		}
		if (this.citations.length > 40) this.citations.length = 40;
	}

	/** Apply one agent event from the text transport. */
	applyAgentEvent(event: AgentEvent): void {
		switch (event.type) {
			case 'text':
				this.appendAssistant(event.delta, 'text');
				break;
			case 'tool-call':
				this.startTool(event.callId, event.name, event.label, event.view);
				break;
			case 'tool-result':
				this.finishTool(event.callId, event.isError, event.view, event.durationMs);
				break;
			case 'error':
				this.settleAssistant();
				this.addNotice(event.message);
				break;
			case 'done':
				this.settleAssistant();
				break;
			case 'reasoning':
				break;
		}
	}

	/** The plain message list the server needs to continue the conversation. */
	toMessages(): { role: 'user' | 'assistant'; content: string }[] {
		return this.entries
			.filter(
				(entry): entry is Extract<Entry, { kind: 'user' | 'assistant' }> =>
					(entry.kind === 'user' || entry.kind === 'assistant') && entry.text.trim().length > 0
			)
			.map((entry) => ({ role: entry.kind, content: entry.text }));
	}
}

export const conversation = new ConversationState();
