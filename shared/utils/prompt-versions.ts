import type { AiKind } from '../types/admin'

/**
 * 每种 AI 调用当前用的提示词版本。改了提示词就把版本加 1：
 * 调用记录（ai_calls.prompt_version）和打分评测（npm run eval:scoring）的结果都带着版本，方便对比改动前后的效果
 */
export const PROMPT_VERSIONS: Record<AiKind, string> = {
  interview: 'interview-v1',
  ask: 'ask-v1',
  agent: 'agent-v1',
  report: 'report-v1',
  resume: 'resume-v1',
  author: 'author-v1',
}
