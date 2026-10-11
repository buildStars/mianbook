---
difficulty: 1
tags: [高频, 实践]
---

# 策略模式是什么？怎么用它消除大量 if-else？

::: tip 一句话回答
策略模式把一组**可以互相替换的算法**分别封装成独立的策略，使用方只负责选出策略并调用，不关心具体怎么算。JS 里最常见的写法是**对象映射**：键是策略名，值是函数，原来 `if-else` 或 `switch` 的每个分支变成一个策略函数，选择策略就是一次查表。新增规则时只需添加一个策略，调用逻辑不用改，符合**开闭原则**。分支很少、条件不是单一的取值、规则也很少变化时，直接写 if-else 反而更清楚。
:::

## 详细解析

### 例一：会员折扣

改造前，所有规则挤在一个函数里，每加一个会员等级都要修改它（金额以分为单位，避免小数的精度问题，原因见 [0.1 + 0.2 为什么不等于 0.3](/basics/javascript/20-float-precision)）：

```js
function getPrice(level, price) {
  if (level === 'normal') {
    return price
  } else if (level === 'vip') {
    return Math.round(price * 0.9)
  } else if (level === 'svip') {
    // 八折，满 200 元再减 20 元
    return Math.round(price * 0.8) - (price >= 20000 ? 2000 : 0)
  } else {
    throw new Error(`未知的会员等级：${level}`)
  }
}
```

改造后，每条规则是一个独立的策略，`getPrice` 只负责查找和调用：

```js
const discountStrategies = {
  normal: (price) => price,
  vip: (price) => Math.round(price * 0.9),
  svip: (price) => Math.round(price * 0.8) - (price >= 20000 ? 2000 : 0),
}

function getPrice(level, price) {
  // 用 Object.hasOwn 判断，避免 level 是 'toString' 这类原型上的属性名时被误匹配
  if (!Object.hasOwn(discountStrategies, level)) throw new Error(`未知的会员等级：${level}`)
  return discountStrategies[level](price)
}

console.log(getPrice('vip', 9999))   // 8999
console.log(getPrice('svip', 25000)) // 18000

// 新增一个等级：只加一个策略，getPrice 不用改
discountStrategies.partner = (price) => Math.round(price * 0.7)
```

### 例二：表单校验规则

每条校验规则是一个策略，返回 `true` 表示通过，返回字符串表示错误信息。字段声明自己要用哪些规则，校验函数按顺序执行：

```js
const rules = {
  required: (value) => (value !== '' && value != null) || '不能为空',
  minLength: (value, len) => String(value).length >= len || `至少 ${len} 个字符`,
  mobile: (value) => /^1\d{10}$/.test(value) || '手机号格式不正确',
}

function validate(value, ruleList) {
  for (const [name, ...args] of ruleList) {
    const result = rules[name](value, ...args)
    if (result !== true) return result // 返回第一条错误信息
  }
  return true
}

console.log(validate('', [['required']]))                // 不能为空
console.log(validate('138', [['required'], ['mobile']])) // 手机号格式不正确
console.log(validate('abc', [['minLength', 6]]))         // 至少 6 个字符
```

Element Plus、Ant Design 等组件库的表单 `rules` 配置也是这个思路：校验逻辑写成可复用的规则，由表单按配置调用。至于多条规则怎么串联、遇到异步校验时怎么提前结束，属于[职责链模式](/basics/design-pattern/08-chain-of-responsibility)关心的问题。

### 开闭原则

- **对扩展开放**：新增会员等级、新增校验规则，只需要增加一个策略
- **对修改关闭**：`getPrice`、`validate` 这些使用策略的代码保持不变，已经测试过的逻辑不受影响
- 每个策略都是独立的小函数，可以单独测试；策略名还可以来自配置，比如后端返回 `{ level: 'svip' }`，前端按名字查表

### 什么时候 if-else 更合适

- 只有两三个分支，而且很少变化：拆成策略只会让人在几处代码之间来回跳
- 条件不是一个离散的取值，而是范围或多个条件的组合，比如 `age < 18 && region === 'CN'`，没法直接查表，用提前返回（卫语句）写清楚更好
- 各个分支要共享大量上下文，拆开后要传很多参数
- 策略模式不会让复杂度消失，只是把它分散到各个策略里，换来的是新增规则时的便利

## 面试官可能追问

::: details 用 TypeScript 怎么保证每个等级都有对应的策略？
用 `satisfies` 约束映射表的类型：联合类型里新增一个等级、却忘了写策略时，编译就会报错，策略函数的参数也能自动推断出类型：

```ts
type MemberLevel = 'normal' | 'vip' | 'svip'

const discountStrategies = {
  normal: (price) => price,
  vip: (price) => Math.round(price * 0.9),
  svip: (price) => Math.round(price * 0.8) - (price >= 20000 ? 2000 : 0),
} satisfies Record<MemberLevel, (price: number) => number>
```
:::

::: details 策略模式和状态模式有什么区别？
结构很像，都是把行为封装在独立的对象里，区别在于由谁切换。策略由**使用方**根据场景选择，策略之间互不知道；状态模式中，对象根据**自身状态**切换行为，各个状态知道下一步转到哪里。比如订单从"待支付"到"已支付"再到"已发货"，每个状态决定当前允许哪些操作、操作之后进入哪个状态。
:::

::: details 策略和后端配置怎么结合？
后端可以下发策略名和参数，比如 `{ type: 'fullReduction', threshold: 20000, minus: 2000 }`，前端用带参数的策略函数计算。策略的代码本身必须写在前端，不能执行后端下发的代码。前端的计算结果只用于展示，下单金额以后端的计算为准。
:::

## 易错点

- 用普通对象做映射表、键又来自外部输入时，要用 `Object.hasOwn` 或 `Map`，否则 `'constructor'`、`'toString'` 这类名字会命中原型上的属性
- 各个策略的参数和返回值要保持一致，否则调用方还得区分对待
- 找不到策略时要抛错或使用默认策略，不要静默地返回 `undefined`
