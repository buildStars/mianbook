---
difficulty: 2
tags: [手写题, 场景题]
---

# 怎么实现大数相加？为什么不能直接用 Number？

::: tip 一句话回答
Number 是双精度浮点数，有效数字只有 53 个二进制位，**安全整数**（都能精确表示、能正确比较）的上限是 `Number.MAX_SAFE_INTEGER`（2^53 - 1）。超过之后，相邻两个能表示的数之间出现间隔，计算结果会被悄悄舍入。手写大数相加就是**把数字当字符串**，像列竖式一样**从个位开始逐位相加、处理进位**。原生方案是 **BigInt**，但它不能和 Number 混算、`JSON.stringify` 会报错、不能用 Math 的方法。后端返回超长整数 ID 时，应该让后端用**字符串**返回。
:::

## 详细解析

### 超出安全整数会发生什么

```js
console.log(Number.MAX_SAFE_INTEGER) // 9007199254740991
console.log(9007199254740993) // 9007199254740992，字面量本身就存不下
console.log(2 ** 53 + 1 === 2 ** 53) // true
console.log(9007199254740991 + 2) // 9007199254740992，算错了也不报错
console.log(Number.isSafeInteger(2 ** 53)) // false
```

2^53 到 2^54 之间，相邻两个能表示的数相差 2，再往上相差 4、8……奇数直接表示不了。最麻烦的是它不报错，结果看起来正常。双精度浮点数的结构见 [为什么 0.1 + 0.2 !== 0.3](/basics/javascript/20-float-precision)。

### 字符串逐位相加

思路和列竖式一样：两个指针从末尾往前走，短的那个不够了就当 0；每一位的和取个位留下，十位作为进位加到下一位；循环条件里要带上进位，否则 `addBig('9', '1')` 会丢掉最高位的 1，只得到 0。时间复杂度 O(max(m, n))。

## 代码示例：手写大数相加

```js
function addBig(a, b) {
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) throw new TypeError('只支持非负整数字符串')
  let i = a.length - 1
  let j = b.length - 1
  let carry = 0
  const digits = [] // 从低位到高位存，最后反转；比每次往字符串前面拼更省
  while (i >= 0 || j >= 0 || carry) {
    const sum = (i >= 0 ? Number(a[i--]) : 0) + (j >= 0 ? Number(b[j--]) : 0) + carry
    digits.push(sum % 10)
    carry = Math.floor(sum / 10)
  }
  return digits.reverse().join('').replace(/^0+(?=\d)/, '') // 去掉前导零，保留单个 0
}

console.log(addBig('9007199254740991', '2')) // 9007199254740993
console.log(addBig('999', '1')) // 1000，最高位的进位没丢
console.log(addBig('0', '0')) // 0
console.log(addBig('00123', '7')) // 130
console.log(addBig('123456789012345678901234567890', '987654321098765432109876543210'))
// 1111111110111111111011111111100
console.log(addBig('12345678901234567890', '98765') === String(12345678901234567890n + 98765n)) // true，和 BigInt 对拍
```

### BigInt 的用法和限制

```js
const id = BigInt('9007199254740993') // 用字符串构造
console.log(id + 1n) // 9007199254740994n
console.log(BigInt(9007199254740993)) // 9007199254740992n，传数字时精度已经丢了
console.log(5n / 2n) // 2n，除法向零截断
console.log(1n < 2, 1n == 1, 1n === 1) // true true false，可以和 Number 比较，但类型不同
```

| 写法 | 结果 |
| --- | --- |
| `1n + 1` | TypeError，不能和 Number 混算，要先统一类型：`1n + BigInt(1)` |
| `JSON.stringify({ id: 1n })` | TypeError，JSON 没有 BigInt 类型 |
| `Math.max(1n, 2n)`、`Math.sqrt(4n)` | TypeError，Math 的方法只接受 Number |
| `+1n` | TypeError，一元加号不支持 BigInt |
| `BigInt(1.5)` | RangeError，只能转换整数 |
| `Number(2n ** 60n)` | 可以转，但超出安全范围的部分会丢精度 |

### 后端返回的超长 ID

后端的 64 位长整型 ID（比如雪花算法生成的）经常超过 2^53，`JSON.parse('{"id": 1234567890123456789}')` 得到的 id 是 1234567890123456800。parse 时精度就已经丢了，前端事后怎么处理都找不回来。正确的做法是**后端把 ID 序列化成字符串**，前端始终当字符串用。改不了接口时，可以用支持大整数的 JSON 解析库；`JSON.parse` 的 reviver 还有第三个参数 context：解析数字、字符串这类原始值时，`context.source` 是它在 JSON 里的原始文本，可以用它转成 BigInt。这是较晚加入标准的能力，老环境不支持，用之前要确认目标环境。

## 面试官可能追问

::: details 大数相乘怎么实现？
同样模拟竖式。结果最多 m + n 位，开一个长度 m + n 的数组；`a[i] * b[j]` 的乘积加到下标 `i + j + 1` 的位置，最后从低位往高位统一处理进位，再去掉前导零。复杂度 O(m × n)：

```js
function mulBig(a, b) {
  const res = new Array(a.length + b.length).fill(0)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) res[i + j + 1] += a[i] * b[j] // 字符相乘会自动转成数字
  }
  for (let k = res.length - 1; k > 0; k--) {
    res[k - 1] += Math.floor(res[k] / 10)
    res[k] %= 10
  }
  return res.join('').replace(/^0+(?=\d)/, '')
}
console.log(mulBig('99', '99'), mulBig('123456789', '987654321')) // 9801 121932631112635269
```
:::

::: details 怎么支持负数和小数？
负数：符号相同时绝对值相加、沿用符号；符号不同时用绝对值大的减去小的，结果取大者的符号，所以还要实现带借位的大数减法和比较大小（先比长度，长度相同再按字符串比）。小数：按小数点对齐，位数少的一方补零，去掉小数点当整数相加，再把小数点插回去。金额这类十进制计算，直接用 decimal.js 这类成熟的库。
:::

::: details 逐位相加太慢，怎么优化？
每次处理多位。两个 15 位以内的整数相加，和小于 2 × 10^15，仍在安全整数范围内，所以可以把字符串从末尾按 15 位一组切开，每组转成 Number 相加、处理进位，结果除最高一组外都要用 `padStart(15, '0')` 补齐前导零。循环次数大约变成原来的 1/15。实际项目里优先用 BigInt。
:::

## 易错点

- `BigInt(9007199254740993)` 传入的是已经丢了精度的数字，要用字符串构造：`BigInt('9007199254740993')`
- 循环条件忘了带上进位，最高位的进位会丢失
- 字符串直接比较大小是按字典序，`'9' > '10'` 为 true，比较数值大小要先比长度
