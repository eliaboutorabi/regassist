/**
 * Session state: the caller's key, their model choice, and which character is
 * on screen. The key lives in localStorage on the user's own machine and is
 * sent as a request header when a turn needs it. It is never persisted server
 * side, and "Forget key" really does remove it.
 */

import { browser } from '$app/environment';
import { DEFAULT_MODEL } from '$lib/harness';
import { isCharacterId, type CharacterId } from '$lib/voices';

const KEY_STORAGE = 'regassist.openai-key';
const MODEL_STORAGE = 'regassist.model';
const CHARACTER_STORAGE = 'regassist.character';

function read(key: string): string | null {
	if (!browser) return null;
	try {
		return localStorage.getItem(key);
	} catch {
		// Private mode, or storage disabled. Not worth failing over.
		return null;
	}
}

function write(key: string, value: string | null): void {
	if (!browser) return;
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		// Ignore: the session still works, it just will not be remembered.
	}
}

export interface ModelAvailability {
	models: string[];
	defaultModel: string;
	realtimeAvailable: boolean;
}

class SessionState {
	apiKey = $state<string>(read(KEY_STORAGE) ?? '');
	model = $state<string>(read(MODEL_STORAGE) ?? DEFAULT_MODEL);
	character = $state<CharacterId>(
		isCharacterId(read(CHARACTER_STORAGE)) ? (read(CHARACTER_STORAGE) as CharacterId) : 'classic'
	);

	availableModels = $state<string[]>([]);
	realtimeAvailable = $state(true);
	verifying = $state(false);
	keyError = $state<string | null>(null);

	readonly hasKey = $derived(this.apiKey.trim().length > 0);

	setKey(value: string): void {
		this.apiKey = value.trim();
		write(KEY_STORAGE, this.apiKey || null);
	}

	forgetKey(): void {
		this.apiKey = '';
		this.availableModels = [];
		this.keyError = null;
		write(KEY_STORAGE, null);
	}

	setModel(value: string): void {
		this.model = value;
		write(MODEL_STORAGE, value);
	}

	setCharacter(value: CharacterId): void {
		this.character = value;
		write(CHARACTER_STORAGE, value);
	}

	/**
	 * Confirm the key works and find out what it can reach. Returns true when
	 * the key is usable, so the gate can advance on success only.
	 */
	async verify(key = this.apiKey): Promise<boolean> {
		const candidate = key.trim();
		if (!candidate) {
			this.keyError = 'Enter your OpenAI API key to begin.';
			return false;
		}

		this.verifying = true;
		this.keyError = null;
		try {
			const response = await fetch('/api/models', { headers: { 'x-openai-key': candidate } });
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as { message?: string } | null;
				this.keyError = body?.message ?? 'That key was rejected by OpenAI.';
				return false;
			}
			const payload = (await response.json()) as ModelAvailability;
			this.availableModels = payload.models;
			this.realtimeAvailable = payload.realtimeAvailable;
			if (!payload.models.includes(this.model)) this.setModel(payload.defaultModel);
			this.setKey(candidate);
			return true;
		} catch {
			this.keyError = 'Could not reach the server to check that key.';
			return false;
		} finally {
			this.verifying = false;
		}
	}
}

export const session = new SessionState();
