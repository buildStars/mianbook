// markdown-it-container 没有自带类型，这里按它的源码补上（只用于类型检查）
declare module 'markdown-it-container' {
  import type { MarkdownIt, RendererRule } from 'markdown-it'

  interface ContainerOptions {
    /** 判断 ::: 后面的内容是否属于这个容器，默认比较第一个单词是不是 name */
    validate?: (params: string, markup: string) => boolean
    /** 渲染开、闭标签，token.nesting 为 1 是开标签，-1 是闭标签 */
    render?: RendererRule
    /** 容器标记字符，默认 ':' */
    marker?: string
  }

  export default function container(md: MarkdownIt, name: string, options?: ContainerOptions): void
}
