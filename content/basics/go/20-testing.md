---
difficulty: 2
tags: [高频, 实践]
---

# Go 的单元测试怎么写？表格驱动测试、Mock 和 Benchmark 怎么用？

::: tip 一句话回答
Go 内置了测试框架：测试写在 `_test.go` 文件里，函数名以 `Test` 开头、参数是 `*testing.T`，用 `go test` 运行。主流写法是**表格驱动测试**：把输入和期望结果列成一个切片，循环里用 `t.Run` 为每一行开一个子测试。依赖外部服务的代码，通过**面向接口编程**把依赖抽成接口，测试时传入手写的 fake 或生成的 mock。性能用 **Benchmark** 测（Go 1.24 起推荐 `for b.Loop()`），并发问题用 `-race` 检测。
:::

## 详细解析

### 基本约定

- 测试文件和被测代码放在同一个目录，正常构建时不会编译进去。`TestXxx(t *testing.T)` 是单元测试，`BenchmarkXxx(b *testing.B)` 是基准测试，`FuzzXxx(f *testing.F)` 是模糊测试，`ExampleXxx()` 是示例，末尾的 `// Output:` 注释会被拿来和实际输出比对
- `t.Errorf` 记录失败后继续执行，`t.Fatalf` 记录失败后立即结束当前测试；`t.Helper()` 让失败信息指向调用辅助函数的那一行；`t.Cleanup(f)` 注册清理函数。常用命令：`go test ./...` 跑所有包，`-run 'TestReverse/ascii'` 按名字筛选子测试，`-v` 看详细输出，`-count=1` 绕过测试结果缓存

### 表格驱动测试和 t.Parallel

表格驱动把"测什么"和"怎么测"分开，加一个用例只需要加一行；`t.Run` 让每个用例有自己的名字，可以单独运行，一个失败不影响其他。子测试调用 `t.Parallel()` 后会先暂停，等父测试函数执行完，再和其他并行子测试一起运行。Go 1.22 之前循环变量在所有迭代中共享，这时闭包里的 `tt` 都已经变成最后一个用例，必须先写 `tt := tt`；Go 1.22 起每轮迭代都是新变量，不再需要。并行测试不能修改全局变量、环境变量这类共享状态，`t.Setenv` 也不能在并行测试里使用。

### Mock：面向接口编程

Go 没有 Jest 那样能替换任意模块的 mock 机制，可测试性靠设计：被测代码依赖**接口**而不是具体类型，接口定义在使用方，只包含用到的方法。测试时传一个实现了接口的 fake，方法少时手写一个用 map 模拟存储的 fake 最简单，也最好读。

- **生成 mock**：接口方法多、需要断言"被调用了几次、参数是什么"时，用 gomock（现在维护的版本是 go.uber.org/mock）或 testify 的 mock 包；testify 的 `assert`、`require` 也常用来简化断言
- **HTTP**：`net/http/httptest` 的 `NewRecorder` 可以直接测 handler，`NewServer` 能启动一个本地测试服务器，用来模拟第三方接口

### Benchmark、竞态检测和覆盖率

- 运行 benchmark 用 `go test -bench=. -benchmem`（`-benchmem` 额外输出每次操作的分配次数和字节数）。Go 1.24 起推荐用 `for b.Loop() { ... }`：循环之前的准备代码只执行一次，计时器在第一次调用 Loop 时重置，循环体里的调用结果也不会被编译器优化掉。旧写法 `for i := 0; i < b.N; i++` 仍然可用，但整个函数会随 b.N 的调整执行多次，耗时的准备工作之后要手动 `b.ResetTimer()`，否则准备耗时会算进结果
- `go test -race ./...` 开启竞态检测器，运行时发现数据竞争就报错并打印两边的调用栈。它只能发现实际执行到的竞争，测试覆盖不到就发现不了，CI 里应该常开
- `go test -cover` 输出覆盖率；`-coverprofile=cover.out` 生成报告后，用 `go tool cover -html=cover.out` 在浏览器里逐行查看
- 模糊测试（Go 1.18 起）用 `go test -fuzz=FuzzReverse` 运行，自动变异输入，适合测解析器、编解码这类处理任意输入的函数。比如对下面的 Reverse 断言"反转两次等于原串"，很快会发现非法 UTF-8 输入不满足这一点

