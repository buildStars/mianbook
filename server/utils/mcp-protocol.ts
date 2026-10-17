/**
 * MCP（Model Context Protocol）服务端的协议层：JSON-RPC 2.0 消息分发、协议版本协商、
 * tools 和 prompts 两种能力。同时服务两代协议：
 * - 2026-07-28 起（modern）：无状态，没有 initialize 握手。每个请求在 params._meta 里带协议版本和客户端能力，
 *   结果都带 resultType，列表结果带缓存提示，另有 server/discover 介绍服务端自己
 * - 2025-11-25 及更早（legacy）：先 initialize 握手协商版本，之后的请求不带版本信息
 * 纯函数，不依赖数据库；传输层在 server/routes/mcp.ts
 */
import type { z } from 'zod'

/** 每个请求自带版本的新协议 */
export const MCP_MODERN_VERSIONS: readonly string[] = ['2026-07-28']
/** 用 initialize 握手的旧协议，新的在前；和官方 TypeScript SDK v1 一致 */
export const MCP_LEGACY_VERSIONS: readonly string[] = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
/** 支持的全部版本，新的在前：server/discover 和"不支持的版本"错误里列出来 */
export const MCP_PROTOCOL_VERSIONS: readonly string[] = [...MCP_MODERN_VERSIONS, ...MCP_LEGACY_VERSIONS]
/** initialize 只用于旧协议，协商结果也只能是旧版本 */
export const MCP_LATEST_LEGACY_VERSION = MCP_LEGACY_VERSIONS[0]!

export const RPC_ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  // 2026-07-28 起由 MCP 规范统一分配的错误码
  headerMismatch: -32020,
  missingClientCapability: -32021,
  unsupportedVersion: -32022,
} as const

/** 2026-07-28 起请求和结果的 _meta 里由协议保留的字段 */
export const META = {
  protocolVersion: 'io.modelcontextprotocol/protocolVersion',
  clientCapabilities: 'io.modelcontextprotocol/clientCapabilities',
  serverInfo: 'io.modelcontextprotocol/serverInfo',
  subscriptionId: 'io.modelcontextprotocol/subscriptionId',
} as const

/** 列表结果的缓存提示：工具和提示词只在发布新版本时变，客户端缓存一小时足够 */
export const LIST_TTL_MS = 3_600_000

const CAPABILITIES = { tools: { listChanged: false }, prompts: { listChanged: false } }

type RpcId = string | number | null

export interface RpcResponse {
  jsonrpc: '2.0'
  id: RpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/**
 * 一条消息的处理结果。JSON 响应带上 Streamable HTTP 应该用的状态码：2026-07-28 起规范要求版本不对、
 * 缺少必填的 _meta 返回 400，未知方法返回 404；其余 JSON-RPC 错误和旧协议一样用 200。
 * subscriptions/listen 返回一段 SSE 流；通知和客户端发来的响应返回 null，HTTP 层回 202
 */
export type McpOutcome = { response: RpcResponse; status: number } | { stream: unknown[] } | null

export const rpcError = (id: RpcId, code: number, message: string, data?: unknown): RpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: data === undefined ? { code, message } : { code, message, data },
})
const rpcResult = (id: RpcId, result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result })
const json = (response: RpcResponse, status = 200) => ({ response, status })

export const isSupportedVersion = (v: unknown) => typeof v === 'string' && MCP_PROTOCOL_VERSIONS.includes(v)
export const isModernVersion = (v: unknown) => typeof v === 'string' && MCP_MODERN_VERSIONS.includes(v)

/** initialize 时客户端请求的版本我们支持就用它，否则回复我们支持的最新旧版本，由客户端决定是否继续 */
export function negotiateVersion(requested: unknown): string {
  return typeof requested === 'string' && MCP_LEGACY_VERSIONS.includes(requested) ? requested : MCP_LATEST_LEGACY_VERSION
}

