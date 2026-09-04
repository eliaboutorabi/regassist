/**
 * A compact plugin runtime modelled on DeepSeek Harness / Cordis.
 *
 * Five ideas, borrowed wholesale from the harness this app is shaped after:
 *
 *  1. A plugin is `{ name, inject?, apply(ctx) }`.
 *  2. A context is a repository of services claimed under a stable key.
 *  3. Plugins declare dependencies with `inject`, not with load order.
 *  4. Services talk over typed events with an explicit dispatch mode.
 *  5. Every registration is a reversible effect that unwinds on disposal.
 *
 * The upstream harness is a Node-side agent runtime with a filesystem, a
 * sandbox and subprocesses. This one is isomorphic: the same context boots in
 * a SvelteKit endpoint and in the browser, because the voice agent needs to
 * run the same tools the text agent does.
 */

export type Disposer = () => void;

/** Dispatch modes, matching the upstream contract. */
export type DispatchMode = 'emit' | 'waterfall' | 'parallel' | 'serial' | 'bail';

export interface Plugin<Ctx extends Context = Context> {
	/** Stable identifier, used in diagnostics and duplicate detection. */
	readonly name: string;
	/** Service keys this plugin needs before `apply` runs. */
	readonly inject?: readonly string[];
	apply(ctx: Ctx): Disposer | void | Promise<Disposer | void>;
}

type AnyListener = (...args: never[]) => unknown;

interface Registration {
	listener: AnyListener;
	prepend: boolean;
}

/** Thrown when a plugin asks for a service nobody provides. */
export class MissingServiceError extends Error {
	constructor(
		readonly plugin: string,
		readonly service: string
	) {
		super(`Plugin "${plugin}" injects "${service}", which no plugin provides.`);
		this.name = 'MissingServiceError';
	}
}

/**
 * A service registry plus an event bus. Disposal unwinds every effect
 * registered against the context in reverse order.
 */
export class Context {
	readonly #services = new Map<string, unknown>();
	readonly #listeners = new Map<string, Registration[]>();
	readonly #disposers: Disposer[] = [];
	readonly #loaded = new Set<string>();
	#disposed = false;

	/** Register a reversible effect. The disposer runs at teardown. */
	effect(setup: () => Disposer | void): Disposer {
		this.#assertLive();
		const cleanup = setup();
		const dispose = () => {
			const index = this.#disposers.indexOf(dispose);
			if (index === -1) return; // already unwound
			this.#disposers.splice(index, 1);
			cleanup?.();
		};
		this.#disposers.push(dispose);
		return dispose;
	}

	/** Claim `ctx.<key>` for a service instance. */
	provide<T>(key: string, value: T): Disposer {
		this.#assertLive();
		if (this.#services.has(key)) {
			throw new Error(`Service "${key}" is already provided.`);
		}
		return this.effect(() => {
			this.#services.set(key, value);
			Object.defineProperty(this, key, {
				value,
				configurable: true,
				enumerable: false
			});
			return () => {
				this.#services.delete(key);
				delete (this as Record<string, unknown>)[key];
			};
		});
	}

	/** Look up a service, or `undefined` when nothing has claimed the key. */
	get<T>(key: string): T | undefined {
		return this.#services.get(key) as T | undefined;
	}

	/** Look up a service, throwing when the key is unclaimed. */
	require<T>(key: string): T {
		const service = this.#services.get(key);
		if (service === undefined) throw new MissingServiceError('<caller>', key);
		return service as T;
	}

	has(key: string): boolean {
		return this.#services.has(key);
	}

