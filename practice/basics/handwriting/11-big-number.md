---
title: 手写大数相加
---

## 要求

实现 `addBig(a, b)`：`a`、`b` 是两个非负整数的字符串，返回它们的和（字符串）。数字可能远远超过 `Number.MAX_SAFE_INTEGER`，所以不能转成 Number 计算，也不能用 BigInt。

- 输入可以带前导零（如 `'00123'`），结果要去掉前导零；结果是 0 时返回 `'0'`
- `a` 或 `b` 不是只由数字组成的字符串时（负数、小数、空字符串、带字母等）抛出 `TypeError`

## 提示

- 像列竖式一样，两个下标从各自的末尾往前走，短的那个走完了就当 0
- 每一位的和 `% 10` 留在这一位，`Math.floor(和 / 10)` 作为进位；循环条件里要带上进位，否则最高位的进位会丢
- 每位的结果先放进数组，最后反转再拼起来，比每次往字符串前面拼更省；再用正则去掉前导零，但要保留最后一个 0

## 起始代码

```js
function addBig(a, b) {
  // 返回 a + b 的结果（字符串）
}
```

## 测试

```js
test('两个小数字相加，返回字符串', () => {
  expect(addBig('123', '456')).toBe('579')
  expect(addBig('1', '2')).toBe('3')
})

test('超过安全整数的结果也是精确的', () => {
  expect(addBig('9007199254740991', '2')).toBe('9007199254740993')
  expect(addBig('9007199254740993', '9007199254740993')).toBe('18014398509481986')
})

test('两个数的位数不同', () => {
  expect(addBig('12345678901234567890', '98765')).toBe('12345678901234666655')
  expect(addBig('98765', '12345678901234567890')).toBe('12345678901234666655')
  expect(addBig('5', '0')).toBe('5')
})

test('最高位的进位不能丢', () => {
  expect(addBig('9', '1')).toBe('10')
  expect(addBig('999', '1')).toBe('1000')
  expect(addBig('1', '99999999999999999999')).toBe('100000000000000000000')
})

test('去掉前导零，结果是 0 时返回 "0"', () => {
  expect(addBig('0', '0')).toBe('0')
  expect(addBig('00123', '7')).toBe('130')
  expect(addBig('000', '0000')).toBe('0')
})

test('几十位的长数字，和 BigInt 的结果一致', () => {
  expect(addBig('123456789012345678901234567890', '987654321098765432109876543210')).toBe('1111111110111111111011111111100')
  // 固定种子生成一批随机长度的数字（首位不是 0）
  let seed = 7
  const next = () => (seed = (seed * 48271) % 2147483647)
  const digits = (n) => {
    let s = String(1 + (next() % 9))
    for (let i = 1; i < n; i++) s += next() % 10
    return s
  }
  for (let k = 0; k < 20; k++) {
    const a = digits(1 + ((k * 7) % 60))
    const b = digits(1 + ((k * 13) % 60))
    expect(addBig(a, b)).toBe(String(BigInt(a) + BigInt(b)))
  }
})

test('不用 BigInt 也能算对', () => {
  const original = globalThis.BigInt
  globalThis.BigInt = () => {
    throw new Error('这道题要手写逐位相加，不能用 BigInt')
  }
  try {
    expect(addBig('99999999999999999999', '1')).toBe('100000000000000000000')
  } finally {
    globalThis.BigInt = original
  }
})

test('不是非负整数字符串时抛出 TypeError', () => {
  expect(() => addBig('-1', '2')).toThrow(TypeError)
  expect(() => addBig('1.5', '1')).toThrow(TypeError)
  expect(() => addBig('', '1')).toThrow(TypeError)
  expect(() => addBig('1', '12a')).toThrow(TypeError)
})
```

## 参考答案

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
```