/** 2026-07-28 起"不支持这个版本"的错误：列出支持的版本，客户端从里面挑一个重试 */
export const unsupportedVersionError = (id: RpcId, requested: unknown) =>
  rpcError(id, RPC_ERROR.unsupportedVersion, 'Unsupported protocol version', { supported: MCP_PROTOCOL_VERSIONS, requested })

export interface McpTool<Ctx> {
  name: string
  title: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  /** 会写入用户数据：只读令牌看不到也调用不了 */
  write?: boolean
  args: z.ZodType
  run: (ctx: Ctx, args: any) => Promise<string>
}

export interface McpPrompt {
  name: string
  title: string
  description: string
  arguments: { name: string; description: string; required?: boolean }[]
  build: (args: Record<string, string>) => string
}

export interface McpServerDef<Ctx> {
  info: { name: string; title: string; version: string }
  instructions: string
  tools: McpTool<Ctx>[]
  prompts: McpPrompt[]
}

/** 工具执行失败、要让模型看到原因的错误（题目不存在、分类不对等），模型可以据此修正后重试 */
export class ToolError extends Error {}

const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v)

const toolError = (text: string) => ({ content: [{ type: 'text', text }], isError: true })

export function toolListing<Ctx>(tool: McpTool<Ctx>) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    // 提示客户端这个工具会不会改数据，客户端据此决定要不要先征求用户同意
    annotations: {
      title: tool.title,
      readOnlyHint: !tool.write,
      destructiveHint: false,
      idempotentHint: !tool.write,
      openWorldHint: false,
    },
  }
}

/** 请求里声明的新协议版本；没有 _meta 版本的是旧协议的请求 */
function metaOf(message: unknown): Record<string, any> {
  const params = isObject(message) && isObject(message.params) ? message.params : {}
  return isObject(params._meta) ? params._meta : {}
}

/** 这条消息是不是按 2026-07-28 起的新协议发的（_meta 里带了新版本号） */
export const isModernRequest = (message: unknown) => isModernVersion(metaOf(message)[META.protocolVersion])

/** 请求头里要和正文一致的名称：tools/call 和 prompts/get 是 params.name，resources/read 是 params.uri */
const NAME_FIELD: Record<string, 'name' | 'uri'> = { 'tools/call': 'name', 'prompts/get': 'name', 'resources/read': 'uri' }

/** 不是可见 ASCII 的值，客户端会编码成 =?base64?…?= 放进请求头 */
export function decodeHeaderValue(value: string | undefined): string | undefined {
  const encoded = value?.match(/^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/)
  return encoded ? Buffer.from(encoded[1]!, 'base64').toString('utf8') : value
}

/**
 * Streamable HTTP 把协议版本、方法和名称抄到请求头里（MCP-Protocol-Version、Mcp-Method、Mcp-Name），
 * 方便网关按头路由。2026-07-28 起服务端必须校验它们和正文一致，否则网关看到的和服务端执行的可能不是同一件事。
 * 返回不一致的原因；一致或者是旧协议的请求返回 null
 */
export function checkMirroredHeaders(message: unknown, headers: { version?: string; method?: string; name?: string }): string | null {
  const bodyVersion = metaOf(message)[META.protocolVersion]
  if (!isModernVersion(bodyVersion) && !isModernVersion(headers.version)) return null
  if (headers.version !== bodyVersion) {
    return `Header mismatch: MCP-Protocol-Version header ${headers.version ? `'${headers.version}'` : 'is missing'}, body declares '${String(bodyVersion ?? '')}'`
  }
  const method = isObject(message) ? message.method : undefined
  if (headers.method !== method) {
    return `Header mismatch: Mcp-Method header ${headers.method ? `'${headers.method}'` : 'is missing'}, body method is '${String(method)}'`
  }
  const field = typeof method === 'string' ? NAME_FIELD[method] : undefined
  if (field) {
    const bodyName = (message as Record<string, any>).params?.[field]
    const name = decodeHeaderValue(headers.name)
    if (name === undefined) return 'Header mismatch: Mcp-Name header is missing'
    if (name !== bodyName) return `Header mismatch: Mcp-Name header value '${name}' does not match body value '${String(bodyName)}'`
  }
  return null
}