## 代码示例

```go
// strutil/reverse.go：按字符（rune）反转字符串
package strutil

func Reverse(s string) string {
	r := []rune(s)
	for i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {
		r[i], r[j] = r[j], r[i]
	}
	return string(r)
}
```

```go
// strutil/reverse_test.go
package strutil

import "testing"

func TestReverse(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", ""},
		{"ascii", "abc", "cba"},
		{"chinese", "你好世界", "界世好你"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := Reverse(tt.in); got != tt.want {
				t.Errorf("Reverse(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func BenchmarkReverse(b *testing.B) {
	s := "hello, 世界" // 准备代码只执行一次
	for b.Loop() {
		Reverse(s)
	}
}
```

```go
// handler 依赖接口，测试时传入 fake，用 httptest 构造请求、记录响应（省略 package 和 import）
type UserStore interface {
	GetName(ctx context.Context, id string) (string, error)
}

func UserHandler(store UserStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name, err := store.GetName(r.Context(), r.URL.Query().Get("id"))
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		fmt.Fprint(w, name)
	}
}

type fakeStore map[string]string // 测试用的 fake：用 map 代替数据库

func (f fakeStore) GetName(_ context.Context, id string) (string, error) {
	if name, ok := f[id]; ok {
		return name, nil
	}
	return "", errors.New("not found")
}

func TestUserHandler(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/user?id=1", nil)
	rec := httptest.NewRecorder() // 实现了 http.ResponseWriter，记录状态码和响应体
	UserHandler(fakeStore{"1": "alice"}).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "alice" {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
}
```

## 面试官可能追问

::: details 测试文件的包名写 strutil 还是 strutil_test？
写 `strutil` 是内部测试，可以访问未导出的函数和变量；写 `strutil_test` 是外部测试，只能像使用方一样调用导出的 API，更能检验接口设计是否好用，也能避免测试代码引入循环依赖。两种可以在同一个目录里并存。
:::

::: details 测试里怎么处理超时和 goroutine？
Go 1.24 起有 `t.Context()`，返回的 ctx 会在测试结束、清理函数执行之前取消，适合传给被测代码。测试定时器、超时这类依赖时间的并发代码，Go 1.25 起可以用 `testing/synctest`：在它创建的隔离环境里时间是虚拟的，所有 goroutine 都阻塞时时钟直接快进，不用真的 sleep。检查测试有没有留下泄漏的 goroutine，可以用 goleak，见 [goroutine 泄漏](/basics/go/09-goroutine-leak)。
:::

::: details 单元测试要 mock 到什么程度？
只替换跨进程的、慢的、不稳定的依赖，比如数据库、第三方接口、时间、随机数；纯计算的内部函数直接用真实实现。mock 太多，测试就只是在验证"代码按我写的顺序调用了 mock"，重构一下实现就全部失败，却发现不了真正的 bug。核心的数据访问层最好再配一些连真实数据库的集成测试。
:::

## 易错点

- `t.Fatal` / `t.FailNow` 只能在运行测试函数的 goroutine 里调用；在测试自己启动的 goroutine 里调用，只会结束那个 goroutine，测试本身不会停下，要改用 `t.Error` 后 return
- `go test` 会缓存通过的结果，测试依赖外部环境（文件、网络）时看到的可能是缓存结果，加 `-count=1` 强制重跑
- 子测试用了 `t.Parallel()`，父测试里的 `defer` 会在子测试真正运行之前就执行：要在所有子测试结束后清理资源，用 `t.Cleanup`
