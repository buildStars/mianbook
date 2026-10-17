import type { H3Event } from 'h3'
import { TokenError, authenticateApiToken, tokenRateLimited, type TokenOwner } from '../utils/api-token'
import {
  RPC_ERROR,
  checkMirroredHeaders,
  handleMcpMessage,
  isModernRequest,
  isSupportedVersion,
  rpcError,
  unsupportedVersionError,
  type RpcResponse,
} from '../utils/mcp-protocol'
import { mcpServerDef } from '../utils/mcp-tools'

/**
 * MCP Server 的传输层：Streamable HTTP，不建会话。每个 POST 里是一条 JSON-RPC 消息（旧协议还允许批量），
 * 直接返回 JSON；只有 subscriptions/listen 返回一段 SSE 流。2026-07-28 起协议本身就是无状态的；
 * 旧协议的客户端照常先 initialize，我们也不发会话 ID，所以 GET（订阅推送）和 DELETE（结束会话）都回 405。
 * 鉴权用个人访问令牌（Authorization: Bearer mbk_…），工具只能访问令牌主人的数据
 */
const MAX_BODY = 1_000_000

function reply(event: H3Event, status: number, body: RpcResponse) {
  setResponseStatus(event, status)
  setResponseHeader(event, 'Content-Type', 'application/json')
  return body
}

/** 对外的站点地址：部署在 Caddy 后面时按 X-Forwarded-* 取 https 和域名 */
function publicOrigin(event: H3Event) {
  const trust = Boolean(useRuntimeConfig().auth.trustProxy)
  return getRequestURL(event, { xForwardedHost: trust, xForwardedProto: trust }).origin
}

const idOf = (message: unknown) => {
  const id = (message as { id?: unknown } | null)?.id
  return typeof id === 'string' || typeof id === 'number' ? id : null
}

export default defineEventHandler(async (event) => {
  const origin = publicOrigin(event)
  // 规范要求校验 Origin：浏览器里别的网站发来的请求一律拒绝（防 DNS 重绑定和跨站请求）；命令行客户端不带 Origin
  const requestOrigin = getHeader(event, 'origin')
  if (requestOrigin && requestOrigin !== origin) return reply(event, 403, rpcError(null, -32000, '不允许从这个来源访问'))

  if (event.method !== 'POST') {
    // 用浏览器直接打开这个地址时，跳到接入说明页
    if (event.method === 'GET' && (getHeader(event, 'accept') ?? '').includes('text/html')) return sendRedirect(event, '/connect', 302)
    setResponseHeader(event, 'Allow', 'POST')
    return reply(event, 405, rpcError(null, -32000, '这是无状态的 MCP 服务，只接受 POST'))
  }

  let owner: TokenOwner
  try {
    owner = await authenticateApiToken(event)
  } catch (error) {
    if (!(error instanceof TokenError)) throw error
    setResponseHeader(event, 'WWW-Authenticate', 'Bearer realm="mianbook", error="invalid_token"')
    return reply(event, 401, rpcError(null, -32001, error.message))
  }
  if (tokenRateLimited(owner.tokenId)) {
    setResponseHeader(event, 'Retry-After', 60)
    return reply(event, 429, rpcError(null, -32002, '请求太频繁，请一分钟后再试'))
  }

  if (Number(getHeader(event, 'content-length') ?? 0) > MAX_BODY) return reply(event, 413, rpcError(null, RPC_ERROR.invalidRequest, '请求太大'))
  const raw = await readRawBody(event, 'utf8')
  if (!raw || raw.length > MAX_BODY) return reply(event, 400, rpcError(null, RPC_ERROR.parse, 'Parse error'))
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return reply(event, 400, rpcError(null, RPC_ERROR.parse, 'Parse error'))
  }

  // 2025-06-18 起规范去掉了批量请求，这里只为旧版本客户端保留
  const batch = Array.isArray(body)
  const messages = batch ? (body as unknown[]) : [body]
  if (!messages.length) return reply(event, 400, rpcError(null, RPC_ERROR.invalidRequest, 'Invalid Request'))
  if (batch && messages.some(isModernRequest)) return reply(event, 400, rpcError(null, RPC_ERROR.invalidRequest, '2026-07-28 起不支持批量请求'))

  const headerVersion = getHeader(event, 'mcp-protocol-version')
  if (!batch) {
    // 2026-07-28 起：请求头里的版本、方法、名称必须和正文一致
    const mismatch = checkMirroredHeaders(body, {
      version: headerVersion,
      method: getHeader(event, 'mcp-method'),
      name: getHeader(event, 'mcp-name'),
    })
    if (mismatch) return reply(event, 400, rpcError(idOf(body), RPC_ERROR.headerMismatch, mismatch))
  }
  // 旧协议的客户端初始化之后，每个请求都带协商出的版本；不认识的版本回 400，并列出我们支持的版本
  if (headerVersion && !isSupportedVersion(headerVersion)) return reply(event, 400, unsupportedVersionError(batch ? null : idOf(body), headerVersion))

  const def = await mcpServerDef(origin)
  const ctx = { userId: owner.user.id, baseUrl: origin }
  const options = { canWrite: owner.scope === 'write', onError: (error: unknown) => console.error('[mcp] 工具执行出错', error) }

  if (!batch) {
    const outcome = await handleMcpMessage(def, ctx, body, options)
    // 只有通知或响应时，按规范回 202 且没有正文
    if (!outcome) return sendNoContent(event, 202)
    if ('stream' in outcome) {
      setResponseHeader(event, 'Content-Type', 'text/event-stream')
      setResponseHeader(event, 'Cache-Control', 'no-cache')
      // 让 Caddy、nginx 这类反向代理不要缓冲 SSE
      setResponseHeader(event, 'X-Accel-Buffering', 'no')
      return outcome.stream.map((m) => `event: message\ndata: ${JSON.stringify(m)}\n\n`).join('')
    }
    return reply(event, outcome.status, outcome.response)
  }

  const responses: RpcResponse[] = []
  for (const message of messages) {
    const outcome = await handleMcpMessage(def, ctx, message, options)
    if (outcome && 'response' in outcome) responses.push(outcome.response)
  }
  if (!responses.length) return sendNoContent(event, 202)
  setResponseHeader(event, 'Content-Type', 'application/json')
  return responses
})