	/**
	 * Mount a plugin. Injected services must already exist — load order is a
	 * consequence of dependency declaration, so callers register bottom-up.
	 */
	async plugin(plugin: Plugin<this>): Promise<Disposer> {
		this.#assertLive();
		for (const key of plugin.inject ?? []) {
			if (!this.#services.has(key)) throw new MissingServiceError(plugin.name, key);
		}
		if (this.#loaded.has(plugin.name)) {
			throw new Error(`Plugin "${plugin.name}" is already loaded.`);
		}
		this.#loaded.add(plugin.name);
		const cleanup = await plugin.apply(this);
		return this.effect(() => () => {
			this.#loaded.delete(plugin.name);
			cleanup?.();
		});
	}

	/** Mount plugins in order, so later ones can inject earlier services. */
	async use(...plugins: Plugin<this>[]): Promise<void> {
		for (const plugin of plugins) await this.plugin(plugin);
	}

	loadedPlugins(): string[] {
		return [...this.#loaded];
	}

	// ---------------------------------------------------------------- events

	on(event: string, listener: AnyListener, options: { prepend?: boolean } = {}): Disposer {
		this.#assertLive();
		return this.effect(() => {
			const registration: Registration = { listener, prepend: options.prepend === true };
			const existing = this.#listeners.get(event) ?? [];
			const next = registration.prepend ? [registration, ...existing] : [...existing, registration];
			this.#listeners.set(event, next);
			return () => {
				const current = this.#listeners.get(event);
				if (!current) return;
				const remaining = current.filter((entry) => entry !== registration);
				if (remaining.length) this.#listeners.set(event, remaining);
				else this.#listeners.delete(event);
			};
		});
	}

	/** `@mode emit` — fire and forget; listeners observe in registration order. */
	emit(event: string, ...args: unknown[]): void {
		for (const { listener } of this.#snapshot(event)) {
			try {
				(listener as (...a: unknown[]) => unknown)(...args);
			} catch (error) {
				console.error(`[harness] listener for "${event}" threw`, error);
			}
		}
	}

	/** `@mode parallel` — every listener observes concurrently; all awaited. */
	async parallel(event: string, ...args: unknown[]): Promise<void> {
		await Promise.all(
			this.#snapshot(event).map(async ({ listener }) => {
				try {
					await (listener as (...a: unknown[]) => unknown)(...args);
				} catch (error) {
					console.error(`[harness] parallel listener for "${event}" threw`, error);
				}
			})
		);
	}

	/** `@mode serial` — listeners run in order; the first non-undefined wins. */
	async serial<T>(event: string, ...args: unknown[]): Promise<T | undefined> {
		for (const { listener } of this.#snapshot(event)) {
			const result = await (listener as (...a: unknown[]) => unknown)(...args);
			if (result !== undefined) return result as T;
		}
		return undefined;
	}

	/** `@mode bail` — listeners run in order until one returns a value. */
	bail<T>(event: string, ...args: unknown[]): T | undefined {
		for (const { listener } of this.#snapshot(event)) {
			const result = (listener as (...a: unknown[]) => unknown)(...args);
			if (result !== undefined) return result as T;
		}
		return undefined;
	}

	/**
	 * `@mode waterfall` — around-middleware. Each listener receives
	 * `(...args, next)`. Calling `next()` delegates to the next listener and
	 * returns its (possibly wrapped) result; returning without calling `next`
	 * short-circuits the chain. `terminal` produces the innermost value.
	 */
	async waterfall<T>(
		event: string,
		args: unknown[],
		terminal: () => Promise<T> | T
	): Promise<T> {
		const chain = this.#snapshot(event);
		const step = async (index: number): Promise<T> => {
			if (index >= chain.length) return terminal();
			const { listener } = chain[index];
			const next = () => step(index + 1);
			return (await (listener as (...a: unknown[]) => unknown)(...args, next)) as T;
		};
		return step(0);
	}

	#snapshot(event: string): Registration[] {
		return this.#listeners.get(event)?.slice() ?? [];
	}

	// ------------------------------------------------------------- lifecycle

	get disposed(): boolean {
		return this.#disposed;
	}

	/** Unwind every effect in reverse registration order. */
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		while (this.#disposers.length) {
			const dispose = this.#disposers[this.#disposers.length - 1];
			try {
				dispose();
			} catch (error) {
				console.error('[harness] disposer threw', error);
				this.#disposers.pop();
			}
		}
		this.#listeners.clear();
		this.#services.clear();
	}

	#assertLive() {
		if (this.#disposed) throw new Error('Context has been disposed.');
	}
}

/** Author a plugin with inference on the context type. */
export function definePlugin<Ctx extends Context = Context>(plugin: Plugin<Ctx>): Plugin<Ctx> {
	return plugin;
}
