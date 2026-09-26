/**
 * A minimal MCP (Model Context Protocol) server over stdio — JSON-RPC 2.0, one message per
 * line, no SDK. Only the tools half of the protocol is implemented:
 *
 *   initialize · server/discover · ping · tools/list · tools/call   requests
 *   notifications/initialized · notifications/cancelled             notifications (others ignored)
 *
 * Dual-era: legacy clients open with `initialize` (2025-11-25 and earlier); modern clients
 * (2026-07-28) put `io.modelcontextprotocol/protocolVersion` in every request's `_meta` and may
 * probe with `server/discover`. A modern request naming a version we do not speak gets
 * UnsupportedProtocolVersionError (-32022) listing the ones we do.
 *
 * Tool failures are results with `isError: true` (the model sees the message and can react);
 * protocol problems (unknown method, unknown tool, malformed params) are JSON-RPC errors.
 * Spec: https://modelcontextprotocol.io/specification/2026-07-28 (and 2025-06-18 for the handshake).
 */

export interface McpTextContent { type: 'text'; text: string }
export interface McpImageContent { type: 'image'; data: string; mimeType: string }
export type McpContent = McpTextContent | McpImageContent;

export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpCallContext {
  signal: AbortSignal;
  /** Sends notifications/progress when the client asked for it (a progressToken); otherwise a no-op. */
  progress(message: string): void;
}

export interface McpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: McpToolAnnotations;
  execute(args: Record<string, unknown>, ctx: McpCallContext): Promise<McpToolResult>;
}

export interface McpServerOptions {
  serverInfo: { name: string; title?: string; version: string };
  instructions?: string;
  /** Recomputed on every tools/list and tools/call, so e.g. `anim login` in another terminal shows up. */
  tools(): Promise<readonly McpTool[]> | readonly McpTool[];
  /** Writes one serialized message (without the newline). */
  send(line: string): void;
  /** Heartbeat period for progress notifications on long calls. */
  progressEveryMs?: number;
}

type Id = string | number;
interface JsonRpcMessage { jsonrpc?: string; id?: Id | null; method?: unknown; params?: unknown; result?: unknown; error?: unknown }

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

export const UNSUPPORTED_PROTOCOL_VERSION = -32022;

/** Handshake (legacy) revisions, newest first. `initialize` asking for another gets the newest. */
export const LEGACY_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
/** Per-request-metadata (modern) revisions. */
export const MODERN_PROTOCOLS = ['2026-07-28'] as const;
export const SUPPORTED_PROTOCOLS = [...MODERN_PROTOCOLS, ...LEGACY_PROTOCOLS] as const;
const VERSION_META = 'io.modelcontextprotocol/protocolVersion';

class RpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) { super(message); }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function textResult(text: string, isError = false): McpToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

