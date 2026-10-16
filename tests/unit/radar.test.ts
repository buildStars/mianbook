import { describe, expect, it } from 'vitest'
import { cleanTitle, clusterItems, containment, extractQuestions, grams, guessCategory, isNoise, looksLikeQuestion, similarity, strongGrams } from '../../scripts/lib/radar'

describe('选题雷达', () => {
  it('去掉编号前缀和 Markdown 标记', () => {
    expect(cleanTitle('第 12 题：写 React 项目时为什么要给列表加 key？')).toBe('写 React 项目时为什么要给列表加 key？')
    expect(cleanTitle('[js] 第3天 说说 `this` 的指向')).toBe('说说 this 的指向')
    expect(cleanTitle('1. [为什么使用消息队列？](docs/mq.md)')).toBe('为什么使用消息队列？')
    expect(cleanTitle('**Q2.** 什么是 MVCC')).toBe('什么是 MVCC')
  })

  it('只保留像面试题的句子', () => {
    expect(looksLikeQuestion('Redis 为什么这么快？')).toBe(true)
    expect(looksLikeQuestion('HashMap 的底层实现原理')).toBe(true)
    expect(looksLikeQuestion('目录')).toBe(false)
    expect(looksLikeQuestion('Introduction to Redis?')).toBe(false)
  })

  it('从 Markdown 的标题和列表里提取问题，跳过代码块', () => {
    const md = ['# Java 面试题', '## 基础', '### 什么是自动装箱？', '- [HashMap 和 Hashtable 的区别？](a.md)', '```java', '// 为什么这里会报错？', '```', '- 参考资料']
    expect(extractQuestions(md.join('\n'))).toEqual(['什么是自动装箱？', 'HashMap 和 Hashtable 的区别？'])
  })

  it('同一道题的不同问法相似度高，不同的题相似度低', () => {
    const a = grams('说说你对闭包的理解')
    const b = grams('闭包是什么？')
    const c = grams('Redis 持久化有哪几种方式')
    expect(similarity(a, b)).toBe(1)
    expect(similarity(a, c)).toBe(0)
    expect(similarity(grams('useEffect 的依赖数组怎么写'), grams('useEffect 依赖数组'))).toBeGreaterThan(0.8)
  })

  it('合并成话题：按来源数排序，代表说法取最短的', () => {
    const clusters = clusterItems([
      { text: '说说你对闭包的理解', source: 'a', url: 'u1' },
      { text: '闭包是什么', source: 'b', url: 'u2' },
      { text: '什么是闭包？', source: 'b', url: 'u3' },
      { text: 'Redis 为什么快', source: 'a', url: 'u4' },
    ])
    expect(clusters.map((c) => [c.title, c.sources, c.items.length])).toEqual([
      ['闭包是什么', 2, 3],
      ['Redis 为什么快', 1, 1],
    ])
  })

  it('按关键词猜分类', () => {
    expect(guessCategory('ReAct 框架和 Function Calling 有什么关系')).toBe('ai/agent')
    expect(guessCategory('React 的 Fiber 是什么')).toBe('basics/react')
    expect(guessCategory('MySQL 的 MVCC 原理')).toBe('basics/mysql')
    expect(guessCategory('Kafka 怎么保证消息不丢')).toBe('basics/distributed')
    expect(guessCategory('如何写一份好的简历')).toBeNull()
  })
})

describe('选题雷达：过滤和正文覆盖', () => {
  it('离开正文看不懂的标题算噪音', () => {
    expect(isNoise('写出下面代码的输出结果')).toBe(true)
    expect(isNoise('以下代码在浏览器里会打印什么？')).toBe(true)
    expect(isNoise('Redis 为什么这么快？')).toBe(false)
  })

  it('包含度只看词，单个汉字不算', () => {
    const topic = strongGrams(grams('什么是 I/O 多路复用？'))
    expect([...topic].sort()).toEqual(['w:i', 'w:o', '多路', '复用', '路复'].sort())
    expect(containment(topic, grams('select、poll、epoll 都是 I/O 多路复用的实现'))).toBe(1)
    expect(containment(topic, grams('Vue 的生命周期'))).toBe(0)
  })
})
