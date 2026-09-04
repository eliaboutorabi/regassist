import { describe, expect, it, vi } from 'vitest';
import { Context } from './context.js';
import { SchemaError, parameterJsonSchema, validateArgs, validateValue } from './schema.js';
import { ToolRegistry, defineTool, toolsPlugin } from './tools.js';

describe('Context', () => {
	it('provides services under a stable key and unwinds them on dispose', async () => {
		const ctx = new Context();
		await ctx.plugin({ name: 'thing', apply: (c) => void c.provide('thing', { value: 1 }) });

		expect(ctx.has('thing')).toBe(true);
		expect(ctx.require<{ value: number }>('thing').value).toBe(1);

		ctx.dispose();
		expect(ctx.has('thing')).toBe(false);
	});

	it('refuses to mount a plugin whose injected service is missing', async () => {
		const ctx = new Context();
		await expect(
			ctx.plugin({ name: 'needy', inject: ['absent'], apply: () => {} })
		).rejects.toThrow(/injects "absent"/);
		ctx.dispose();
	});

	it('unwinds effects in reverse registration order', async () => {
		const ctx = new Context();
		const order: number[] = [];
		ctx.effect(() => () => order.push(1));
		ctx.effect(() => () => order.push(2));
		ctx.dispose();
		expect(order).toEqual([2, 1]);
	});

	it('runs waterfall listeners as around-middleware', async () => {
		const ctx = new Context();
		ctx.on('wrap', async (value: number, next: () => Promise<number>) => (await next()) + value);
		ctx.on('wrap', async (value: number, next: () => Promise<number>) => (await next()) * value);

		// terminal 10 → inner listener multiplies by 3 → outer adds 3.
		await expect(ctx.waterfall<number>('wrap', [3], () => 10)).resolves.toBe(33);
		ctx.dispose();
	});

	it('short-circuits a waterfall when a listener does not delegate', async () => {
		const ctx = new Context();
		const terminal = vi.fn(() => 10);
		ctx.on('wrap', () => 5);
		await expect(ctx.waterfall<number>('wrap', [], terminal)).resolves.toBe(5);
		expect(terminal).not.toHaveBeenCalled();
		ctx.dispose();
	});

	it('stops a bail dispatch at the first listener that returns', () => {
		const ctx = new Context();
		const second = vi.fn(() => 'second');
		ctx.on('decide', () => 'first');
		ctx.on('decide', second);
		expect(ctx.bail<string>('decide')).toBe('first');
		expect(second).not.toHaveBeenCalled();
		ctx.dispose();
	});
});

describe('schema', () => {
	const spec = {
		query: { type: 'string' as const, required: true as const },
		title: { type: 'integer' as const, enum: [17, 26] as const },
		limit: { type: 'integer' as const, minimum: 1, maximum: 10 }
	};

	it('compiles the implicit parameter root into JSON Schema', () => {
		expect(parameterJsonSchema(spec)).toEqual({
			type: 'object',
			additionalProperties: false,
			required: ['query'],
			properties: {
				query: { type: 'string' },
				title: { type: 'integer', enum: [17, 26] },
				limit: { type: 'integer', minimum: 1, maximum: 10 }
			}
		});
	});

	it('accepts valid arguments and drops absent optionals', () => {
		expect(validateArgs({ query: 'meals' }, spec)).toEqual({ query: 'meals' });
	});

	it('rejects a missing required argument', () => {
		expect(() => validateArgs({}, spec)).toThrow(SchemaError);
	});

	it('rejects a value outside a declared enum', () => {
		expect(() => validateArgs({ query: 'x', title: 12 }, spec)).toThrow(/one of 17, 26/);
	});

	it('rejects a non-integer where an integer is declared', () => {
		expect(() => validateArgs({ query: 'x', limit: 2.5 }, spec)).toThrow(/integer/);
	});

	it('enforces integer bounds', () => {
		expect(() => validateArgs({ query: 'x', limit: 40 }, spec)).toThrow(/<= 10/);
	});

	it('leaves the parameter root open so an unknown key does not fail a call', () => {
		expect(validateArgs({ query: 'x', stray: true }, spec)).toEqual({ query: 'x', stray: true });
	});

	it('validates nested arrays and objects in an output schema', () => {
		const output = {
			type: 'array' as const,
			items: {
				type: 'object' as const,
				additionalProperties: false,
				properties: { citation: { type: 'string' as const, required: true as const } }
			}
		};
		expect(validateValue([{ citation: '26 CFR § 1.162-1' }], output)).toEqual([
			{ citation: '26 CFR § 1.162-1' }
		]);
		expect(() => validateValue([{}], output)).toThrow(/\[0\].citation: is required/);
	});
});

