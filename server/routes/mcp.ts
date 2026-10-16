import type { H3Event } from 'h3'
import { TokenError, authenticateApiToken, tokenRateLimited, type TokenOwner } from '../utils/api-token'
import { RPC_ERROR, handleMcpMessage, isSupportedVersion, rpcError, type RpcResponse } from '../utils/mcp-protocol'
import { mcpServerDef } from '../utils/mcp-tools'

/**
 * MCP Server 的传输层：Streamable HTTP 的无状态模式。每个 POST 里是一条（或一批）JSON-RPC 消息，
 * 直接返回 JSON；不建会话、不推送服务端通知，所以 GET（订阅推送）和 DELETE（结束会话）都回 405。
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

  // 初始化之后客户端每个请求都会带协议版本；不认识的版本按规范回 400
  const version = getHeader(event, 'mcp-protocol-version')
  if (version && !isSupportedVersion(version)) return reply(event, 400, rpcError(null, RPC_ERROR.invalidRequest, `不支持的协议版本：${version}`))

  if (Number(getHeader(event, 'content-length') ?? 0) > MAX_BODY) return reply(event, 413, rpcError(null, RPC_ERROR.invalidRequest, '请求太大'))
  const raw = await readRawBody(event, 'utf8')
  if (!raw || raw.length > MAX_BODY) return reply(event, 400, rpcError(null, RPC_ERROR.parse, 'Parse error'))
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return reply(event, 400, rpcError(null, RPC_ERROR.parse, 'Parse error'))
  }

  // 2025-06-18 起规范去掉了批量请求，这里仍然兼容旧版本客户端
  const batch = Array.isArray(body)
  const messages = batch ? (body as unknown[]) : [body]
  if (!messages.length) return reply(event, 400, rpcError(null, RPC_ERROR.invalidRequest, 'Invalid Request'))

  const def = await mcpServerDef(origin)
  const ctx = { userId: owner.user.id, baseUrl: origin }
  const responses: RpcResponse[] = []
  for (const message of messages) {
    const res = await handleMcpMessage(def, ctx, message, {
      canWrite: owner.scope === 'write',
      onError: (error) => console.error('[mcp] 工具执行出错', error),
    })
    if (res) responses.push(res)
  }
  // 只有通知或响应时，按规范回 202 且没有正文
  if (!responses.length) return sendNoContent(event, 202)
  setResponseHeader(event, 'Content-Type', 'application/json')
  return batch ? responses : responses[0]
})
