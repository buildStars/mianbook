<script setup lang="ts">
import type { RagDebugResult, RagStatus } from '#shared/types/ask'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: '知识库' })

const { data: status, refresh } = await useFetch<RagStatus>('/api/admin/rag', { key: 'admin-rag' })
const syncing = ref(false)
const syncError = ref('')

const progress = computed(() => (status.value?.chunks ? Math.round((status.value.embedded / status.value.chunks) * 100) : 0))
const hybrid = computed(() => Boolean(status.value?.embed && status.value.embedded))
const retrievalLabel = computed(() => {
  if (!status.value?.rerank) return hybrid.value ? '关键词 + 向量' : '只用关键词'
  return hybrid.value ? '关键词 + 向量 + 重排' : '关键词 + 重排'
})

// 首次部署或换了模型时，后台还在生成向量：每隔几秒刷新一次进度
let poll: ReturnType<typeof setInterval> | undefined
watch(
  () => status.value?.running,
  (running) => {
    clearInterval(poll)
    if (running) poll = setInterval(() => refresh(), 3000)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearInterval(poll))

async function syncNow() {
  syncing.value = true
  syncError.value = ''
  try {
    status.value = await $fetch<RagStatus>('/api/admin/rag/sync', { method: 'POST' })
    if (status.value.lastStats?.error) syncError.value = status.value.lastStats.error
    else ElMessage.success('索引已是最新')
  } catch (error) {
    syncError.value = errorMessage(error)
  } finally {
    syncing.value = false
  }
}

function describeStats(s: NonNullable<RagStatus['lastStats']>) {
  const parts = [`${s.questionsChanged} 道题重新切块`, `生成 ${s.embedded} 个向量`, `复用 ${s.reused} 个`]
  if (s.questionsRemoved) parts.push(`移除 ${s.questionsRemoved} 道题`)
  return `${parts.join('，')}，用时 ${s.tookMs < 1000 ? `${s.tookMs}ms` : `${(s.tookMs / 1000).toFixed(1)}s`}`
}

// ---------- 检索调试 ----------
type Only = 'hybrid' | 'keyword' | 'vector'
const query = ref('')
const only = ref<Only>('hybrid')
const rerankOn = ref(true)
const searching = ref(false)
const result = ref<RagDebugResult | null>(null)
const searchError = ref('')

async function search() {
  const q = query.value.trim()
  if (!q) return
  searching.value = true
  searchError.value = ''
  try {
    result.value = await $fetch<RagDebugResult>('/api/admin/rag/search', {
      query: { q, only: only.value === 'hybrid' ? undefined : only.value, rerank: rerankOn.value ? undefined : '0' },
    })
  } catch (error) {
    searchError.value = errorMessage(error)
  } finally {
    searching.value = false
  }
}
watch([only, rerankOn], () => result.value && search())

const MODE_LABELS = { hybrid: '混合检索', keyword: '只用关键词', vector: '只用向量' } as const
</script>

<template>
  <div class="kb-page">
    <AdminPageHead eyebrow="内容" title="知识库">
      <template #desc>
        "问手册"用的检索索引：每道已发布的题按小节切块，关键词（BM25）和向量两路检索，用 RRF 按排名融合，配置了重排模型时再把前几十块按相关度重新排序。改题后几秒内自动同步，只给变了的块重新生成向量。
      </template>
    </AdminPageHead>

    <template v-if="status">
      <div class="stats">
        <div class="a-card stat">
          <span class="stat-label">已索引的题</span>
          <span class="stat-value a-num">{{ status.questions }}</span>
        </div>
        <div class="a-card stat">
          <span class="stat-label">分块</span>
          <span class="stat-value a-num">{{ status.chunks }}</span>
          <span class="stat-sub">平均每题 {{ status.questions ? (status.chunks / status.questions).toFixed(1) : 0 }} 块</span>
        </div>
        <div class="a-card stat">
          <span class="stat-label">已生成向量</span>
          <span class="stat-value a-num">{{ status.embedded }}<small> / {{ status.chunks }}</small></span>
          <span class="bar" aria-hidden="true"><i :style="{ width: `${progress}%` }" /></span>
        </div>
        <div class="a-card stat">
          <span class="stat-label">检索方式</span>
          <span class="stat-value mode">{{ retrievalLabel }}</span>
          <span class="stat-sub">{{
            status.running ? '正在同步…' : [status.embed?.model, status.rerank?.model].filter(Boolean).join(' · ') || '没有配置向量模型'
          }}</span>
        </div>
      </div>

      <section class="a-card">
        <div class="a-card-head">
          <h2>索引</h2>
          <span class="aside">向量和重排模型来自 .env，改了要重启服务</span>
        </div>
        <div class="a-card-body">
          <dl class="kv">
            <dt>向量模型</dt>
            <dd>
              <span v-if="status.embed" class="a-code">{{ status.embed.model }}</span>
              <span v-else class="muted">未配置</span>
            </dd>
            <dt>接口地址</dt>
            <dd><span class="a-code">{{ status.embed?.baseUrl ?? '—' }}</span></dd>
            <dt>重排模型</dt>
            <dd>
              <template v-if="status.rerank">
                <span class="a-code">{{ status.rerank.model }}</span>
                <span class="muted"> · 每次给前 {{ status.rerank.candidates }} 块重新排序</span>
              </template>
              <span v-else class="muted">未配置</span>
            </dd>
            <dt>最近同步</dt>
            <dd>
              <template v-if="status.lastSyncAt">
                {{ new Date(status.lastSyncAt).toLocaleString('zh-CN') }}
                <span v-if="status.lastStats" class="muted">· {{ describeStats(status.lastStats) }}</span>
              </template>
              <span v-else class="muted">服务启动后还没有同步过</span>
            </dd>
          </dl>
          <div v-if="!status.embed" class="a-alert warn">
            <AdminIcon name="alert" :size="16" />
            <span>
              现在只用关键词检索，换个说法问就容易找不到。在 <span class="a-code">.env</span> 里填写
              <span class="a-code">NUXT_EMBED_API_KEY</span>（默认用硅基流动的 <span class="a-code">BAAI/bge-m3</span>，也可以用
              <span class="a-code">NUXT_EMBED_BASE_URL</span>、<span class="a-code">NUXT_EMBED_MODEL</span> 换成其他 OpenAI 兼容的向量接口）后重启服务，会自动生成向量。
            </span>
          </div>
          <div v-if="syncError || status.lastStats?.error" class="a-alert bad">
            <AdminIcon name="alert" :size="16" />
            <span>生成向量出错：{{ syncError || status.lastStats?.error }}。已有的向量和关键词检索不受影响，下次同步会接着生成。</span>
          </div>
          <div v-if="status.rerank?.lastError" class="a-alert warn">
            <AdminIcon name="alert" :size="16" />
            <span>
              重排接口最近出错（{{ new Date(status.rerank.lastError.at).toLocaleString('zh-CN') }}）：{{ status.rerank.lastError.message }}。出错时用融合排序，30 秒后再试。
            </span>
          </div>
          <button type="button" class="btn btn-sm" :disabled="syncing || status.running" @click="syncNow">
            <AdminIcon name="sync" :size="15" />{{ syncing || status.running ? '同步中…' : '立即同步' }}
          </button>
        </div>
      </section>

      <section class="a-card debug">
        <div class="a-card-head">
          <h2>检索调试</h2>
          <span class="aside">看一个问题能检索到什么、两路各排第几、重排前后怎么变，不调用大模型</span>
        </div>
        <div class="a-card-body">
          <form class="search" @submit.prevent="search">
            <ElInput v-model="query" placeholder="输入用户可能会问的问题，比如：热点 key 过期导致数据库被打爆" clearable />
            <div class="a-seg" role="group" aria-label="检索方式">
              <button v-for="(label, key) in MODE_LABELS" :key="key" type="button" :aria-pressed="only === key" @click="only = key">{{ label }}</button>
            </div>
            <div v-if="status.rerank" class="a-seg" role="group" aria-label="是否重排">
              <button type="button" :aria-pressed="rerankOn" @click="rerankOn = true">重排</button>
              <button type="button" :aria-pressed="!rerankOn" @click="rerankOn = false">不重排</button>
            </div>
            <button type="submit" class="btn btn-sm btn-primary" :disabled="searching || !query.trim()">
              <AdminIcon name="search" :size="15" />{{ searching ? '检索中…' : '检索' }}
            </button>
          </form>

          <div v-if="searchError" class="a-alert bad"><AdminIcon name="alert" :size="16" />{{ searchError }}</div>

          <template v-if="result">
            <p class="meta">
              {{ MODE_LABELS[result.mode] }} · 共 {{ result.hits.length }} 块
              <template v-if="result.embedMs">· 生成问题向量 {{ result.embedMs }}ms</template>
              <template v-if="result.rerank?.applied">
                · 重排 {{ result.rerank.candidates }} 块{{ result.rerank.cached ? '（用了缓存）' : `用时 ${result.rerank.ms}ms` }}
              </template>
              · 总耗时 {{ result.tookMs }}ms
            </p>
            <div v-if="result.warning" class="a-alert warn">
              <AdminIcon name="alert" :size="16" />向量接口出错，这次只用了关键词：{{ result.warning }}
            </div>
            <div v-if="result.rerank?.error" class="a-alert warn">
              <AdminIcon name="alert" :size="16" />重排没有生效，这次用的是融合排序：{{ result.rerank.error }}
            </div>
            <div v-if="result.hits.length" class="table-wrap">
              <table class="hits">
                <thead>
                  <tr>
                    <th class="c-rank">#</th>
                    <th>题目 · 小节</th>
                    <th class="c-n">关键词</th>
                    <th class="c-n">向量</th>
                    <th class="c-n" title="Σ 1 / (60 + 排名)">融合分</th>
                    <th v-if="result.rerank?.applied" class="c-n" title="重排模型给的相关度，越高越相关">重排分</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="h in result.hits" :key="`${h.questionId}-${h.rank}`">
                    <td class="c-rank a-num">{{ h.rank }}</td>
                    <td>
                      <NuxtLink :to="h.path" target="_blank" class="hit-title"><RichTitle :title="h.title" /></NuxtLink>
                      <span class="hit-heading">{{ h.heading }}</span>
                      <p class="hit-snippet">{{ h.snippet }}</p>
                    </td>
                    <td class="c-n a-num">{{ h.keywordRank ?? '—' }}</td>
                    <td class="c-n a-num">
                      <template v-if="h.vectorRank">{{ h.vectorRank }}<small>{{ h.similarity?.toFixed(3) }}</small></template>
                      <template v-else>—</template>
                    </td>
                    <td class="c-n a-mono">{{ (h.score * 1000).toFixed(1) }}</td>
                    <td v-if="result.rerank?.applied" class="c-n a-mono">
                      {{ h.rerankScore?.toFixed(3) ?? '—' }}<small v-if="h.fusedRank !== h.rank">原第 {{ h.fusedRank }}</small>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="a-empty">没有检索到内容</p>
            <p class="foot">
              融合分 = Σ 1000 / (60 + 排名)，两路都排得靠前的块分最高。<template v-if="status.rerank"
                >开启重排时，融合排序的前 {{ status.rerank.candidates }} 块交给重排模型打分，最终顺序是融合排序和按重排分的排序再做一次 RRF：
                只有一边靠前的块往前挪得有限，所以表格不一定按重排分从高到低排。</template
              >每道题最多取 2 块，问手册回答时用前 6 块。
            </p>
          </template>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.kb-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 18px;
}

