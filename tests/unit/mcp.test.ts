import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { bearerToken, generateApiToken, hashApiToken, tokenRateLimited } from '../../server/utils/api-token'
import { MCP_LATEST_VERSION, ToolError, handleMcpMessage, negotiateVersion, type McpServerDef } from '../../server/utils/mcp-protocol'

const def: McpServerDef<{ userId: number }> = {
  info: { name: 'test', title: '测试', version: '1.0.0' },
  instructions: '说明',
  tools: [
    {
      name: 'echo',
      title: '回声',
      description: '原样返回',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      args: z.object({ text: z.string().min(1) }),
      run: async (ctx, { text }) => `${ctx.userId}:${text}`,
    },
    {
      name: 'fail',
      title: '失败',
      description: '总是失败',
      inputSchema: { type: 'object', properties: { kind: { type: 'string' } } },
      args: z.object({ kind: z.string().default('tool') }),
      run: async (_ctx, { kind }) => {
        throw kind === 'tool' ? new ToolError('题目不存在') : new Error('数据库连不上')
      },
    },
    {
      name: 'save',
      title: '写入',
      description: '会写数据',
      inputSchema: { type: 'object', properties: {} },
      write: true,
      args: z.object({}),
      run: async () => '已保存',
    },
  ],
  prompts: [
    {
      name: 'explain',
      title: '解释',
      description: '解释一个问题',
      arguments: [{ name: 'question', description: '问题', required: true }],
      build: ({ question }) => `请解释：${question}`,
    },
  ],
}

const ctx = { userId: 7 }
const call = (message: unknown, canWrite = true, onError?: (e: unknown) => void) => handleMcpMessage(def, ctx, message, { canWrite, onError })
const req = (method: string, params?: unknown, id: string | number = 1) => ({ jsonrpc: '2.0', id, method, params })

describe('MCP 协议', () => {
  it('initialize：协商协议版本，声明 tools 和 prompts 能力', async () => {
    const res = await call(req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } }))
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: def.info,
        instructions: '说明',
      },
    })
    // 不认识的版本：回复我们支持的最新版本
    expect(negotiateVersion('2099-01-01')).toBe(MCP_LATEST_VERSION)
    expect(negotiateVersion(undefined)).toBe(MCP_LATEST_VERSION)
  })

  it('通知和客户端发来的响应不回复；ping 回空对象', async () => {
    expect(await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
    expect(await call({ jsonrpc: '2.0', id: 3, result: {} })).toBeNull()
    expect(await call(req('ping', undefined, 'p1'))).toEqual({ jsonrpc: '2.0', id: 'p1', result: {} })
  })

  it('格式不对的消息和不存在的方法返回 JSON-RPC 错误', async () => {
    expect(await call({ id: 1, method: 'ping' })).toMatchObject({ id: null, error: { code: -32600 } })
    expect(await call({ jsonrpc: '2.0', id: { x: 1 }, method: 'ping' })).toMatchObject({ id: null, error: { code: -32600 } })
    expect(await call(req('resources/list'))).toMatchObject({ id: 1, error: { code: -32601, message: 'Method not found: resources/list' } })
  })

  it('tools/list：只读令牌看不到会写数据的工具；带上只读、幂等等提示', async () => {
    const all = (await call(req('tools/list')))!.result as any
    expect(all.tools.map((t: any) => t.name)).toEqual(['echo', 'fail', 'save'])
    expect(all.tools[0].annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true, destructiveHint: false })
    expect(all.tools[2].annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false })
    const readOnly = (await call(req('tools/list'), false))!.result as any
    expect(readOnly.tools.map((t: any) => t.name)).toEqual(['echo', 'fail'])
  })

  it('tools/call：成功返回文本；参数不对和工具出错用 isError 返回给模型', async () => {
    expect((await call(req('tools/call', { name: 'echo', arguments: { text: 'hi' } })))!.result).toEqual({ content: [{ type: 'text', text: '7:hi' }] })
    const bad = (await call(req('tools/call', { name: 'echo', arguments: { text: '' } })))!.result as any
    expect(bad.isError).toBe(true)
    expect(bad.content[0].text).toMatch(/^参数不对：text/)
    expect((await call(req('tools/call', { name: 'fail' })))!.result).toEqual({ content: [{ type: 'text', text: '题目不存在' }], isError: true })

    // 意外的错误不把细节返回给客户端，只记日志
    const onError = vi.fn()
    const internal = (await call(req('tools/call', { name: 'fail', arguments: { kind: 'db' } }), true, onError))!.result as any
    expect(internal).toEqual({ content: [{ type: 'text', text: '工具执行出错，请稍后再试' }], isError: true })
    expect(onError).toHaveBeenCalledOnce()
  })

  it('tools/call：不存在的工具是协议错误；只读令牌调用写工具时说明原因', async () => {
    expect(await call(req('tools/call', { name: 'nope' }))).toMatchObject({ error: { code: -32602, message: 'Unknown tool: nope' } })
    const denied = (await call(req('tools/call', { name: 'save', arguments: {} }), false))!.result as any
    expect(denied.isError).toBe(true)
    expect(denied.content[0].text).toContain('只读')
  })

  it('prompts：列表不带内部的 build；缺少必填参数时报错', async () => {
    const list = (await call(req('prompts/list')))!.result as any
    expect(list.prompts).toEqual([{ name: 'explain', title: '解释', description: '解释一个问题', arguments: [{ name: 'question', description: '问题', required: true }] }])
    expect(await call(req('prompts/get', { name: 'explain', arguments: {} }))).toMatchObject({ error: { code: -32602, message: 'Missing required argument: question' } })
    expect((await call(req('prompts/get', { name: 'explain', arguments: { question: 'MVCC' } })))!.result).toEqual({
      description: '解释一个问题',
      messages: [{ role: 'user', content: { type: 'text', text: '请解释：MVCC' } }],
    })
  })
})

describe('访问令牌', () => {
  it('格式：mbk_ 加 40 位，只存哈希，列表里显示前 12 位', () => {
    const { token, hash, prefix } = generateApiToken()
    expect(token).toMatch(/^mbk_[\w-]{40}$/)
    expect(hash).toBe(hashApiToken(token))
    expect(hash).toHaveLength(64)
    expect(prefix).toBe(token.slice(0, 12))
    expect(generateApiToken().token).not.toBe(token)
  })

  it('只接受 Authorization: Bearer 里格式正确的令牌', () => {
    const { token } = generateApiToken()
    expect(bearerToken(`Bearer ${token}`)).toBe(token)
    expect(bearerToken(`bearer ${token}`)).toBe(token)
    expect(bearerToken(token)).toBeNull()
    expect(bearerToken('Bearer mbk_short')).toBeNull()
    expect(bearerToken(undefined)).toBeNull()
  })

  it('每个令牌每分钟 60 次，下一分钟重新计数', () => {
    const t0 = 1_000_000
    for (let i = 0; i < 60; i++) expect(tokenRateLimited(42, 60, t0 + i)).toBe(false)
    expect(tokenRateLimited(42, 60, t0 + 100)).toBe(true)
    expect(tokenRateLimited(43, 60, t0 + 100)).toBe(false)
    expect(tokenRateLimited(42, 60, t0 + 60_000)).toBe(false)
  })
})
