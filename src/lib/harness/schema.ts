/**
 * The tool-authoring surface: one schema DSL that compiles to JSON Schema for
 * the model, validates model-generated arguments before `execute` runs, and
 * infers the argument type so tool bodies are statically typed.
 *
 * Shape and contract follow the DeepSeek Harness `defineTool` reference:
 * arguments are validated for you, `execute` returns one canonical JSON value
 * declared by `output.schema`, and human-facing prose lives in `output.render`
 * rather than in the value.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface Annotations {
	description?: string;
	title?: string;
	default?: JsonValue;
	examples?: JsonValue;
}

export interface StringSpec extends Annotations {
	type: 'string';
	enum?: readonly string[];
	const?: string;
}
export interface NumberSpec extends Annotations {
	type: 'number';
	enum?: readonly number[];
	const?: number;
}
export interface IntegerSpec extends Annotations {
	type: 'integer';
	enum?: readonly number[];
	const?: number;
	minimum?: number;
	maximum?: number;
}
export interface BooleanSpec extends Annotations {
	type: 'boolean';
	const?: boolean;
}
export interface NullSpec extends Annotations {
	type: 'null';
}
export interface ArraySpec extends Annotations {
	type: 'array';
	items?: ValueSchemaSpec;
}
export interface ObjectSpec extends Annotations {
	type: 'object';
	properties?: ParameterSchemaSpec;
	additionalProperties: boolean;
}
/** Author-only escape hatch for an unconstrained lossless JSON node. */
export interface JsonSpec extends Annotations {
	type: 'json';
}

export type ValueSchemaSpec =
	| StringSpec
	| NumberSpec
	| IntegerSpec
	| BooleanSpec
	| NullSpec
	| ArraySpec
	| ObjectSpec
	| JsonSpec;

export type ParameterPropertySpec = ValueSchemaSpec & { required?: true };
export type ParameterSchemaSpec = Record<string, ParameterPropertySpec>;

// ------------------------------------------------------------------ inference

type InferValue<S> = S extends { type: 'string'; enum: readonly (infer E)[] }
	? E
	: S extends { type: 'string' }
		? string
		: S extends { type: 'number' | 'integer'; enum: readonly (infer E)[] }
			? E
			: S extends { type: 'number' | 'integer' }
				? number
				: S extends { type: 'boolean' }
					? boolean
					: S extends { type: 'null' }
						? null
						: S extends { type: 'array'; items: infer I }
							? InferValue<I>[]
							: S extends { type: 'array' }
								? JsonValue[]
								: S extends { type: 'object'; properties: infer P }
									? InferArgs<P>
									: S extends { type: 'object' }
										? Record<string, JsonValue>
										: JsonValue;

type RequiredKeys<S> = { [K in keyof S]: S[K] extends { required: true } ? K : never }[keyof S];
type OptionalKeys<S> = Exclude<keyof S, RequiredKeys<S>>;

export type InferArgs<S> = {
	[K in RequiredKeys<S>]: InferValue<S[K]>;
} & {
	[K in OptionalKeys<S>]?: InferValue<S[K]>;
} extends infer O
	? { [K in keyof O]: O[K] }
	: never;

// ---------------------------------------------------------------- compilation

type JsonSchemaNode = Record<string, unknown>;

function annotate(spec: Annotations, node: JsonSchemaNode): JsonSchemaNode {
	if (spec.description) node.description = spec.description;
	if (spec.title) node.title = spec.title;
	if (spec.default !== undefined) node.default = spec.default;
	if (spec.examples !== undefined) node.examples = spec.examples;
	return node;
}

/** Project one author-facing spec into the JSON Schema the model receives. */
export function compileValue(spec: ValueSchemaSpec): JsonSchemaNode {
	switch (spec.type) {
		case 'json':
			return annotate(spec, {});
		case 'array':
			return annotate(spec, {
				type: 'array',
				...(spec.items ? { items: compileValue(spec.items) } : {})
			});
		case 'object':
			return annotate(spec, {
				type: 'object',
				...(spec.properties ? compileParameters(spec.properties) : { properties: {} }),
				additionalProperties: spec.additionalProperties
			});
		default: {
			const node: JsonSchemaNode = { type: spec.type };
			if ('enum' in spec && spec.enum) node.enum = [...spec.enum];
			if ('const' in spec && spec.const !== undefined) node.const = spec.const;
			if ('minimum' in spec && spec.minimum !== undefined) node.minimum = spec.minimum;
			if ('maximum' in spec && spec.maximum !== undefined) node.maximum = spec.maximum;
			return annotate(spec, node);
		}
	}
}

