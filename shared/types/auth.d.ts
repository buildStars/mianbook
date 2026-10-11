declare module '#auth-utils' {
  interface User {
    id: number
    name: string
    email: string
    role: 'admin' | 'user'
  }
}

export {}
