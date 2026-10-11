---
difficulty: 2
tags: [高频, 输出题]
---

# == 和 === 有什么区别？类型转换规则是什么？

::: tip 一句话回答
`===` 是严格相等，类型不同直接返回 false，不做任何转换；`==` 是宽松相等，类型不同时会先做**隐式类型转换**再比较：`null` 和 `undefined` 只和彼此相等，布尔值先转成数字，字符串和数字比较时字符串转成数字，对象和原始值比较时对象先转成原始值。业务代码统一用 `===`，只有判断"是 null 或 undefined"时可以用 `x == null`。
:::

## 详细解析

### === 和 Object.is

`===` 不做类型转换，类型和值都相同才相等，但有两个特例：`NaN === NaN` 是 false，`+0 === -0` 是 true。`Object.is` 修正了这两点，其余情况和 `===` 一致。

| 比较方式 | `NaN` 和 `NaN` | `+0` 和 `-0` |
| --- | --- | --- |
| `===` | false | true |
| `Object.is` | true | false |

另外，数组的 `includes` 以及 Map、Set 的键比较使用 SameValueZero 规则，认为 `NaN` 等于 `NaN`：`[NaN].includes(NaN)` 是 true，而基于 `===` 的 `[NaN].indexOf(NaN)` 是 -1。

### == 的转换规则

两边类型相同时，`==` 和 `===` 的结果一样（两个对象比较的是引用）。类型不同时，按下面的规则转换，直到能够比较：

1. `null` 和 `undefined` 互相相等，和其他任何值都不相等，不做转换
2. 有一边是布尔值时，先把布尔值转成数字：true 转成 1，false 转成 0
3. 数字和字符串比较，把字符串转成数字
4. 对象和原始值比较，先把对象转成原始值（ToPrimitive）：有 `Symbol.toPrimitive` 方法就优先调用它，否则按 hint 依次调用 `valueOf` / `toString`，取第一个原始值结果

数组和普通对象的 `valueOf` 返回对象本身，所以最终用的是 `toString`：`[]` 转成 `''`，`[1]` 转成 `'1'`，`[1, 2]` 转成 `'1,2'`，`{}` 转成 `'[object Object]'`。

### 常见输出题

| 表达式 | 结果 | 推导过程 |
| --- | --- | --- |
| `[] == ![]` | true | `![]` 是 false（对象都是 truthy）→ `[] == false` → 布尔转数字：`[] == 0` → 对象转原始值：`'' == 0` → `0 == 0` |
| `'' == 0` | true | `''` 转成数字是 0 |
| `'0' == false` | true | false 转成 0 → `'0' == 0` → `0 == 0` |
| `null == 0` | false | null 只和 undefined 宽松相等，不会转成数字 |
| `null >= 0` | true | 关系比较会把 null 转成数字 0 → `0 >= 0` |
| `[1] == 1` | true | `[1]` 转成原始值是 `'1'`，再转成数字是 1 |
| `NaN == NaN` | false | NaN 和任何值都不相等，包括它自己 |

### falsy 值

转成布尔值为 false 的是这 8 个：`false`、`0`、`-0`、`0n`、`''`、`null`、`undefined`、`NaN`（浏览器里历史遗留的 `document.all` 也是 falsy，属于特例）。其余都是 truthy，包括 `[]`、`{}`、`'0'`、`'false'`，以及 `new Boolean(false)` 这样的包装对象。

`if (x)`、`!x`、`&&` 这些地方用的是转布尔值的规则，和 `==` 的转换规则是两回事。

### 使用建议

业务代码统一用 `===`。需要同时判断 `null` 和 `undefined` 时，可以用 `x == null`，它等价于 `x === null || x === undefined`，写起来更简洁。

## 面试官可能追问

::: details if ([]) 会执行吗？
会。`if` 把条件转成布尔值，所有对象都是 truthy，空数组也不例外。但 `[] == false` 同样是 true，因为 `==` 走的是另一套规则：false 转成 0，`[]` 转成 `''` 再转成 0，最后比较 `0 == 0`。
:::

::: details ToPrimitive 的转换顺序是怎样的？
1. 对象有 `Symbol.toPrimitive` 方法时优先调用它，并传入 hint："string"、"number" 或 "default"
2. 没有的话，hint 为 "string" 时先调 `toString`，结果不是原始值再调 `valueOf`；hint 为 "number" 或 "default" 时顺序相反
3. 两个方法都没有返回原始值，抛 TypeError

模板字符串和 `String(x)` 使用 "string"；`-`、`*` 等数学运算和 `<`、`>=` 等关系比较使用 "number"；`==` 和二元 `+` 使用 "default"。`Date` 是例外，它把 "default" 当作 "string" 处理，所以 `date + 1` 得到的是字符串。

```js
const obj = {
  valueOf() {
    console.log('valueOf')
    return 1
  },
  toString() {
    console.log('toString')
    return '2'
  },
}
console.log(obj == 1) // 先输出 valueOf，再输出 true
console.log(`${obj}`) // 先输出 toString，再输出 2
```
:::

::: details 为什么 null == 0 是 false，而 null >= 0 是 true？
两者走的是不同的规则。`==` 对 null 有专门的规定：只和 undefined 相等，不做数字转换。`>=` 是关系比较，除非两边都是字符串（这时按字符编码逐个比较），否则会把两边都转成数字，null 转成 0，`0 >= 0` 成立。作为对比，`undefined >= 0` 是 false，因为 undefined 转成数字是 `NaN`，有 `NaN` 参与的大小比较都返回 false。
:::

## 易错点

- `[] == false` 是 true，但 `if ([])` 会执行：`==` 和转布尔值是两套规则
- `null == 0`、`null == false` 都是 false，null 只和 undefined 宽松相等
- `NaN` 和任何值都不相等，判断要用 `Number.isNaN`（见 [JS 的数据类型](/basics/javascript/07-types)）