export function createMcpServer(opts: McpServerOptions) {
  const inflight = new Map<Id, AbortController>();
  const cancelled = new Set<Id>();
  const every = opts.progressEveryMs ?? 10_000;
  const send = (msg: unknown): void => opts.send(JSON.stringify(msg));

  async function call(method: string, params: Record<string, unknown>, id: Id): Promise<unknown> {
    if (method === 'server/discover') {
      return {
        supportedVersions: [...SUPPORTED_PROTOCOLS],
        capabilities: { tools: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': opts.serverInfo },
        ...(opts.instructions ? { instructions: opts.instructions } : {}),
      };
    }
    if (method === 'initialize') {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      const protocolVersion = (LEGACY_PROTOCOLS as readonly string[]).includes(asked) ? asked : LEGACY_PROTOCOLS[0];
      return {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: opts.serverInfo,
        ...(opts.instructions ? { instructions: opts.instructions } : {}),
      };
    }
    if (method === 'ping') return {};
    if (method === 'tools/list') {
      const tools = await opts.tools();
      return {
        tools: tools.map((t) => ({
          name: t.name,
          ...(t.title ? { title: t.title } : {}),
          description: t.description,
          inputSchema: t.inputSchema,
          ...(t.annotations ? { annotations: t.annotations } : {}),
        })),
      };
    }
    if (method === 'tools/call') {
      const name = params.name;
      if (typeof name !== 'string') throw new RpcError(INVALID_PARAMS, 'tools/call needs params.name');
      const args = params.arguments ?? {};
      if (!isRecord(args)) throw new RpcError(INVALID_PARAMS, 'params.arguments must be an object');
      const tool = (await opts.tools()).find((t) => t.name === name);
      if (!tool) throw new RpcError(INVALID_PARAMS, `Unknown tool: ${name}`);
      const controller = new AbortController();
      inflight.set(id, controller);
      const meta = isRecord(params._meta) ? params._meta : {};
      const token = typeof meta.progressToken === 'string' || typeof meta.progressToken === 'number' ? meta.progressToken : undefined;
      let n = 0;
      let last = `${name} running`;
      const progress = (message: string): void => {
        last = message;
        if (token === undefined || controller.signal.aborted) return;
        n += 1;
        send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: n, message } });
      };
      const beat = token === undefined ? null : setInterval(() => progress(last), every);
      beat?.unref?.();
      try {
        return await tool.execute(args, { signal: controller.signal, progress });
      } catch (error) {
        if (controller.signal.aborted) return textResult('Cancelled.', true);
        return textResult(error instanceof Error ? error.message : String(error), true);
      } finally {
        if (beat) clearInterval(beat);
        inflight.delete(id);
      }
    }
    throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`);
  }

  /** Handle one parsed message. Returns the response to send, or null for notifications. */
  async function dispatch(msg: unknown): Promise<unknown | null> {
    if (!isRecord(msg)) return { jsonrpc: '2.0', id: null, error: { code: INVALID_REQUEST, message: 'Invalid request' } };
    const m = msg as JsonRpcMessage;
    const hasId = m.id !== undefined && m.id !== null;
    if (typeof m.method !== 'string') {
      // A response to something we never asked, or garbage: nothing to answer.
      if ('result' in m || 'error' in m) return null;
      return { jsonrpc: '2.0', id: hasId ? m.id : null, error: { code: INVALID_REQUEST, message: 'Invalid request' } };
    }
    const params = isRecord(m.params) ? m.params : {};
    if (!hasId) {
      if (m.method === 'notifications/cancelled') {
        const target = params.requestId;
        if (typeof target === 'string' || typeof target === 'number') {
          const running = inflight.get(target);
          if (running) { cancelled.add(target); running.abort(); }
        }
      }
      return null;
    }
    const id = m.id as Id;
    const meta = isRecord(params._meta) ? params._meta : {};
    const version = meta[VERSION_META];
    const modern = version !== undefined || m.method === 'server/discover';
    try {
      if (version !== undefined && !(SUPPORTED_PROTOCOLS as readonly string[]).includes(String(version))) {
        throw new RpcError(UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', { supported: [...SUPPORTED_PROTOCOLS], requested: version });
      }
      const result = await call(m.method, params, id) as Record<string, unknown>;
      /* The spec: a cancelled request gets no response. */
      if (cancelled.delete(id)) return null;
      return { jsonrpc: '2.0', id, result: modern ? { resultType: 'complete', ...result } : result };
    } catch (error) {
      const code = error instanceof RpcError ? error.code : INTERNAL_ERROR;
      const data = error instanceof RpcError && error.data !== undefined ? { data: error.data } : {};
      return { jsonrpc: '2.0', id, error: { code, message: error instanceof Error ? error.message : String(error), ...data } };
    }
  }

  return {
    /** Feed one line from stdin. Requests are handled concurrently; each response is sent when ready. */
    async handleLine(line: string): Promise<void> {
      if (!line.trim()) return;
      let msg: unknown;
      try { msg = JSON.parse(line); } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: 'Parse error' } });
        return;
      }
      if (Array.isArray(msg)) {
        if (!msg.length) { send({ jsonrpc: '2.0', id: null, error: { code: INVALID_REQUEST, message: 'Empty batch' } }); return; }
        const out = (await Promise.all(msg.map(dispatch))).filter((r) => r !== null);
        if (out.length) send(out);
        return;
      }
      const res = await dispatch(msg);
      if (res !== null) send(res);
    },
    /** Abort every running call (client went away). */
    abortAll(): void {
      for (const c of inflight.values()) c.abort();
    },
    get busy(): number { return inflight.size; },
  };
}
