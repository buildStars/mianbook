import type { AiKind } from '../types/admin'

/** 用到 AI 的功能，顺序就是后台列表里的顺序 */
export const AI_KINDS: AiKind[] = ['interview', 'agent', 'ask', 'report', 'resume', 'author']

/** 后台显示的功能名 */
export const AI_KIND_LABELS: Record<AiKind, string> = {
  interview: 'AI 单题面试',
  agent: 'Agent 面试',
  ask: '问手册',
  report: '模拟面试总结',
  resume: '简历出题',
  author: '后台 AI 写题',
}

/** ai_calls.kind 的显示名：用户自己的 Key 记为 xxx-own，显示同一个名字 */
export const aiKindLabel = (kind: string) => AI_KIND_LABELS[kind.replace(/-own$/, '') as AiKind] ?? kind
