import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const alias = { '#shared': fileURLToPath(new URL('./shared', import.meta.url)) }

export default defineConfig({
  test: {
    projects: [
      {
        // 单元测试：纯函数（提示词拼接、分数解析、复习排期、参数校验等），不需要数据库，几秒跑完
        resolve: { alias },
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' },
      },
      {
        // 接口测试：构建并启动真实服务，连独立的测试库（handbook_test）和本地模拟大模型，不碰正式数据
        resolve: { alias },
        test: {
          name: 'api',
          include: ['tests/api/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/api/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 600_000,
          fileParallelism: false,
        },
      },
    ],
  },
})
