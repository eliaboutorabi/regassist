/**
 * The tool registry and its execution pipeline.
 *
 * A tool declares three separable things:
 *   - `parameters` / `output.schema` — the machine contract, validated here.
 *   - `output.render` — the model-facing prose the transcript sees.
 *   - `present*` — a pure render intent the UI turns into a card.
 *
 * Keeping presentation pure and derived from `(args, value)` is what lets the
 * same tool call drive the voice transcript and the regulation cards on screen
 * without the tool importing a single UI type.
 */

import type { Context, Disposer } from './context.js';
import {
	parameterJsonSchema,
	validateArgs,
	validateValue,
	type InferArgs,
	type InferValue,
	type JsonValue,
	type ParameterSchemaSpec,
	type ValueSchemaSpec
} from './schema.js';

// ---------------------------------------------------------------- render intents

/** One regulation section pulled from the eCFR. */
export type RegulationCitation = {
	citation: string;
	heading: string;
	hierarchy: string;
	url: string;
	excerpt?: string;
	titleName?: string;
};

/** One rule-making document from the Federal Register. */
export type RuleChange = {
	title: string;
	type: string;
	agency: string;
	publishedOn: string;
	effectiveOn?: string;
	url: string;
	abstract?: string;
	cfrReferences?: string[];
};

/** One passage Verity has asked to be shown on the page. */
export type DocumentMark = {
	quote: string;
	note: string;
	severity: 'high' | 'medium' | 'low' | 'info';
};

/** One flagged passage from a reviewed document. */
export type ReviewFinding = {
	severity: 'high' | 'medium' | 'low' | 'info';
	topic: string;
	quote: string;
	concern: string;
	lookup: string;
	/** CFR title the suggested lookup should be scoped to, when there is one. */
	title?: number;
};

export type ToolCallView =
	| { card: 'generic'; title: string; detail?: string }
	| { card: 'search'; title: string; query: string }
	| { card: 'regulation'; title: string; citation: string }
	| { card: 'review'; title: string; documentName: string };

export type ToolResultView =
	| { card: 'generic'; title: string; detail?: string }
	| { card: 'results'; title: string; query: string; hits: RegulationCitation[]; truncated?: boolean }
	| { card: 'regulation'; title: string; section: RegulationCitation; body: string }
	| { card: 'changes'; title: string; query: string; changes: RuleChange[] }
	| { card: 'review'; title: string; documentName: string; findings: ReviewFinding[]; summary: string }
	| {
			card: 'highlight';
			title: string;
			documentId: string;
			documentName: string;
			marks: DocumentMark[];
	  }
	| { card: 'error'; title: string; detail: string };

// ---------------------------------------------------------------- definitions

export interface ToolExecution {
	readonly callId: string;
	readonly name: string;
	readonly arguments: Readonly<Record<string, JsonValue>>;
	readonly signal: AbortSignal;
}

export interface ToolContentBlock {
	type: 'text';
	text: string;
}

/**
 * A tool definition.
 *
 * Both the argument type and the canonical return type come from the schemas,
 * never from the function bodies — declaring `output.schema` is what gives
 * `execute` its return type and `render` its `value`. That is the upstream
 * contract, and it means the schema the model sees and the type the author
 * writes against can never drift apart.
 */
export interface ToolDefinition<
	S extends ParameterSchemaSpec = ParameterSchemaSpec,
	O extends ValueSchemaSpec = ValueSchemaSpec
> {
	readonly name: string;
	readonly description: string;
	/** Shown in the UI as the tool's human label. */
	readonly label?: string;
	readonly parameters: S;
	readonly output: {
		readonly schema: O;
		render(args: InferArgs<S>, value: InferValue<O>): ToolContentBlock[];
	};
	/** Pure projection of the pending call. Must not do I/O. */
	presentCall?(args: InferArgs<S>): ToolCallView | undefined;
	/** Pure projection of the completed call. Must not do I/O. */
	presentResult?(args: InferArgs<S>, value: InferValue<O>): ToolResultView | undefined;
	execute(args: InferArgs<S>, exec: ToolExecution): InferValue<O> | Promise<InferValue<O>>;
}

/** Author a tool with both types inferred from its schemas. */
export function defineTool<S extends ParameterSchemaSpec, O extends ValueSchemaSpec>(
	definition: ToolDefinition<S, O>
): ToolDefinition<S, O> {
	return definition;
}

/** Erased shape the registry stores; authors never see it. */
type RegisteredTool = ToolDefinition<ParameterSchemaSpec, ValueSchemaSpec> & {
	execute(args: never, exec: ToolExecution): unknown;
};

