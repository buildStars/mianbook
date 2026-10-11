---
difficulty: 2
tags: [高频, 实践]
---

# Go 的错误处理有什么特点？errors.Is 和 errors.As 怎么用？

::: tip 一句话回答
Go 把错误当作**普通的值**：函数通过多返回值把 error 交给调用方，调用方用 `if err != nil` 显式处理，没有 try/catch 那样的隐式跳转。向上传递时用 `fmt.Errorf("...: %w", err)` **包装**错误，既补充了上下文，又保留了原始错误，形成一条错误链。判断时用 `errors.Is` 检查链上有没有某个**哨兵错误**，用 `errors.As` 从链上取出某种**类型**的错误、读取它的字段。panic 只用于程序无法继续运行的情况。
:::

## 详细解析

### error 是一个普通的接口

- error 是只有一个方法的接口：`type error interface { Error() string }`。可以用 `errors.New`、`fmt.Errorf` 创建，也可以定义自己的错误类型。约定 error 放在返回值的最后一个，err 不为 nil 时，其他返回值通常没有意义
- 写法上很像 Node.js 早期的错误优先回调 `(err, data) => {}`：错误放在显眼的位置，每一步都要检查，只是 Go 把它放在了返回值的最后（Node.js 的各种错误处理方式见 [Node.js 服务怎么处理异常](/basics/node/07-error-handling)）

### 包装错误和错误链

每一层在向上返回时补充自己的上下文，最终的错误信息读起来就像一条调用链，比如 `load config: open config.yaml: no such file or directory`。Go 的 error 默认不带堆栈，定位问题主要靠这些逐层添加的上下文。也因为要被拼接到别的错误信息里，错误信息习惯以小写字母开头、结尾不加标点。

用 `%w` 包装时，返回的错误实现了 `Unwrap()`，原始错误仍然在链上，可以被 errors.Is / errors.As 找到，Go 1.20 起一个 `fmt.Errorf` 里可以用多个 `%w`；用 `%v` 只是把原错误格式化成文字，链就断了，调用方无法再判断原始错误。

### errors.Is 和 errors.As

- `errors.Is(err, target)`：沿着错误链逐个和 target 比较（用 `==`，或者调用错误自定义的 `Is` 方法），只要有一个相等就返回 true，用来判断**哨兵错误**
- `errors.As(err, &target)`：沿着错误链找第一个能赋值给 target 类型的错误，找到后赋值给 target 并返回 true，用来取出**自定义错误类型**。target 必须是指向错误类型（或接口类型）的非 nil 指针，否则会 panic。Go 1.26 起还有泛型版本 `errors.AsType[*ValidationError](err)`，直接返回取到的错误和一个 bool，不用先声明变量，类型在编译期就能检查，官方文档建议大多数场景优先用它

包装之后最外层是一个新的错误值，`err == ErrNotFound` 和类型断言 `err.(*ValidationError)` 都会失效，这就是需要 Is 和 As 的原因：

```go
package main

import (
	"errors"
	"fmt"
)

var ErrNotFound = errors.New("not found") // 哨兵错误

type ValidationError struct{ Field string } // 自定义错误类型，可以携带额外信息

func (e *ValidationError) Error() string { return "invalid " + e.Field }

func findUser(id int) error {
	if id <= 0 {
		return &ValidationError{Field: "id"}
	}
	return ErrNotFound
}

func getProfile(id int) error {
	if err := findUser(id); err != nil {
		return fmt.Errorf("get profile %d: %w", id, err) // 包装，保留原错误
	}
	return nil
}

func main() {
	err := getProfile(42)
	fmt.Println(err)                         // get profile 42: not found
	fmt.Println(err == ErrNotFound)          // false：包装后已经不是同一个值
	fmt.Println(errors.Is(err, ErrNotFound)) // true：沿错误链找到了
	var ve *ValidationError
	if errors.As(getProfile(-1), &ve) {
		fmt.Println("invalid field:", ve.Field) // invalid field: id
	}
}
```