type Handled = { result: Record<string, unknown> } | { error: { code: number; message: string } }

async function callTool<Ctx>(
  def: McpServerDef<Ctx>,
  ctx: Ctx,
  params: Record<string, any>,
  options: { canWrite: boolean; onError?: (error: unknown) => void },
): Promise<Handled> {
  const tool = def.tools.find((t) => t.name === params.name && (options.canWrite || !t.write))
  if (!tool) {
    if (def.tools.some((t) => t.name === params.name)) {
      return { result: toolError('这个访问令牌是只读的，不能记录答题结果。需要的话，在网站的"接入 AI 工具"页面创建一个可写入的令牌') }
    }
    return { error: { code: RPC_ERROR.invalidParams, message: `Unknown tool: ${String(params.name)}` } }
  }
  const parsed = tool.args.safeParse(params.arguments ?? {})
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { result: toolError(`参数不对：${issue?.path.join('.') || '参数'} ${issue?.message ?? ''}`.trim()) }
  }
  try {
    return { result: { content: [{ type: 'text', text: await tool.run(ctx, parsed.data) }] } }
  } catch (error) {
    if (error instanceof ToolError) return { result: toolError(error.message) }
    options.onError?.(error)
    return { result: toolError('工具执行出错，请稍后再试') }
  }
}

function getPrompt<Ctx>(def: McpServerDef<Ctx>, params: Record<string, any>): Handled {
  const prompt = def.prompts.find((p) => p.name === params.name)
  if (!prompt) return { error: { code: RPC_ERROR.invalidParams, message: `Unknown prompt: ${String(params.name)}` } }
  const args: Record<string, string> = {}
  if (isObject(params.arguments)) for (const [k, v] of Object.entries(params.arguments)) if (v != null) args[k] = String(v)
  const missing = prompt.arguments.find((a) => a.required && !args[a.name]?.trim())
  if (missing) return { error: { code: RPC_ERROR.invalidParams, message: `Missing required argument: ${missing.name}` } }
  return {
    result: {
      description: prompt.description,
      messages: [{ role: 'user', content: { type: 'text', text: prompt.build(args) } }],
    },
  }
}

const promptListing = <Ctx>(def: McpServerDef<Ctx>) => def.prompts.map(({ build: _build, ...p }) => p)

/**
 * 处理一条 JSON-RPC 消息。协议错误（方法不存在、工具不存在）用 JSON-RPC error；
 * 工具执行出错用 isError 结果返回，模型能看到原因并自己修正
 */
export async function handleMcpMessage<Ctx>(
  def: McpServerDef<Ctx>,
  ctx: Ctx,
  message: unknown,
  options: { canWrite: boolean; onError?: (error: unknown) => void },
): Promise<McpOutcome> {
  if (!isObject(message) || message.jsonrpc !== '2.0') return json(rpcError(null, RPC_ERROR.invalidRequest, 'Invalid Request'))
  if (!('method' in message)) return null
  const hasId = 'id' in message && message.id !== undefined
  if (typeof message.method !== 'string') return json(rpcError(hasId ? message.id : null, RPC_ERROR.invalidRequest, 'Invalid Request: method'))
  // 通知：notifications/initialized、notifications/cancelled 等，无状态服务不需要处理
  if (!hasId) return null
  const id = message.id
  if (typeof id !== 'string' && typeof id !== 'number') return json(rpcError(null, RPC_ERROR.invalidRequest, 'Invalid Request: id'))
  const params = isObject(message.params) ? message.params : {}

  const version = metaOf(message)[META.protocolVersion]
  // _meta 里没有版本、或者写的是旧版本号：按握手式的旧协议处理
  if (version === undefined || (typeof version === 'string' && MCP_LEGACY_VERSIONS.includes(version))) {
    return handleLegacy(def, ctx, id, message.method, params, options)
  }
  if (!isModernVersion(version)) return json(unsupportedVersionError(id, version), 400)
  if (!isObject(metaOf(message)[META.clientCapabilities])) {
    return json(rpcError(id, RPC_ERROR.invalidParams, `Missing required _meta field: ${META.clientCapabilities}`), 400)
  }
  return handleModern(def, ctx, id, message.method, params, options)
}

