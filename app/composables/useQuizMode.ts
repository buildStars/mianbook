/** 自测模式：先隐藏答案。存在 cookie 里，服务端渲染时就能知道，不会出现答案先闪一下的情况 */
export function useQuizMode() {
  return useCookie<boolean>('handbook-quiz', {
    default: () => false,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })
}
