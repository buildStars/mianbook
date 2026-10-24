---
difficulty: 2
tags: [实践]
---

# Vue 3 项目里怎么写 TypeScript 类型？props、emits、ref 和 provide/inject 怎么标？

::: tip 一句话回答
在 `<script setup lang="ts">` 里，props、emits、slots 都用**泛型参数**声明：`defineProps<{...}>()`、`defineEmits<{...}>()`、`defineSlots<{...}>()`，编译器会根据类型生成运行时声明。默认值用**响应式 props 解构**或 `withDefaults`；`ref` 用泛型标注，模板 ref 用 `useTemplateRef`，组件实例类型用 `InstanceType<typeof Comp>`；provide/inject 用 `InjectionKey` 让两边类型一致。类型检查交给 `vue-tsc`，构建工具只转译不检查。
:::

## 详细解析

### props 和默认值

```ts
interface Props {
  title: string
  size?: 'small' | 'large'
  tags?: string[]
}

// 写法一：响应式 props 解构，较新的版本里默认开启
const { title, size = 'small', tags = [] } = defineProps<Props>()

// 写法二：withDefaults，对象和数组的默认值必须用函数返回
const props = withDefaults(defineProps<Props>(), {
  size: 'small',
  tags: () => [],
})
```

- 基于类型的声明和运行时声明（`defineProps({ ... })`）只能二选一
- 类型参数可以引用导入的类型，但整个 props 对象不能是条件类型
- 解构出来的变量在同一个 `<script setup>` 里会被编译成 `props.xxx`，保持响应式。传给 `watch` 时要写 `watch(() => size, ...)`，直接写 `watch(size, ...)` 会编译报错

### emits 和 slots

```ts
const emit = defineEmits<{
  change: [id: number]       // key 是事件名，value 是参数元组
  close: []                  // 没有参数
}>()
emit('change', 1)            // ✅
emit('change', '1')          // ❌ 类型错误

const slots = defineSlots<{
  default(props: { item: string; index: number }): any
}>()
```

`defineEmits` 也支持调用签名写法 `(e: 'change', id: number): void`。`defineSlots` 只影响类型，没有运行时效果。

### 泛型组件

`generic` 属性的写法和 TypeScript 的类型参数列表一样，可以加约束：

```vue
<script setup lang="ts" generic="T extends { id: string | number }">
defineProps<{ items: T[]; modelValue?: T }>()
defineEmits<{ select: [item: T] }>()
defineSlots<{ item(props: { item: T }): any }>()
</script>
```

使用时传入 `items`，`T` 会被推断出来，`@select` 回调和 `#item` 插槽参数都是具体类型。

### ref、reactive 和模板 ref

```ts
const count = ref(0)                         // 自动推断为 Ref<number>
const user = ref<User | null>(null)          // 初始值为 null 时显式写出联合类型
const total = ref<number>()                  // Ref<number | undefined>
const form: LoginForm = reactive({ name: '', password: '' }) // reactive 用变量标注，不传泛型

const input = useTemplateRef<HTMLInputElement>('input')
const dialog = useTemplateRef<InstanceType<typeof MyDialog>>('dialog')
onMounted(() => {
  input.value?.focus()       // 挂载前是 null，要用可选链
  dialog.value?.open()       // 只能访问子组件 defineExpose 暴露的成员
})
```

配合 Vue 的语言工具，静态 `ref` 的类型通常能自动推断，泛型参数只在推断不出来时写。泛型组件不能用 `InstanceType`，要用 `vue-component-type-helpers` 提供的 `ComponentExposed`。

### provide / inject 和全局类型扩展

```ts
// keys.ts：key 放在单独文件，两边共用
import type { InjectionKey, Ref } from 'vue'
export const ThemeKey: InjectionKey<Ref<'light' | 'dark'>> = Symbol('theme')

provide(ThemeKey, theme)                 // 值的类型不对会报错
const theme = inject(ThemeKey)           // Ref<'light' | 'dark'> | undefined
const theme2 = inject(ThemeKey, ref<'light' | 'dark'>('light')) // 有默认值就不再含 undefined
```

挂在 `app.config.globalProperties` 上的属性，要通过模块扩充告诉 TypeScript：

```ts
declare module 'vue' {
  interface ComponentCustomProperties {
    $formatDate: (d: Date) => string
  }
}
export {}
```

模块扩充和声明合并的原理见 [声明文件怎么写](/basics/typescript/10-declaration-files)。

## 面试官可能追问

::: details 为什么构建能通过，vue-tsc 却报错？
Vite 之类的构建工具处理 `.vue` 和 `.ts` 时只做转译，把类型擦掉，不检查类型，这样速度快。类型检查要单独跑 `vue-tsc --noEmit`，一般放在 CI 或提交前。转译和检查的区别见 [tsc、Babel、esbuild 编译 TypeScript 的区别](/basics/typescript/20-transpile)。
:::

::: details inject 拿到的值为什么总带着 undefined？
运行时不保证上层一定 provide 了这个 key，所以类型上保留 `undefined`。确定一定有时，可以给默认值，或者封装一个 `useTheme()`，没取到就抛错，返回值就是非空类型。
:::

::: details withDefaults 和解构默认值该用哪个？
项目的 Vue 版本支持响应式 props 解构时，解构写法更简洁，数组和对象也不用包函数。老项目或团队规范禁用了解构，就用 `withDefaults`。两者都会让有默认值的属性在类型上变成必有。
:::

## 易错点

- `withDefaults` 里给数组或对象直接写字面量，类型检查会报错，要写成 `() => []`
- 把解构出来的 prop 直接传给 `watch(size, ...)`，编译报错，要写成 getter `() => size`
- 给 `reactive<T>()` 传泛型，返回类型和 `T` 并不一致，应该用变量标注
- 以为 `vite build` 通过就没有类型错误，没有单独跑 `vue-tsc`