async function handleLegacy<Ctx>(
  def: McpServerDef<Ctx>,
  ctx: Ctx,
  id: string | number,
  method: string,
  params: Record<string, any>,
  options: { canWrite: boolean; onError?: (error: unknown) => void },
): Promise<McpOutcome> {
  const reply = (handled: Handled) => json('error' in handled ? rpcError(id, handled.error.code, handled.error.message) : rpcResult(id, handled.result))
  switch (method) {
    case 'initialize':
      return json(
        rpcResult(id, {
          protocolVersion: negotiateVersion(params.protocolVersion),
          capabilities: CAPABILITIES,
          serverInfo: def.info,
          instructions: def.instructions,
        }),
      )
    case 'ping':
      return json(rpcResult(id, {}))
    case 'tools/list':
      return json(rpcResult(id, { tools: def.tools.filter((t) => options.canWrite || !t.write).map(toolListing) }))
    case 'tools/call':
      return reply(await callTool(def, ctx, params, options))
    case 'prompts/list':
      return json(rpcResult(id, { prompts: promptListing(def) }))
    case 'prompts/get':
      return reply(getPrompt(def, params))
    default:
      return json(rpcError(id, RPC_ERROR.methodNotFound, `Method not found: ${method}`))
  }
}

async function handleModern<Ctx>(
  def: McpServerDef<Ctx>,
  ctx: Ctx,
  id: string | number,
  method: string,
  params: Record<string, any>,
  options: { canWrite: boolean; onError?: (error: unknown) => void },
): Promise<McpOutcome> {
  // 每个结果都带 resultType，并在 _meta 里自报身份：新协议没有握手，客户端只能从每个结果里知道是谁在回答
  const complete = (result: Record<string, unknown>) =>
    json(rpcResult(id, { resultType: 'complete', ...result, _meta: { [META.serverInfo]: def.info } }))
  const reply = (handled: Handled) => ('error' in handled ? json(rpcError(id, handled.error.code, handled.error.message)) : complete(handled.result))
  switch (method) {
    case 'server/discover':
      return complete({
        supportedVersions: MCP_PROTOCOL_VERSIONS,
        capabilities: CAPABILITIES,
        instructions: def.instructions,
        ttlMs: LIST_TTL_MS,
        cacheScope: 'public',
      })
    case 'tools/list':
      // 只读令牌看到的工具更少，结果因令牌而异，只能按令牌各自缓存（private）
      return complete({ tools: def.tools.filter((t) => options.canWrite || !t.write).map(toolListing), ttlMs: LIST_TTL_MS, cacheScope: 'private' })
    case 'tools/call':
      return reply(await callTool(def, ctx, params, options))
    case 'prompts/list':
      return complete({ prompts: promptListing(def), ttlMs: LIST_TTL_MS, cacheScope: 'public' })
    case 'prompts/get':
      return reply(getPrompt(def, params))
    case 'subscriptions/listen':
      // 工具和提示词列表不会在运行中变化，没有可推送的通知：确认订阅（不承诺任何通知类型），
      // 然后马上给出正常结束的结果。客户端看到正常结束，不会当成断线去重连
      return {
        stream: [
          {
            jsonrpc: '2.0',
            method: 'notifications/subscriptions/acknowledged',
            params: { _meta: { [META.subscriptionId]: id }, notifications: {} },
          },
          rpcResult(id, { resultType: 'complete', _meta: { [META.subscriptionId]: id, [META.serverInfo]: def.info } }),
        ],
      }
    default:
      // 包括 initialize 和 ping：新协议里已经没有这两个方法
      return json(rpcError(id, RPC_ERROR.methodNotFound, `Method not found: ${method}`), 404)
  }
}