/** The provider-facing projection of a registered tool. */
export interface ToolSchema {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export interface ToolResult {
	callId: string;
	name: string;
	arguments: Record<string, JsonValue>;
	/** The canonical JSON value, or `null` when the call failed. */
	value: JsonValue | null;
	content: ToolContentBlock[];
	isError: boolean;
	view?: ToolResultView;
	durationMs: number;
}

export interface ToolCallRequest {
	callId: string;
	name: string;
	arguments: Record<string, JsonValue>;
	signal?: AbortSignal;
}

/** A `tools/pre-execute` listener returns this to stop a call. */
export interface ToolDenial {
	deny: string;
}

export class ToolCallError extends Error {
	constructor(
		message: string,
		readonly toolName: string
	) {
		super(message);
		this.name = 'ToolCallError';
	}
}

// ------------------------------------------------------------------- registry

/**
 * Events (all namespaced `tools/…`):
 *   - `tools/pre-execute` `@mode bail`      — return `{ deny }` to refuse a call.
 *   - `tools/execute`     `@mode waterfall` — wrap dispatch (deadlines, metrics).
 *   - `tools/result`      `@mode emit`      — observe the normalized outcome.
 */
export class ToolRegistry {
	readonly #tools = new Map<string, RegisteredTool>();

	constructor(private readonly ctx: Context) {}

	/** Registration is effect-based: disposing the plugin unregisters the tool. */
	register<S extends ParameterSchemaSpec, O extends ValueSchemaSpec>(
		definition: ToolDefinition<S, O>
	): Disposer {
		return this.ctx.effect(() => {
			if (this.#tools.has(definition.name)) {
				throw new Error(`Tool "${definition.name}" is already registered.`);
			}
			this.#tools.set(definition.name, definition as unknown as RegisteredTool);
			return () => this.#tools.delete(definition.name);
		});
	}

	has(name: string): boolean {
		return this.#tools.has(name);
	}

	names(): string[] {
		return [...this.#tools.keys()];
	}

	label(name: string): string {
		const tool = this.#tools.get(name);
		return tool?.label ?? name;
	}

	/** The model-facing projection of every registered tool. */
	schemas(): ToolSchema[] {
		return [...this.#tools.values()].map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: parameterJsonSchema(tool.parameters)
		}));
	}

	/** The pending-call card, or `undefined` when the tool declares none. */
	presentCall(name: string, rawArgs: unknown): ToolCallView | undefined {
		const tool = this.#tools.get(name);
		if (!tool?.presentCall) return undefined;
		try {
			// Soft-validate the display path: a malformed logged call must never
			// crash a replay, so fall back to the generic card instead.
			const args = validateArgs(rawArgs, tool.parameters) as never;
			return tool.presentCall(args);
		} catch {
			return undefined;
		}
	}

	/**
	 * Run one call through the full pipeline. Throws are contained: an invalid
	 * argument, a rejected promise, or a schema violation all normalize to an
	 * `isError` result the model can read and recover from.
	 */
	async execute(request: ToolCallRequest): Promise<ToolResult> {
		const started = Date.now();
		const { callId, name } = request;
		const tool = this.#tools.get(name);

		const fail = (detail: string, view?: ToolResultView): ToolResult => {
			const result: ToolResult = {
				callId,
				name,
				arguments: request.arguments,
				value: null,
				content: [{ type: 'text', text: detail }],
				isError: true,
				view: view ?? { card: 'error', title: this.label(name), detail },
				durationMs: Date.now() - started
			};
			this.ctx.emit('tools/result', result);
			return result;
		};

		if (!tool) return fail(`No tool named "${name}" is registered.`);

		let args: never;
		try {
			args = validateArgs(request.arguments, tool.parameters) as never;
		} catch (error) {
			return fail(`Invalid arguments: ${(error as Error).message}`);
		}

		const denial = this.ctx.bail<ToolDenial>('tools/pre-execute', { name, args });
		if (denial) return fail(`Call refused: ${denial.deny}`);

		const controller = new AbortController();
		const signal = request.signal ?? controller.signal;
		const exec: ToolExecution = Object.freeze({
			callId,
			name,
			arguments: Object.freeze({ ...request.arguments }),
			signal
		});

		try {
			const raw = await this.ctx.waterfall<JsonValue>('tools/execute', [exec], async () =>
				(await tool.execute(args, exec)) as JsonValue
			);
			const value = validateValue(raw, tool.output.schema) as never;
			const result: ToolResult = {
				callId,
				name,
				arguments: request.arguments,
				value,
				content: tool.output.render(args, value),
				isError: false,
				view: tool.presentResult?.(args, value),
				durationMs: Date.now() - started
			};
			this.ctx.emit('tools/result', result);
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return fail(message);
		}
	}
}

/** Provides `ctx.tools`. Mount this before any plugin that registers tools. */
export const toolsPlugin = {
	name: 'tools',
	apply(ctx: Context) {
		ctx.provide('tools', new ToolRegistry(ctx));
	}
};
