/** Shared fetch helpers for the public regulation APIs. */

const USER_AGENT = 'RegAssist/1.0 (regulations research demo; contact via site owner)';

export class SourceError extends Error {
	constructor(
		message: string,
		readonly source: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'SourceError';
	}
}

interface CacheEntry {
	value: unknown;
	expiresAt: number;
}

/**
 * Small TTL cache. Regulation text changes daily at most, and a voice turn can
 * fire the same lookup several times while the model narrates, so this cuts
 * both latency and load on two free government APIs.
 */
const cache = new Map<string, CacheEntry>();
const MAX_ENTRIES = 300;

function readCache<T>(key: string): T | undefined {
	const entry = cache.get(key);
	if (!entry) return undefined;
	if (entry.expiresAt < Date.now()) {
		cache.delete(key);
		return undefined;
	}
	// Refresh recency so the eviction below stays roughly LRU.
	cache.delete(key);
	cache.set(key, entry);
	return entry.value as T;
}

function writeCache(key: string, value: unknown, ttlMs: number): void {
	if (cache.size >= MAX_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export interface FetchOptions {
	source: string;
	signal?: AbortSignal;
	/** Cache time-to-live in milliseconds. Zero disables caching. */
	ttlMs?: number;
	accept?: string;
	timeoutMs?: number;
}

async function request(url: string, options: FetchOptions): Promise<Response> {
	const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
	const signal = options.signal
		? AbortSignal.any([options.signal, timeout])
		: timeout;

	let response: Response;
	try {
		response = await fetch(url, {
			signal,
			headers: {
				// eCFR rejects uncompressed requests to the versioner outright, and
				// the Federal Register asks API clients to identify themselves.
				'Accept-Encoding': 'gzip, deflate',
				'User-Agent': USER_AGENT,
				...(options.accept ? { Accept: options.accept } : {})
			}
		});
	} catch (error) {
		if (timeout.aborted) {
			throw new SourceError(`${options.source} did not respond in time.`, options.source);
		}
		throw new SourceError(
			`Could not reach ${options.source}: ${(error as Error).message}`,
			options.source
		);
	}

	if (!response.ok) {
		throw new SourceError(
			`${options.source} returned ${response.status}.`,
			options.source,
			response.status
		);
	}
	return response;
}

export async function fetchJson<T>(url: string, options: FetchOptions): Promise<T> {
	const ttl = options.ttlMs ?? 10 * 60_000;
	if (ttl > 0) {
		const hit = readCache<T>(url);
		if (hit !== undefined) return hit;
	}
	const response = await request(url, { ...options, accept: 'application/json' });
	const value = (await response.json()) as T;
	if (ttl > 0) writeCache(url, value, ttl);
	return value;
}

export async function fetchText(url: string, options: FetchOptions): Promise<string> {
	const ttl = options.ttlMs ?? 10 * 60_000;
	if (ttl > 0) {
		const hit = readCache<string>(url);
		if (hit !== undefined) return hit;
	}
	const response = await request(url, options);
	const value = await response.text();
	if (ttl > 0) writeCache(url, value, ttl);
	return value;
}

/** Strip the `<strong>`/`<span>` markup the eCFR sprinkles into excerpts. */
export function stripHighlights(html: string): string {
	return decodeEntities(html.replace(/<[^>]+>/g, ''))
		.replace(/\s+/g, ' ')
		.trim();
}

export function decodeEntities(text: string): string {
	return text
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&');
}