/** Project the implicit parameter object root. */
export function compileParameters(spec: ParameterSchemaSpec): {
	properties: Record<string, JsonSchemaNode>;
	required?: string[];
} {
	const properties: Record<string, JsonSchemaNode> = {};
	const required: string[] = [];
	for (const [key, property] of Object.entries(spec)) {
		properties[key] = compileValue(property);
		if (property.required) required.push(key);
	}
	return required.length ? { properties, required } : { properties };
}

/** The full function-parameters schema handed to the provider. */
export function parameterJsonSchema(spec: ParameterSchemaSpec): JsonSchemaNode {
	return { type: 'object', ...compileParameters(spec), additionalProperties: false };
}

// ---------------------------------------------------------------- validation

export class SchemaError extends Error {
	constructor(
		message: string,
		readonly path: string
	) {
		super(path ? `${path}: ${message}` : message);
		this.name = 'SchemaError';
	}
}

function typeName(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	return typeof value;
}

/** Validate and coerce one value against a spec, returning the clean value. */
export function validateValue(value: unknown, spec: ValueSchemaSpec, path = ''): JsonValue {
	switch (spec.type) {
		case 'json':
			return value as JsonValue;

		case 'null':
			if (value !== null) throw new SchemaError(`expected null, received ${typeName(value)}`, path);
			return null;

		case 'boolean':
			if (typeof value !== 'boolean') {
				throw new SchemaError(`expected boolean, received ${typeName(value)}`, path);
			}
			if (spec.const !== undefined && value !== spec.const) {
				throw new SchemaError(`expected ${spec.const}`, path);
			}
			return value;

		case 'string': {
			if (typeof value !== 'string') {
				throw new SchemaError(`expected string, received ${typeName(value)}`, path);
			}
			if (spec.const !== undefined && value !== spec.const) {
				throw new SchemaError(`expected "${spec.const}"`, path);
			}
			if (spec.enum && !spec.enum.includes(value)) {
				throw new SchemaError(`expected one of ${spec.enum.join(', ')}`, path);
			}
			return value;
		}

		case 'number':
		case 'integer': {
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				throw new SchemaError(`expected a finite number, received ${typeName(value)}`, path);
			}
			if (spec.type === 'integer' && !Number.isInteger(value)) {
				throw new SchemaError('expected an integer', path);
			}
			if (spec.const !== undefined && value !== spec.const) {
				throw new SchemaError(`expected ${spec.const}`, path);
			}
			if (spec.enum && !spec.enum.includes(value)) {
				throw new SchemaError(`expected one of ${spec.enum.join(', ')}`, path);
			}
			if (spec.type === 'integer') {
				if (spec.minimum !== undefined && value < spec.minimum) {
					throw new SchemaError(`expected >= ${spec.minimum}`, path);
				}
				if (spec.maximum !== undefined && value > spec.maximum) {
					throw new SchemaError(`expected <= ${spec.maximum}`, path);
				}
			}
			return value;
		}

		case 'array': {
			if (!Array.isArray(value)) {
				throw new SchemaError(`expected array, received ${typeName(value)}`, path);
			}
			if (!spec.items) return value as JsonValue[];
			return value.map((item, index) => validateValue(item, spec.items!, `${path}[${index}]`));
		}

		case 'object': {
			if (typeof value !== 'object' || value === null || Array.isArray(value)) {
				throw new SchemaError(`expected object, received ${typeName(value)}`, path);
			}
			return validateProperties(
				value as Record<string, unknown>,
				spec.properties ?? {},
				spec.additionalProperties,
				path
			);
		}
	}
}

function validateProperties(
	value: Record<string, unknown>,
	spec: ParameterSchemaSpec,
	additionalProperties: boolean,
	path: string
): Record<string, JsonValue> {
	const result: Record<string, JsonValue> = {};
	for (const [key, property] of Object.entries(spec)) {
		const child = path ? `${path}.${key}` : key;
		const raw = value[key];
		if (raw === undefined || raw === null) {
			if (property.required && property.type !== 'null') {
				throw new SchemaError('is required', child);
			}
			continue;
		}
		result[key] = validateValue(raw, property, child);
	}
	if (additionalProperties) {
		for (const [key, raw] of Object.entries(value)) {
			if (key in result || key in spec) continue;
			result[key] = raw as JsonValue;
		}
	}
	return result;
}

/**
 * Validate model-generated arguments against the implicit parameter root. The
 * root stays open, matching the upstream contract: unknown keys pass through
 * rather than failing a call the model otherwise got right.
 */
export function validateArgs<S extends ParameterSchemaSpec>(
	value: unknown,
	spec: S
): InferArgs<S> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new SchemaError(`expected an arguments object, received ${typeName(value)}`, '');
	}
	return validateProperties(value as Record<string, unknown>, spec, true, '') as InferArgs<S>;
}
