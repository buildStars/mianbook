declare module '#auth-utils' {
  interface User {
    id: number
    name: string
    email: string
    role: 'admin' | 'user'
  }

  /** 只在服务端可见的会话数据 */
  interface SecureSessionData {
    /** 登录时用户的会话版本，改密码后对不上就失效 */
    sessionVersion?: number
  }
}

export {}
