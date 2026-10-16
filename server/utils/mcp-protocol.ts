/**
 * MCP（Model Context Protocol）服务端的协议层：JSON-RPC 2.0 消息分发、协议版本协商、
 * tools 和 prompts 两种能力。纯函数，不依赖数据库和 HTTP，传输层在 server/routes/mcp.ts
 */
import type { z } from 'zod'

/** 支持的协议版本，新的在前；和官方 TypeScript SDK 1.31 一致 */
export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const
export const MCP_LATEST_VERSION = MCP_PROTOCOL_VERSIONS[0]

export const RPC_ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const

type RpcId = string | number | null

export interface RpcResponse {
  jsonrpc: '2.0'
  id: RpcId
  result?: unknown
  error?: { code: number; message: string }
}

export const rpcError = (id: RpcId, code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } })
const rpcResult = (id: RpcId, result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result })

/** 客户端请求的版本我们支持就用它，否则回复我们支持的最新版本，由客户端决定是否继续 */
export function negotiateVersion(requested: unknown): string {
  return typeof requested === 'string' && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : MCP_LATEST_VERSION
}

export const isSupportedVersion = (v: string) => (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(v)

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

/**
 * 处理一条 JSON-RPC 消息。请求返回响应；通知（没有 id）和客户端发来的响应返回 null，HTTP 层回 202。
 * 协议错误（方法不存在、工具不存在）用 JSON-RPC error；工具执行出错用 isError 结果返回，模型能看到原因并自己修正
 */
export async function handleMcpMessage<Ctx>(
  def: McpServerDef<Ctx>,
  ctx: Ctx,
  message: unknown,
  options: { canWrite: boolean; onError?: (error: unknown) => void },
): Promise<RpcResponse | null> {
  if (!isObject(message) || message.jsonrpc !== '2.0') return rpcError(null, RPC_ERROR.invalidRequest, 'Invalid Request')
  if (!('method' in message)) return null
  const hasId = 'id' in message && message.id !== undefined
  if (typeof message.method !== 'string') return rpcError(hasId ? message.id : null, RPC_ERROR.invalidRequest, 'Invalid Request: method')
  // 通知：notifications/initialized、notifications/cancelled 等，无状态服务不需要处理
  if (!hasId) return null
  const id = message.id
  if (typeof id !== 'string' && typeof id !== 'number') return rpcError(null, RPC_ERROR.invalidRequest, 'Invalid Request: id')
  const params = isObject(message.params) ? message.params : {}
  const visible = def.tools.filter((t) => options.canWrite || !t.write)

  switch (message.method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: negotiateVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: def.info,
        instructions: def.instructions,
      })
    case 'ping':
      return rpcResult(id, {})
    case 'tools/list':
      return rpcResult(id, { tools: visible.map(toolListing) })
    case 'tools/call': {
      const tool = visible.find((t) => t.name === params.name)
      if (!tool) {
        if (def.tools.some((t) => t.name === params.name)) {
          return rpcResult(id, toolError('这个访问令牌是只读的，不能记录答题结果。需要的话，在网站的"接入 AI 工具"页面创建一个可写入的令牌'))
        }
        return rpcError(id, RPC_ERROR.invalidParams, `Unknown tool: ${String(params.name)}`)
      }
      const parsed = tool.args.safeParse(params.arguments ?? {})
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        return rpcResult(id, toolError(`参数不对：${issue?.path.join('.') || '参数'} ${issue?.message ?? ''}`.trim()))
      }
      try {
        return rpcResult(id, { content: [{ type: 'text', text: await tool.run(ctx, parsed.data) }] })
      } catch (error) {
        if (error instanceof ToolError) return rpcResult(id, toolError(error.message))
        options.onError?.(error)
        return rpcResult(id, toolError('工具执行出错，请稍后再试'))
      }
    }
    case 'prompts/list':
      return rpcResult(id, { prompts: def.prompts.map(({ build: _build, ...p }) => p) })
    case 'prompts/get': {
      const prompt = def.prompts.find((p) => p.name === params.name)
      if (!prompt) return rpcError(id, RPC_ERROR.invalidParams, `Unknown prompt: ${String(params.name)}`)
      const args: Record<string, string> = {}
      if (isObject(params.arguments)) for (const [k, v] of Object.entries(params.arguments)) if (v != null) args[k] = String(v)
      const missing = prompt.arguments.find((a) => a.required && !args[a.name]?.trim())
      if (missing) return rpcError(id, RPC_ERROR.invalidParams, `Missing required argument: ${missing.name}`)
      return rpcResult(id, {
        description: prompt.description,
        messages: [{ role: 'user', content: { type: 'text', text: prompt.build(args) } }],
      })
    }
    default:
      return rpcError(id, RPC_ERROR.methodNotFound, `Method not found: ${message.method}`)
  }
}
