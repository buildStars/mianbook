<script setup lang="ts">
import type { EditorView } from '@codemirror/view'

/**
 * 代码编辑器（CodeMirror 6）：JavaScript 语法高亮、自动缩进、括号补全、Tab 缩进，Ctrl / ⌘ + Enter 触发 run。
 * 配色和正文代码块一样（github-dark）。只有练习页用，模块在挂载时才加载，不进首屏。
 * Tab 用来缩进：键盘用户先按 Esc 再按 Tab 可以离开编辑器（CodeMirror 自带）
 */
const model = defineModel<string>({ required: true })
/** 只读：用来展示测试代码、参考答案（同样的高亮） */
const props = defineProps<{ readonly?: boolean; label?: string }>()
const emit = defineEmits<{ run: [] }>()
const host = ref<HTMLElement | null>(null)
const ready = ref(false)
let view: EditorView | null = null

onMounted(async () => {
  const [viewMod, { EditorState }, commands, language, { closeBrackets, closeBracketsKeymap }, { javascript }, { tags: t }] = await Promise.all([
    import('@codemirror/view'),
    import('@codemirror/state'),
    import('@codemirror/commands'),
    import('@codemirror/language'),
    import('@codemirror/autocomplete'),
    import('@codemirror/lang-javascript'),
    import('@lezer/highlight'),
  ])
  if (!host.value) return
  const { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } = viewMod
  const { HighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching, indentUnit } = language

  const highlight = HighlightStyle.define([
    { tag: [t.keyword, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operator], color: '#ff7b72' },
    { tag: [t.string, t.special(t.string), t.regexp], color: '#a5d6ff' },
    { tag: [t.number, t.bool, t.null, t.atom, t.propertyName], color: '#79c0ff' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: '#d2a8ff' },
    { tag: [t.className, t.typeName, t.definition(t.className)], color: '#ffa657' },
    { tag: t.comment, color: '#8b949e' },
    { tag: t.invalid, color: '#ff7b72', textDecoration: 'underline wavy' },
  ])
  const theme = EditorView.theme(
    {
      '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--code-text)', fontSize: '13.5px' },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.7', fontVariantLigatures: 'none' },
      '.cm-content': { padding: '14px 0', caretColor: '#fff' },
      '.cm-line': { padding: '0 16px 0 6px' },
      '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#5c6370' },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 4px 0 14px', minWidth: '38px' },
      '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.04)' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#a0a7b4' },
      '&.cm-focused .cm-cursor': { borderLeftColor: '#fff' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
        backgroundColor: 'rgba(130, 153, 255, 0.28)',
      },
      '.cm-matchingBracket': { backgroundColor: 'rgba(255, 255, 255, 0.1)', outline: '1px solid rgba(255, 255, 255, 0.28)' },
    },
    { dark: true },
  )

  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: model.value,
      extensions: [
        lineNumbers(),
        props.readonly ? [] : [highlightActiveLineGutter(), highlightActiveLine()],
        drawSelection(),
        commands.history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        keymap.of([
          { key: 'Mod-Enter', run: () => (emit('run'), true) },
          ...closeBracketsKeymap,
          ...commands.defaultKeymap,
          ...commands.historyKeymap,
          commands.indentWithTab,
        ]),
        javascript(),
        syntaxHighlighting(highlight),
        theme,
        EditorState.readOnly.of(!!props.readonly),
        EditorView.editable.of(!props.readonly),
        EditorView.contentAttributes.of({
          'aria-label': props.label ?? '代码编辑器，Ctrl + Enter 运行测试；按 Esc 再按 Tab 可以离开编辑器',
          spellcheck: 'false',
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) model.value = update.state.doc.toString()
        }),
      ],
    }),
  })
  ready.value = true
})

// 外面改了代码（重置、恢复草稿）时同步进编辑器
watch(model, (value) => {
  if (view && value !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
})

onBeforeUnmount(() => view?.destroy())

defineExpose({ focus: () => view?.focus() })
</script>

<template>
  <div ref="host" class="code-editor">
    <!-- 编辑器加载出来之前先显示代码，免得一片空白 -->
    <pre v-if="!ready" class="placeholder">{{ model }}</pre>
  </div>
</template>

<style scoped>
.code-editor {
  height: 100%;
  min-height: 0;
}

.placeholder {
  margin: 0;
  padding: 14px 16px 14px 58px;
  font-family: var(--font-mono);
  font-size: 13.5px;
  line-height: 1.7;
  white-space: pre;
  color: var(--code-text);
  font-variant-ligatures: none;
}
</style>