### 哨兵错误还是自定义错误类型

| | 哨兵错误 | 自定义错误类型 |
| --- | --- | --- |
| 定义 | `var ErrNotFound = errors.New("not found")` | 结构体 + `Error()` 方法 |
| 判断 | `errors.Is` | `errors.As` |
| 适合 | 调用方只需要知道"是哪一种错误" | 调用方还需要读取额外信息，如字段名、状态码 |
| 标准库的例子 | `io.EOF`、`sql.ErrNoRows`、`fs.ErrNotExist` | `*fs.PathError`、`*json.SyntaxError` |

两者导出后都会成为包的公开 API，调用方会依赖它们，所以只导出调用方确实需要区分的错误。不要用 `err.Error()` 的字符串内容做判断，措辞一改代码就坏了。

### errors.Join 合并多个错误

Go 1.20 起可以用 `errors.Join` 把多个错误合并成一个，常用于表单校验、批量操作这类需要一次报告所有问题的场景，errors.Is 和 errors.As 会检查合并进去的每一个错误：

```go
func validate(name string, age int) error {
	var errs []error
	if name == "" {
		errs = append(errs, errors.New("name is required"))
	}
	if age < 0 {
		errs = append(errs, errors.New("age must not be negative"))
	}
	return errors.Join(errs...) // errs 为空时返回 nil；否则各条错误信息用换行连接
}
```

### 和 try/catch 的对比

| | Go 的 error | JS 的 try/catch |
| --- | --- | --- |
| 哪里会出错 | 写在函数签名里，一眼能看出 | 任何函数都可能抛出，签名里看不出来 |
| 怎么传播 | 每一层显式 return，顺便补充上下文 | 自动向上冒泡，直到被 catch |
| 漏掉处理 | 用 `_` 忽略在代码里很显眼，lint 工具也能检查 | 忘记 catch 就变成未捕获的异常或未处理的 rejection |
| 代价 | `if err != nil` 写得多，代码啰嗦 | 控制流是隐式的，不容易看出哪一行会跳走 |

panic 不是 Go 版的 throw，只用于程序有 bug 或无法继续运行的情况，边界见 [defer、panic、recover](/basics/go/06-defer-panic-recover)。

## 面试官可能追问

::: details 为什么 Go 不用异常？
Go 的设计者认为，把异常和 try-catch-finally 这样的控制结构绑在一起，会让代码的控制流变得复杂，还容易让人把打开文件失败这类普通错误也当成"异常"来处理。Go 让错误走普通的返回值，处理逻辑就写在出错的位置旁边，代码多一些，但流程清楚。真正异常的情况才用 panic。
:::

::: details 错误既打日志又返回，有什么问题？
同一个错误在每一层都打一次日志，日志里会出现一串重复的报错，反而难以排查。原则是一个错误只处理一次：要么在这一层处理掉（记录日志、降级、重试），要么补充上下文后返回给上层，通常在最外层（HTTP 处理函数或 main）统一记录日志。
:::

::: details 自定义的错误类型怎么加入错误链？
给它实现 `Unwrap() error` 方法，返回被包装的那个错误，errors.Is 和 errors.As 就能继续往下找；需要自定义"相等"的规则时，还可以实现 `Is(target error) bool` 方法：

```go
type RequestError struct {
	URL string
	Err error
}

func (e *RequestError) Error() string { return "request " + e.URL + ": " + e.Err.Error() }
func (e *RequestError) Unwrap() error { return e.Err }
```
:::

## 易错点

- 用 `%v` 包装会断开错误链，需要保留原始错误时用 `%w`
- 自定义错误类型通常用指针接收者实现 `Error()`，errors.As 的 target 要声明成 `var e *MyErr`，再传入 `&e`
- 返回 error 的函数，不要把具体类型的 nil 指针作为返回值，否则调用方的 `err != nil` 会成立，见 [interface 的底层](/basics/go/05-interface)
