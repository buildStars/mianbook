/** 个人访问令牌（不含令牌本身，令牌明文只在创建时返回一次） */
export interface ApiTokenView {
  id: number
  name: string
  /** 令牌开头几位，如 mbk_Ab3dEf7h */
  prefix: string
  scope: 'read' | 'write'
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
}
