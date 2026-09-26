/**
 * Scene tool contract: server-only tools a package contributes to the director agent (the engine defines only the interface, zero implementation).
 *
 * Tool implementations (search / image generation / writing to disk ...) belong to each Scene package (server-only subpath);
 * the host adapts the ToolRegistry a package exports into its own agent SDK (schema / env mapping) and mounts tools according to match results,
 * no longer hardcoding any specific tool (e.g. get_image).
 */
export interface SceneToolContext {
  /** Task file root (resource/ writes and local resources all live under it). */
  fsRoot: string;
  /** Iteration-time placeholder mode: true = don't call real external APIs; produce placeholder outputs. */
  placeholder?: boolean;
}

export interface SceneToolResult {
  /** Text result returned to the agent. */
  text: string;
  /** Whether this is an error result. */
  isError?: boolean;
}

export interface SceneTool<Input = unknown> {
  /** Tool name (globally unique; = the name in manifest.tools). */
  name: string;
  /** Tool description shown to the agent. */
  description: string;
  /**
   * Input schema. The engine doesn't bind to a specific validation library: put a zod schema or JSON Schema here,
   * and the host adapts it to its own agent SDK (this repo's host uses zod).
   */
  parameters: unknown;
  /** Tool-related instructions to inject into the director system prompt (optional). */
  systemDoc?: string;
  /** Implementation (server-only). */
  execute(input: Input, ctx: SceneToolContext): Promise<SceneToolResult> | SceneToolResult;
}

/** Tool name -> tool. Exported by each Scene package from its server-only entry. */
export type ToolRegistry = Record<string, SceneTool>;
