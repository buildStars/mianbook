---
title: 手写 curry 和 compose
---

## 要求

实现三个函数：

**`curry(fn, arity = fn.length)`**：返回 fn 柯里化后的函数。

- 参数可以分任意多次传，每次可以传一个或多个
- 累计收到的参数个数达到 `arity` 时，用这些参数调用 fn，返回它的结果；不够时返回一个继续接收参数的函数，这时 fn 还没有被调用
- `arity` 默认是 `fn.length`，也可以手动传入（有剩余参数、默认参数的函数，`fn.length` 不准）
- 中间得到的函数可以多次调用，每次调用互不影响

**`compose(...fns)`**：返回一个接收一个参数的函数，从右到左依次调用 fns，前一个的返回值作为后一个的参数：`compose(f, g)(x)` 等于 `f(g(x))`。

**`pipe(...fns)`**：和 compose 一样，但从左到右执行：`pipe(f, g)(x)` 等于 `g(f(x))`。

compose 和 pipe 一个函数都没传时，返回的函数原样返回参数。

## 提示

- curry 返回一个具名函数 `curried(...args)`：参数够了就调用 fn，不够就返回一个新函数，把之前的参数和新收到的参数合起来，再交给 curried 判断
- 合并参数要用 `[...args, ...rest]` 创建新数组，不要往同一个数组里 push，否则中间函数被多次调用时会互相污染
- compose 和 pipe 都可以用一次 reduce 实现：初始值是传入的参数，每一步把累计结果交给下一个函数；compose 用 reduceRight

## 起始代码

```js
function curry(fn, arity = fn.length) {
  // 参数够了就调用 fn，不够就返回继续接收参数的函数
}

function compose(...fns) {
  // 返回一个函数，从右到左依次执行 fns
}

function pipe(...fns) {
  // 返回一个函数，从左到右依次执行 fns
}
```

## 测试

```js
const add1 = (x) => x + 1
const double = (x) => x * 2

test('curry：参数凑够 fn.length 个才执行，可以分任意多次传', () => {
  const add = curry((a, b, c) => a + b + c)
  expect(add(1)(2)(3)).toBe(6)
  expect(add(1, 2)(3)).toBe(6)
  expect(add(1)(2, 3)).toBe(6)
  expect(add(1, 2, 3)).toBe(6)
})

test('curry：参数不够时返回函数，原函数还没被调用', () => {
  const spy = fn((a, b, c) => a + b + c)
  const add = curry(spy, 3) // spy 的 length 是 0，手动指定参数个数
  const step = add(1)(2)
  expect(typeof step).toBe('function')
  expect(spy).toHaveBeenCalledTimes(0)
  expect(step(3)).toBe(6)
  expect(spy).toHaveBeenCalledTimes(1)
  expect(spy).toHaveBeenCalledWith(1, 2, 3)
})

test('curry：中间得到的函数可以多次调用，互不影响', () => {
  const list = curry((a, b, c) => [a, b, c])
  const withA = list('a')
  expect(withA('b')('c')).toEqual(['a', 'b', 'c'])
  expect(withA('x')('y')).toEqual(['a', 'x', 'y'])
  const withAB = withA('b')
  expect(withAB('c')).toEqual(['a', 'b', 'c'])
  expect(withAB('d')).toEqual(['a', 'b', 'd'])
})

test('curry：可以手动指定参数个数', () => {
  const sum = (...nums) => nums.reduce((total, n) => total + n, 0) // length 是 0
  expect(curry(sum)(1)).toBe(1) // 不指定：第一次调用就执行
  expect(curry(sum, 3)(1)(2)(3)).toBe(6)
  expect(curry(sum, 2)(1, 2)).toBe(3)
})

test('compose 从右到左执行', () => {
  expect(compose(add1, double)(5)).toBe(11) // add1(double(5))
  expect(compose(double, add1)(5)).toBe(12) // double(add1(5))
  const trim = (s) => s.trim()
  const lower = (s) => s.toLowerCase()
  const dash = (s) => s.replace(/\s+/g, '-')
  expect(compose(dash, lower, trim)('  Hello World  ')).toBe('hello-world')
})

test('pipe 从左到右执行', () => {
  expect(pipe(add1, double)(5)).toBe(12) // double(add1(5))
  expect(pipe(double, add1)(5)).toBe(11) // add1(double(5))
  expect(pipe(add1, add1, double)(0)).toBe(4)
})

test('compose 和 pipe 没传函数时原样返回参数', () => {
  expect(compose()(5)).toBe(5)
  expect(pipe()('x')).toBe('x')
  expect(compose(double)(5)).toBe(10)
  expect(pipe(double)(5)).toBe(10)
})

test('curry 和 pipe 组合使用：先传配置，最后传数据', () => {
  const map = curry((f, arr) => arr.map(f))
  const filter = curry((f, arr) => arr.filter(f))
  const oddTimesTen = pipe(filter((n) => n % 2 === 1), map((n) => n * 10))
  expect(oddTimesTen([1, 2, 3, 4, 5])).toEqual([10, 30, 50])
})
```

## 参考答案

```js
function curry(fn, arity = fn.length) {
  return function curried(...args) {
    // 参数够了就执行原函数，不够就返回一个新函数，把之前的参数和新参数合在一起再判断
    if (args.length >= arity) return fn.apply(this, args)
    return (...rest) => curried.apply(this, [...args, ...rest])
  }
}

function compose(...fns) {
  return (x) => fns.reduceRight((acc, f) => f(acc), x) // 从右到左
}

function pipe(...fns) {
  return (x) => fns.reduce((acc, f) => f(acc), x) // 从左到右
}
```
