/** Stable public surface of the harness. Import only from here. */

export { Context, definePlugin, MissingServiceError, type Disposer, type Plugin } from './context.js';
export {
	compileValue,
	parameterJsonSchema,
	SchemaError,
	validateArgs,
	validateValue,
	type InferArgs,
	type InferValue,
	type JsonValue,
	type ParameterSchemaSpec,
	type ValueSchemaSpec
} from './schema.js';
export {
	defineTool,
	ToolCallError,
	ToolRegistry,
	toolsPlugin,
	type DocumentMark,
	type RegulationCitation,
	type ReviewFinding,
	type RuleChange,
	type ToolCallView,
	type ToolDefinition,
	type ToolExecution,
	type ToolGuard,
	type ToolResult,
	type ToolResultView,
	type ToolSchema
} from './tools.js';
export {
	llmPlugin,
	LLMService,
	ProviderError,
	type ChatMessage,
	type CompletionRequest,
	type LLMAdapter,
	type StreamEvent,
	type ToolCallRecord
} from './llm.js';
export { DEFAULT_MODEL, openaiAdapter, openaiPlugin, selectChatModels } from './openai.js';
export {
	AgentService,
	agentPlugin,
	type AgentEvent,
	type AgentRunOptions,
	type RequestError,
	type RetryAction,
	type Steer,
	type TurnStopping
} from './agent.js';
export { DEFAULT_TOOL_DEADLINE_MS, deadlinePlugin, retryPlugin } from './resilience.js';
