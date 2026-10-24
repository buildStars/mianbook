import { Agent, fetch as undiciFetch } from 'undici'

/**
 * 调向量、重排接口用的 fetch：连接空闲 60 秒内不断开。
 *
 * Node 自带的 fetch 空闲 4 秒就关连接（硅基流动不回 Keep-Alive: timeout 提示，客户端自己定），
 * 首尔到硅基流动重新握手要多 0.2–0.3 秒。问手册和 TalkCue 查题库每个问题都要先算问题向量，
 * 问题之间常常隔几十秒：TalkCue 实测停 15–75 秒后查一次要 0.62–0.70 秒，连着问只要 0.3 秒。
 *
 * 用 undici 自己的 fetch 配自己的连接池，不设成全局的：这里的 undici 是 8，
 * Node 自带的 fetch 里是 7，两个版本混用不保证兼容
 */
const agent = new Agent({ keepAliveTimeout: 60_000, keepAliveMaxTimeout: 120_000 })

export const keepAliveFetch = ((input: string | URL, init?: RequestInit) =>
  undiciFetch(input, { ...(init as object), dispatcher: agent })) as unknown as typeof fetch