.stat-label {
  font-size: 12.5px;
  color: var(--c-text-3);
}

.stat-value {
  font-size: 26px;
  font-weight: 700;
  line-height: 1.2;
}

.stat-value small {
  font-size: 14px;
  font-weight: 500;
  color: var(--c-text-3);
}

.stat-value.mode {
  font-family: var(--font-serif);
  font-size: 18px;
  line-height: 1.6;
}

.stat-sub {
  font-size: 12px;
  color: var(--c-text-3);
  overflow-wrap: anywhere;
}

.bar {
  display: block;
  height: 6px;
  margin-top: 6px;
  border-radius: var(--r-full);
  background: var(--c-bg-mute);
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--ai-grad);
  transition: width 0.3s;
}

.kv {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 10px 12px;
  margin: 0 0 14px;
  font-size: 14px;
}

.kv dt {
  color: var(--c-text-3);
}

.kv dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.a-alert {
  margin-bottom: 14px;
}

.search {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.search :deep(.el-input) {
  flex: 1 1 320px;
}

.meta {
  margin: 14px 0 10px;
  font-size: 13px;
  color: var(--c-text-2);
}

.table-wrap {
  overflow-x: auto;
}

.hits {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}

.hits th {
  padding: 8px 10px;
  border-bottom: 1px solid var(--c-divider);
  background: var(--c-bg-soft);
  color: var(--c-text-3);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}

.hits td {
  padding: 10px;
  border-bottom: 1px solid var(--c-divider);
  vertical-align: top;
}

.c-rank {
  width: 36px;
  text-align: center;
}

.c-n {
  width: 76px;
  text-align: right;
  white-space: nowrap;
}

th.c-n {
  text-align: right;
}

.c-n small {
  display: block;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--c-text-3);
}

.hit-title {
  font-weight: 600;
  color: var(--c-text-1);
}

.hit-title:hover {
  color: var(--c-brand);
}

.hit-heading {
  margin-left: 8px;
  font-size: 12px;
  color: var(--ai-text);
}

.hit-snippet {
  display: -webkit-box;
  margin: 4px 0 0;
  overflow: hidden;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--c-text-2);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.foot {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--c-text-3);
}

@media (max-width: 1100px) {
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