describe('ToolRegistry', () => {
	async function registryWith(...tools: Parameters<ToolRegistry['register']>[0][]) {
		const ctx = new Context();
		await ctx.plugin(toolsPlugin);
		const registry = ctx.require<ToolRegistry>('tools');
		for (const tool of tools) registry.register(tool);
		return { ctx, registry };
	}

	const echo = defineTool({
		name: 'echo',
		description: 'Echo a string back.',
		parameters: { text: { type: 'string', required: true } },
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: { text: { type: 'string', required: true } }
			},
			render: (_args, value) => [{ type: 'text', text: value.text }]
		},
		execute: (args) => ({ text: args.text.toUpperCase() })
	});

	it('runs a tool and returns the canonical value with rendered content', async () => {
		const { ctx, registry } = await registryWith(echo);
		const result = await registry.execute({ callId: '1', name: 'echo', arguments: { text: 'hi' } });

		expect(result.isError).toBe(false);
		expect(result.value).toEqual({ text: 'HI' });
		expect(result.content).toEqual([{ type: 'text', text: 'HI' }]);
		ctx.dispose();
	});

	it('normalises invalid arguments into an error result rather than throwing', async () => {
		const { ctx, registry } = await registryWith(echo);
		const result = await registry.execute({ callId: '1', name: 'echo', arguments: {} });

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/text: is required/);
		ctx.dispose();
	});

	it('contains a throwing tool body', async () => {
		const { ctx, registry } = await registryWith(
			defineTool({
				name: 'boom',
				description: 'Always fails.',
				parameters: {},
				output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: '' }] },
				execute: () => {
					throw new Error('upstream is down');
				}
			})
		);
		const result = await registry.execute({ callId: '1', name: 'boom', arguments: {} });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toBe('upstream is down');
		ctx.dispose();
	});

	it('lets a pre-execute listener refuse a call', async () => {
		const { ctx, registry } = await registryWith(echo);
		ctx.on('tools/pre-execute', () => ({ deny: 'not in this session' }));

		const result = await registry.execute({ callId: '1', name: 'echo', arguments: { text: 'hi' } });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/not in this session/);
		ctx.dispose();
	});

	it('reports an unknown tool instead of crashing the turn', async () => {
		const { ctx, registry } = await registryWith(echo);
		const result = await registry.execute({ callId: '1', name: 'nope', arguments: {} });
		expect(result.isError).toBe(true);
		ctx.dispose();
	});

	it('unregisters a tool when its owning effect is disposed', async () => {
		const ctx = new Context();
		await ctx.plugin(toolsPlugin);
		const registry = ctx.require<ToolRegistry>('tools');
		const dispose = registry.register(echo);

		expect(registry.has('echo')).toBe(true);
		dispose();
		expect(registry.has('echo')).toBe(false);
		ctx.dispose();
	});

	it('falls back to a generic card when a logged call cannot be replayed', async () => {
		const { ctx, registry } = await registryWith({
			...echo,
			presentCall: (args) => ({ card: 'generic', title: args.text })
		});
		expect(registry.presentCall('echo', { text: 'hi' })).toEqual({ card: 'generic', title: 'hi' });
		expect(registry.presentCall('echo', { text: 42 })).toBeUndefined();
		ctx.dispose();
	});
});
