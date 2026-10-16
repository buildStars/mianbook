import type { MockDifficulty } from '../types/handbook'

/** 整场模拟面试的方向预设，分类用"部分/分类"表示 */
export interface MockTrack {
  id: string
  name: string
  desc: string
  categories: string[]
  /** 重点分类：约 4 成的题从这里出，其余在其他分类里轮流抽 */
  focus?: string[]
}

export const MOCK_TRACKS: MockTrack[] = [
  {
    id: 'frontend',
    name: '前端工程师',
    desc: 'JS、CSS、浏览器、框架、工程化、手写题、SSR、跨端',
    focus: ['basics/javascript', 'basics/vue', 'basics/react'],
    categories: [
      'basics/javascript',
      'basics/handwriting',
      'basics/typescript',
      'basics/html',
      'basics/css',
      'basics/browser',
      'basics/web-security',
      'basics/network',
      'basics/vue',
      'basics/react',
      'basics/ssr',
      'basics/build',
      'basics/cross-platform',
    ],
  },
  {
    id: 'node-backend',
    name: 'Node.js 后端',
    desc: 'Node.js、数据库、缓存、分布式',
    focus: ['basics/node'],
    categories: ['basics/node', 'basics/javascript', 'basics/network', 'basics/mysql', 'basics/redis', 'basics/distributed', 'basics/os', 'basics/container'],
  },
  {
    id: 'go-backend',
    name: 'Go 后端',
    desc: 'Go、数据库、缓存、分布式、容器',
    focus: ['basics/go'],
    categories: ['basics/go', 'basics/network', 'basics/mysql', 'basics/redis', 'basics/distributed', 'basics/os', 'basics/container'],
  },
  {
    id: 'java-backend',
    name: 'Java 后端',
    desc: 'Java、数据库、缓存、分布式',
    focus: ['basics/java'],
    categories: ['basics/java', 'basics/network', 'basics/mysql', 'basics/redis', 'basics/distributed', 'basics/os', 'basics/design-pattern'],
  },
  {
    id: 'ai-engineer',
    name: 'AI 应用工程师',
    desc: 'LLM、Prompt、RAG、Agent、AI 工程化',
    categories: ['ai/llm', 'ai/prompt', 'ai/tools', 'ai/rag', 'ai/agent', 'engineering/streaming', 'engineering/eval', 'engineering/deploy', 'engineering/security', 'engineering/system-design'],
  },
  {
    id: 'fullstack',
    name: 'AI 全栈',
    desc: '前端、Node.js、数据库加 AI 应用',
    categories: ['basics/javascript', 'basics/vue', 'basics/react', 'basics/ssr', 'basics/node', 'basics/mysql', 'basics/redis', 'ai/llm', 'ai/rag', 'ai/agent', 'engineering/streaming'],
  },
]

export const MOCK_DIFFICULTIES: { value: MockDifficulty; label: string; desc: string }[] = [
  { value: 'mixed', label: '混合', desc: '由浅入深' },
  { value: 'basic', label: '基础', desc: '概念题为主' },
  { value: 'advanced', label: '进阶', desc: '常考原理' },
  { value: 'deep', label: '深入', desc: '原理和设计' },
]

export const MOCK_COUNTS = [5, 8, 10] as const
export const MOCK_MAX_FOLLOW_UPS = 2
