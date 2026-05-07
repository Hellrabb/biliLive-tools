# autoClip UI 完善 & 扩展功能 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 autoClip 前端 UI 配置能力，增加全局/单直播间开关，扩展切片管理、审核流程、自动化导出上传闭环。

**Architecture:** 沿用现有 preset CRUD 模式扩展 AutoClipPreset（CommonPreset 子类 + DI 注册 + HTTP routes）。前端扩展现有 CutSetting.vue 和 RoomSettingDialog.vue，新增 AutoClipManagement 页面。配置存储在 `AppConfig.videoCut` 和 `AppRoomConfig` 上，与现有 webhook 的 global + rooms 覆盖模式一致。

**Tech Stack:** TypeScript, Vue 3 (Naive UI), Koa Router, better-sqlite3, awilix DI, pnpm monorepo

---

## 文件结构

```
packages/types/src/index.ts           [MODIFY] AppConfig.videoCut + AppRoomConfig + GlobalConfig 扩展
packages/shared/src/enum.ts            [MODIFY] videoCut 默认值扩展
packages/shared/src/index.ts           [MODIFY] DI 注册 AutoClipPreset
packages/shared/src/config.ts          [MODIFY] 确保 autoClipPresetPath 初始化

packages/shared/src/db/autoClip.ts     [CREATE] 切片结果 DB model
packages/shared/src/db/index.ts        [MODIFY] 注册 autoClip DB model

packages/shared/src/recorder/index.ts   [MODIFY] 录制器开关集成

packages/shared/src/autoClip/pipeline.ts [MODIFY] exportClips 完善 + 持久化集成

packages/http/src/routes/autoClip.ts    [MODIFY] 新增预设CRUD + clips路由，DI 注入 AutoClipPreset

packages/app/src/renderer/src/apis/presets/autoClip.ts  [CREATE] 前端 API client
packages/app/src/renderer/src/apis/presets/index.ts     [MODIFY] 导出 autoClipPresetApi

packages/app/src/renderer/src/pages/setting/CutSetting.vue       [MODIFY] 扩展 autoClip 配置区
packages/app/src/renderer/src/pages/setting/RoomSettingDialog.vue [MODIFY] 增加 autoClip 开关
packages/app/src/renderer/src/pages/setting/CommonWebhookSetting.vue [MODIFY] noGlobal 字段列表
packages/app/src/renderer/src/pages/setting/index.vue            [MODIFY] keep-alive 列表

packages/app/src/renderer/src/components/AutoClipPresetDialog.vue [CREATE] 预设编辑弹窗

packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue  [CREATE] 切片管理页

packages/app/src/renderer/src/routers/index.ts     [MODIFY] 注册 /autoClip 路由
packages/app/src/renderer/src/pages/Main/index.vue  [MODIFY] 导航菜单 + keep-alive
```

---

## Phase 1: 开关 + 预设 UI（核心配置能力）

### Task 1: 类型定义扩展

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: 扩展 GlobalConfig 和 AppConfig videoCut**

在 `packages/types/src/index.ts` 中，找到 `GlobalConfig` 接口（约1160行），追加一行：

```typescript
export interface GlobalConfig {
  // ... existing fields ...
  autoClipPresetPath: string;  // 新增
}
```

在同一文件中，找到 `AppConfig` 接口的 `videoCut` 字段（约644行），修改为：

```typescript
videoCut: {
  autoSave: boolean;
  cacheWaveform: boolean;
  // 新增 autoClip 配置 ↓
  autoClipEnabled: boolean;
  autoClipPresetId: string;
  autoClipExport: boolean;
  autoClipUpload: boolean;
  autoClipReviewMode: boolean;
  autoClipTimeWindow: {
    enabled: boolean;
    start: string;
    end: string;
  };
};
```

找到 `notification.task` 定义（约653行），追加一行：

```typescript
autoClip: NotificationTaskStatus[];
```

- [ ] **Step 2: 扩展 AppRoomConfig**

找到 `AppRoomConfig` 接口定义，追加两个可选字段：

```typescript
// AppRoomConfig 中新增
autoClipEnabled?: boolean;
autoClipPresetId?: string;
```

- [ ] **Step 3: 验证类型编译**

```bash
cd /home/hellrabbit/biliLive-tools && pnpm run build:base 2>&1 | tail -20
```

Expected: 构建成功，无类型错误。

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat(types): add autoClip fields to AppConfig, AppRoomConfig, and GlobalConfig"
```

---

### Task 2: AppConfig 默认值 & DI 注册

**Files:**
- Modify: `packages/shared/src/enum.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/config.ts`

- [ ] **Step 1: 更新 videoCut 默认值**

在 `packages/shared/src/enum.ts` 中，找到 `videoCut` 默认配置（约176行），修改为：

```typescript
videoCut: {
  autoSave: true,
  cacheWaveform: true,
  autoClipEnabled: false,
  autoClipPresetId: "default",
  autoClipExport: false,
  autoClipUpload: false,
  autoClipReviewMode: true,
  autoClipTimeWindow: {
    enabled: false,
    start: "00:00",
    end: "23:59",
  },
},
```

同时在该文件的 `notification.task` 默认值中添加：

```typescript
notification: {
  task: {
    // ... existing ...
    autoClip: [],
    // ...
  },
},
```

- [ ] **Step 2: 注册 autoClipPresetPath 到 GlobalConfig**

在 `packages/shared/src/config.ts` 中，找到 `GlobalConfig` 初始化的位置，确认 `autoClipPresetPath` 加入。找到类似：

```typescript
const globalConfig: GlobalConfig = {
  // ...
  ffmpegPresetPath: path.join(userDataPath, "ffmpegPresets.json"),
  // ...
};
```

追加一行：

```typescript
autoClipPresetPath: path.join(userDataPath, "autoClipPresets.json"),
```

- [ ] **Step 3: DI 注册 AutoClipPreset**

在 `packages/shared/src/index.ts` 中：

引入 `AutoClipPreset`：

```typescript
import { DanmuPreset, VideoPreset, FFmpegPreset, SubtitleStylePreset, AutoClipPreset } from "./presets/index.js";
```

在 `awilix` 接口类型声明中追加：

```typescript
autoClipPreset: AutoClipPreset;
```

在 `createContainer` 的 register 调用中追加：

```typescript
autoClipPreset: asClass(AutoClipPreset).singleton(),
```

- [ ] **Step 4: 验证构建**

```bash
cd /home/hellrabbit/biliLive-tools && pnpm run build:base 2>&1 | tail -20
```

Expected: 构建成功。

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/enum.ts packages/shared/src/index.ts packages/shared/src/config.ts
git commit -m "feat(shared): add AutoClipPreset DI registration and default config"
```

---

### Task 3: AutoClipPreset HTTP CRUD 路由

**Files:**
- Modify: `packages/http/src/routes/autoClip.ts`

- [ ] **Step 1: 重写 autoClip.ts 路由文件**

将 `packages/http/src/routes/autoClip.ts` 的预设存取改为从 DI 容器获取 `AutoClipPreset`，并新增 clips 管理路由：

```typescript
import Router from "@koa/router";
import logger from "@biliLive-tools/shared/utils/log.js";
import { runAutoClipPipeline, exportClips } from "@biliLive-tools/shared/autoClip/pipeline.js";
import { container, appConfig } from "../index.js";

import type { AutoClipConfig, AutoClipPreset as AutoClipPresetType } from "@biliLive-tools/types";

const router = new Router({ prefix: "/auto-clip" });

// In-memory result cache (fallback, 正式由 DB 管理)
const resultCache = new Map<string, any>();

function getAutoClipPreset() {
  return container.resolve("autoClipPreset") as any;
}

// ===================== 预设 CRUD =====================

// GET /auto-clip/presets — list all presets
router.get("/presets", async (ctx) => {
  const preset = getAutoClipPreset();
  ctx.body = await preset.list();
});

// GET /auto-clip/preset/:id
router.get("/preset/:id", async (ctx) => {
  const preset = getAutoClipPreset();
  ctx.body = await preset.get(ctx.params.id);
});

// POST /auto-clip/preset — create or update
router.post("/preset", async (ctx) => {
  const preset = getAutoClipPreset();
  const data = ctx.request.body as AutoClipPresetType;
  ctx.body = await preset.save(data);
});

// PUT /auto-clip/preset/:id
router.put("/preset/:id", async (ctx) => {
  const preset = getAutoClipPreset();
  const data = ctx.request.body as AutoClipPresetType;
  ctx.body = await preset.save({ ...data, id: ctx.params.id });
});

// DELETE /auto-clip/preset/:id
router.del("/preset/:id", async (ctx) => {
  const preset = getAutoClipPreset();
  ctx.body = await preset.delete(ctx.params.id);
});

// ===================== 手动触发 =====================

// POST /auto-clip/run — manually trigger auto-clip (已有，重构使用 DI preset)
router.post("/run", async (ctx) => {
  const { videoPath, danmuPath, presetId } = ctx.request.body as {
    videoPath?: string;
    danmuPath?: string;
    presetId?: string;
  };

  if (!videoPath || !danmuPath) {
    ctx.status = 400;
    ctx.body = { error: "videoPath and danmuPath are required" };
    return;
  }

  let presetConfig: AutoClipConfig;
  if (presetId) {
    try {
      const preset = getAutoClipPreset();
      const p = await preset.get(presetId);
      presetConfig = p?.config ?? (await import("@biliLive-tools/shared/presets/autoClipPreset.js")).AUTO_CLIP_DEFAULT_CONFIG;
    } catch {
      presetConfig = (await import("@biliLive-tools/shared/presets/autoClipPreset.js")).AUTO_CLIP_DEFAULT_CONFIG;
    }
  } else {
    presetConfig = (await import("@biliLive-tools/shared/presets/autoClipPreset.js")).AUTO_CLIP_DEFAULT_CONFIG;
  }

  const sendMessage = await buildSendMessage(presetConfig);

  try {
    const result = await runAutoClipPipeline({
      videoPath,
      danmuPath,
      presetConfig,
      sendMessage,
      onProgress: (_stage, _pct, message) => {
        logger.info(`[AutoClip] ${message}`);
      },
    });

    resultCache.set(result.id, result);
    ctx.body = result;
  } catch (error: any) {
    logger.error("AutoClip run error:", error);
    ctx.status = 500;
    ctx.body = { error: error.message };
  }
});

// GET /auto-clip/result/:id — query a result by ID
router.get("/result/:id", async (ctx) => {
  const { id } = ctx.params;
  const result = resultCache.get(id);
  if (!result) {
    ctx.status = 404;
    ctx.body = { error: "Result not found" };
    return;
  }
  ctx.body = result;
});

// ===================== Clips 管理 =====================

// GET /auto-clip/clips — 列表（Phase 2 实现 DB 查询，目前返回缓存中的结果）
router.get("/clips", async (ctx) => {
  // Placeholder — 将在 Phase 2 替换为 DB 查询
  ctx.body = Array.from(resultCache.values());
});

// GET /auto-clip/clip/:id
router.get("/clip/:id", async (ctx) => {
  const result = resultCache.get(ctx.params.id);
  if (!result) {
    ctx.status = 404;
    ctx.body = { error: "Not found" };
    return;
  }
  ctx.body = result;
});

// POST /auto-clip/clip/:id/approve — 审核通过并导出
router.post("/clip/:id/approve", async (ctx) => {
  const result = resultCache.get(ctx.params.id);
  if (!result) {
    ctx.status = 404;
    ctx.body = { error: "Not found" };
    return;
  }
  // Phase 2 实现: 触发 exportClips() + 上传
  ctx.body = { status: "approved", message: "Export queued (not yet implemented)" };
});

// POST /auto-clip/clip/:id/delete
router.post("/clip/:id/delete", async (ctx) => {
  const existed = resultCache.has(ctx.params.id);
  resultCache.delete(ctx.params.id);
  if (!existed) {
    ctx.status = 404;
    ctx.body = { error: "Not found" };
    return;
  }
  ctx.body = { status: "deleted" };
});

async function buildSendMessage(presetConfig: AutoClipConfig) {
  return async (prompt: string): Promise<string> => {
    if (presetConfig.llm.provider === "qwen") {
      const { QwenLLM } = await import("@biliLive-tools/shared/ai/llm/qwen.js");
      const aiConfig = appConfig.getAll().ai;
      const model = aiConfig.models.find((m: any) => m.modelId === presetConfig.llm.modelId);
      const vendor = aiConfig.vendors.find((v: any) => v.id === model?.vendorId);
      const llm = new QwenLLM({
        apiKey: vendor?.apiKey ?? "",
        model: model?.modelName,
        baseURL: vendor?.baseURL,
      });
      const result = await llm.sendMessage(prompt);
      return result.content;
    } else if (presetConfig.llm.provider === "ollama") {
      const { chat } = await import("@biliLive-tools/shared/llm/ollama.js");
      const aiConfig = appConfig.getAll().ai;
      const model = aiConfig.models.find((m: any) => m.modelId === presetConfig.llm.modelId);
      const vendor = aiConfig.vendors.find((v: any) => v.id === model?.vendorId);
      const result = await chat({
        host: vendor?.baseURL ?? "http://localhost:11434",
        model: model?.modelName ?? "qwen2.5",
        messages: [{ role: "user", content: prompt }],
      });
      return result?.message?.content ?? "";
    }
    throw new Error(`Unknown LLM provider: ${presetConfig.llm.provider}`);
  };
}

export default router;
```

- [ ] **Step 2: 验证 HTTP 路由编译**

```bash
cd /home/hellrabbit/biliLive-tools && pnpm run build:base 2>&1 | tail -20
```

Expected: 构建成功。

- [ ] **Step 3: Commit**

```bash
git add packages/http/src/routes/autoClip.ts
git commit -m "feat(http): add AutoClipPreset CRUD and clip management routes"
```

---

### Task 4: 录制器开关集成

**Files:**
- Modify: `packages/shared/src/recorder/index.ts`

- [ ] **Step 1: 修改 videoFileCompleted handler**

在 `packages/shared/src/recorder/index.ts` 中找到 autoClip 触发代码（约532行），将无条件执行改为开关控制：

```typescript
// 6. AutoClip: 录制完成后根据配置自动触发
try {
  const xmlFile = replaceExtName(filename, ".xml");
  if (xmlFile && (await fs.pathExists(xmlFile))) {
    // 读取 autoClip 配置
    const cfg = appConfig.getAll();
    const videoCutCfg = cfg?.videoCut ?? {};
    const autoClipEnabled = videoCutCfg.autoClipEnabled ?? false;

    if (!autoClipEnabled) {
      logger.info("AutoClip: 全局开关未开启，跳过");
      return;
    }

    // 检查时间窗口
    const tw = videoCutCfg.autoClipTimeWindow;
    if (tw?.enabled) {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const [sh, sm] = tw.start.split(":").map(Number);
      const [eh, em] = tw.end.split(":").map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      if (currentMinutes < startMin || currentMinutes > endMin) {
        logger.info(`AutoClip: 不在时间窗口内 (${tw.start}-${tw.end})，跳过`);
        return;
      }
    }

    logger.info("AutoClip: 检查自动切片触发条件", {
      videoPath: filename,
      danmuPath: xmlFile,
    });

    // 加载 preset 配置
    let presetConfig = AUTO_CLIP_DEFAULT_CONFIG;
    const presetId = videoCutCfg.autoClipPresetId;
    if (presetId) {
      try {
        const { container: diContainer } = await import("../index.js");
        const autoClipPreset = diContainer.resolve("autoClipPreset");
        const p = await autoClipPreset.get(presetId);
        presetConfig = p?.config ?? AUTO_CLIP_DEFAULT_CONFIG;
      } catch {
        // fallback to default
      }
    }

    const { runAutoClipPipeline } = await import("../autoClip/pipeline.js");
    const { AUTO_CLIP_DEFAULT_CONFIG } = await import("../presets/autoClipPreset.js");

    logger.info("AutoClip: 开始自动切片分析", { videoPath: filename, danmuPath: xmlFile });

    const result = await runAutoClipPipeline({
      videoPath: filename,
      danmuPath: xmlFile,
      presetConfig,
      onProgress: (_stage, _pct, msg) => logger.info(`AutoClip: ${msg}`),
    });

    if (result.skipped) {
      logger.info(`AutoClip: 跳过 — ${result.skippedReason}`);
    } else {
      logger.info(`AutoClip: 检测到 ${result.highlights.length} 个高光片段`);
      for (const h of result.highlights) {
        logger.info(`AutoClip highlight: "${h.title}" (score: ${h.score}, ${h.bestRange[0]}-${h.bestRange[1]}s)`);
      }
      // Phase 2 将实现：持久化 + 根据 reviewMode 导出
    }
  }
} catch (error) {
  logger.error("AutoClip: 自动切片触发失败", error);
}
```

- [ ] **Step 2: 验证构建**

```bash
cd /home/hellrabbit/biliLive-tools && pnpm run build:base 2>&1 | tail -20
```

Expected: 构建成功。

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/recorder/index.ts
git commit -m "feat(recorder): add autoClip toggle and time window check"
```

---

### Task 5: 数据库 — autoClip 结果表

**Files:**
- Create: `packages/shared/src/db/autoClip.ts`
- Modify: `packages/shared/src/db/index.ts`

- [ ] **Step 1: 创建 DB model**

新建 `packages/shared/src/db/autoClip.ts`：

```typescript
import BaseModel from "./model/baseModel.js";
import logger from "../utils/log.js";

import type { Database } from "better-sqlite3";

export interface AutoClipResultRow {
  id: string;
  video_path: string;
  danmu_path: string;
  recorder_id: string | null;
  preset_id: string | null;
  status: "pending" | "approved" | "exported" | "uploaded" | "deleted";
  highlights: string; // JSON string
  created_at: string;
  exported_at: string | null;
  uploaded_at: string | null;
  exported_paths: string | null; // JSON string
  bili_aids: string | null; // JSON string
}

export default class AutoClipModel extends BaseModel<AutoClipResultRow> {
  table = "auto_clip_results";

  constructor({ db }: { db: Database }) {
    super(db, "auto_clip_results");
    this.createTable();
    this.createIndexes();
  }

  createTable() {
    const sql = `
      CREATE TABLE IF NOT EXISTS auto_clip_results (
        id TEXT PRIMARY KEY,
        video_path TEXT NOT NULL,
        danmu_path TEXT NOT NULL,
        recorder_id TEXT,
        preset_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        highlights TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        exported_at TEXT,
        uploaded_at TEXT,
        exported_paths TEXT,
        bili_aids TEXT
      ) STRICT;
    `;
    super.createTable(sql);
    return true;
  }

  createIndexes() {
    try {
      const indexes = [
        {
          name: "idx_auto_clip_status",
          sql: `CREATE INDEX IF NOT EXISTS idx_auto_clip_status ON auto_clip_results(status)`,
        },
        {
          name: "idx_auto_clip_recorder",
          sql: `CREATE INDEX IF NOT EXISTS idx_auto_clip_recorder ON auto_clip_results(recorder_id)`,
        },
        {
          name: "idx_auto_clip_created",
          sql: `CREATE INDEX IF NOT EXISTS idx_auto_clip_created ON auto_clip_results(created_at)`,
        },
      ];
      for (const idx of indexes) {
        if (!this.checkIndexExists(idx.name)) {
          this.db.prepare(idx.sql).run();
          logger.info(`已创建索引: ${idx.name}`);
        }
      }
    } catch (error) {
      logger.error("创建 auto_clip_results 索引失败:", error);
    }
  }

  private checkIndexExists(indexName: string): boolean {
    const result = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='auto_clip_results' AND name=?`)
      .get(indexName);
    return !!result;
  }

  saveResult(row: AutoClipResultRow) {
    return this.insert(row);
  }

  getResults(filter?: {
    status?: string;
    recorderId?: string;
    limit?: number;
    offset?: number;
  }): { data: AutoClipResultRow[]; total: number } {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.status) {
      conditions.push("status = ?");
      params.push(filter.status);
    }
    if (filter?.recorderId) {
      conditions.push("recorder_id = ?");
      params.push(filter.recorderId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;

    const countSql = `SELECT COUNT(*) as total FROM auto_clip_results ${whereClause}`;
    const countResult = this.db.prepare(countSql).get(...params) as { total: number };

    const dataSql = `SELECT * FROM auto_clip_results ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const data = this.db.prepare(dataSql).all(...params, limit, offset) as AutoClipResultRow[];

    return { data, total: countResult.total };
  }

  getResultById(id: string): AutoClipResultRow | undefined {
    return this.db.prepare("SELECT * FROM auto_clip_results WHERE id = ?").get(id) as AutoClipResultRow | undefined;
  }

  updateStatus(id: string, status: string) {
    return this.db.prepare("UPDATE auto_clip_results SET status = ? WHERE id = ?").run(status, id);
  }

  markExported(id: string, exportedPaths: string[]) {
    return this.db
      .prepare("UPDATE auto_clip_results SET status = 'exported', exported_at = datetime('now'), exported_paths = ? WHERE id = ?")
      .run(JSON.stringify(exportedPaths), id);
  }

  markUploaded(id: string, biliAids: string[]) {
    return this.db
      .prepare("UPDATE auto_clip_results SET status = 'uploaded', uploaded_at = datetime('now'), bili_aids = ? WHERE id = ?")
      .run(JSON.stringify(biliAids), id);
  }

  deleteResult(id: string) {
    return this.db.prepare("UPDATE auto_clip_results SET status = 'deleted' WHERE id = ?").run(id);
  }
}
```

- [ ] **Step 2: 在 db/index.ts 中注册 model**

在 `packages/shared/src/db/index.ts` 中引入并实例化 `AutoClipModel`，将其暴露给 DI 容器。

（需要先确认 db/index.ts 的实际内容来确保正确注册。通常在 `init` 或类似函数中创建 model 实例。）

检查 `packages/shared/src/db/index.ts` 的导出方式，确 AutoClipModel 实例可被其他模块访问。

- [ ] **Step 3: 验证构建**

```bash
cd /home/hellrabbit/biliLive-tools && pnpm run build:base 2>&1 | tail -20
```

Expected: 构建成功。

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/db/autoClip.ts
git commit -m "feat(db): add autoClip results table model"
```

---

### Task 6: CutSetting.vue 扩展 — 切片 Tab autoClip 配置区

**Files:**
- Modify: `packages/app/src/renderer/src/pages/setting/CutSetting.vue`

- [ ] **Step 1: 重写 CutSetting.vue**

```vue
<template>
  <n-form label-placement="left" :label-width="150">
    <!-- 手动切片 -->
    <h3 style="margin-bottom:8px">手动切片</h3>
    <n-form-item>
      <template #label>
        <Tip text="自动保存" tip="在进行操作之后，自动保存项目文件"></Tip>
      </template>
      <n-switch v-model:value="config.videoCut.autoSave" />
    </n-form-item>
    <n-form-item>
      <template #label>
        <Tip text="缓存波形图数据" tip="缓存波形图数据，避免每次重新计算波形图"></Tip>
      </template>
      <n-switch v-model:value="config.videoCut.cacheWaveform" />
    </n-form-item>

    <n-divider />

    <!-- 自动切片 (autoClip) -->
    <h3 style="margin-bottom:8px">自动切片 (autoClip)</h3>
    <n-form-item>
      <template #label>
        <Tip text="启用 autoClip" tip="录制完成后自动检测高光片段，需配合弹幕录制开启"></Tip>
      </template>
      <n-switch v-model:value="config.videoCut.autoClipEnabled" />
    </n-form-item>

    <template v-if="config.videoCut.autoClipEnabled">
      <n-form-item>
        <template #label>
          <span class="inline-flex">默认预设</span>
        </template>
        <n-select
          v-model:value="config.videoCut.autoClipPresetId"
          :options="presetOptions"
          placeholder="选择预设"
          style="width:200px"
        />
        <n-button type="primary" ghost style="margin-left:8px" @click="openPresetEditor">
          编辑预设
        </n-button>
      </n-form-item>

      <n-form-item>
        <template #label>
          <Tip text="自动导出切片视频" tip="分析完成后自动用 ffmpeg 导出切片视频文件"></Tip>
        </template>
        <n-switch v-model:value="config.videoCut.autoClipExport" />
      </n-form-item>

      <n-form-item>
        <template #label>
          <Tip text="自动上传B站" tip="导出切片后自动上传到B站（需配置B站上传预设）"></Tip>
        </template>
        <n-switch v-model:value="config.videoCut.autoClipUpload" />
      </n-form-item>

      <n-form-item>
        <template #label>
          <Tip text="审核模式" tip="开启后切片结果需手动审核确认才会导出/上传"></Tip>
        </template>
        <n-switch v-model:value="config.videoCut.autoClipReviewMode" />
      </n-form-item>

      <n-form-item label="运行时间窗口">
        <n-space>
          <n-switch v-model:value="config.videoCut.autoClipTimeWindow.enabled" />
          <span v-if="config.videoCut.autoClipTimeWindow.enabled">
            <n-time-picker
              v-model:formatted-value="config.videoCut.autoClipTimeWindow.start"
              format="HH:mm"
              style="width:100px"
            />
            -
            <n-time-picker
              v-model:formatted-value="config.videoCut.autoClipTimeWindow.end"
              format="HH:mm"
              style="width:100px"
            />
          </span>
        </n-space>
      </n-form-item>
    </template>
  </n-form>

  <!-- 预设编辑弹窗 -->
  <AutoClipPresetDialog
    v-model:visible="presetEditorVisible"
    @updated="refreshPresets"
  />
</template>

<script setup lang="ts">
import type { AppConfig } from "@biliLive-tools/types";
import AutoClipPresetDialog from "@renderer/components/AutoClipPresetDialog.vue";
import { autoClipPresetApi } from "@renderer/apis/presets";

const config = defineModel<AppConfig>("data", {
  default: () => ({}),
});

const presetOptions = ref<{ label: string; value: string }[]>([]);
const presetEditorVisible = ref(false);

async function refreshPresets() {
  const presets = await autoClipPresetApi.list();
  presetOptions.value = presets.map((p: any) => ({ label: p.name, value: p.id }));
}

function openPresetEditor() {
  presetEditorVisible.value = true;
}

onMounted(() => {
  refreshPresets();
});
</script>

<style scoped lang="less">
.item {
  display: flex;
}
</style>
```

- [ ] **Step 2: 创建前端 API client**

新建 `packages/app/src/renderer/src/apis/presets/autoClip.ts`：

```typescript
import request from "../request";
import type { AutoClipPreset as AutoClipPresetType } from "@biliLive-tools/types";

const list = async (): Promise<AutoClipPresetType[]> => {
  const res = await request.get("/auto-clip/presets");
  return res.data;
};

const get = async (id: string): Promise<AutoClipPresetType> => {
  const res = await request.get(`/auto-clip/preset/${id}`);
  return res.data;
};

const save = async (preset: AutoClipPresetType) => {
  if (preset.id) {
    return request.put(`/auto-clip/preset/${preset.id}`, preset);
  }
  return request.post("/auto-clip/preset", preset);
};

const remove = async (id: string) => {
  return request.delete(`/auto-clip/preset/${id}`);
};

const autoClipPresetApi = { list, get, save, remove };
export default autoClipPresetApi;
```

更新 `packages/app/src/renderer/src/apis/presets/index.ts`，添加导出：

```typescript
import autoClipPresetApi from "./autoClip";
export { danmuPresetApi, ffmpegPresetApi, videoPresetApi, subtitleStylePresetApi, autoClipPresetApi };
```

- [ ] **Step 3: 验证前端编译**

```bash
cd /home/hellrabbit/biliLive-tools && pnpm run build:app 2>&1 | tail -20
```

Expected: 构建成功。

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/renderer/src/pages/setting/CutSetting.vue \
        packages/app/src/renderer/src/apis/presets/autoClip.ts \
        packages/app/src/renderer/src/apis/presets/index.ts
git commit -m "feat(ui): add autoClip config section to CutSetting tab"
```

---

### Task 7: AutoClipPresetDialog — 预设编辑弹窗

**Files:**
- Create: `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue`

- [ ] **Step 1: 创建预设编辑弹窗组件**

新建 `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue`：

```vue
<template>
  <n-modal v-model:show="showModal" :mask-closable="false" style="width:900px">
    <n-card :bordered="false" size="small" role="dialog" aria-modal="true">
      <div style="display:flex;gap:12px">
        <!-- 左侧预设列表 -->
        <div style="width:180px;flex-shrink:0">
          <div style="font-weight:bold;margin-bottom:8px">预设列表</div>
          <div
            v-for="p in presets"
            :key="p.id"
            :style="{ padding: '6px 8px', cursor: 'pointer', borderRadius: '3px', marginBottom: '4px',
              background: selectedId === p.id ? '#e8f5e9' : 'transparent',
              fontWeight: selectedId === p.id ? 'bold' : 'normal' }"
            @click="selectPreset(p.id)"
          >
            {{ p.name }}
          </div>
          <n-button dashed style="width:100%;margin-top:8px" @click="createPreset">
            + 新建预设
          </n-button>
        </div>

        <!-- 右侧编辑区 -->
        <div style="flex:1;min-width:0">
          <div v-if="!editingPreset" style="text-align:center;padding:40px;color:#999">
            请选择或创建一个预设
          </div>

          <template v-else>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
              <n-input v-model:value="editingPreset.name" placeholder="预设名称" style="width:200px" />
              <n-button size="small" @click="savePreset" type="primary">保存</n-button>
              <n-button v-if="editingPreset.id !== 'default'" size="small" @click="deletePreset" type="error" ghost>删除</n-button>
              <n-button size="small" @click="copyPreset">复制</n-button>
            </div>

            <n-tabs v-model:value="activeTab" type="segment" animated>
              <!-- Tab 1: 信号检测 -->
              <n-tab-pane name="signal" tab="信号检测">
                <n-form label-placement="left" :label-width="170" size="small">
                  <n-form-item label="弹幕密度阈值">
                    <n-input-number v-model:value="editingPreset.config.signal.danmakuDensityThreshold" :step="0.1" min="1" />
                    <span style="margin-left:4px">x 均值</span>
                  </n-form-item>
                  <n-form-item label="SC 最低金额触发">
                    <n-input-number v-model:value="editingPreset.config.signal.scMinAmount" :step="1" min="0" />
                    <span style="margin-left:4px">元</span>
                  </n-form-item>
                  <n-form-item label="礼物爆发阈值">
                    <n-input-number v-model:value="editingPreset.config.signal.giftBurstThreshold" :step="1" min="1" />
                    <span style="margin-left:4px">个</span>
                  </n-form-item>
                  <n-form-item label="礼物统计窗口">
                    <n-input-number v-model:value="editingPreset.config.signal.giftBurstWindowSec" :step="1" min="5" />
                    <span style="margin-left:4px">秒</span>
                  </n-form-item>
                  <n-form-item label="候选窗口 Padding (前/后)">
                    <n-space>
                      <n-input-number v-model:value="editingPreset.config.signal.windowPadding[0]" :step="1" min="0" style="width:80px" />
                      <span>/</span>
                      <n-input-number v-model:value="editingPreset.config.signal.windowPadding[1]" :step="1" min="0" style="width:80px" />
                      <span>秒</span>
                    </n-space>
                  </n-form-item>
                  <n-form-item label="最短候选窗口">
                    <n-input-number v-model:value="editingPreset.config.signal.minWindowDuration" :step="1" min="10" />
                    <span style="margin-left:4px">秒</span>
                  </n-form-item>
                  <n-form-item label="最长候选窗口">
                    <n-input-number v-model:value="editingPreset.config.signal.maxWindowDuration" :step="1" min="30" />
                    <span style="margin-left:4px">秒</span>
                  </n-form-item>
                  <n-form-item label="分析桶宽">
                    <n-input-number v-model:value="editingPreset.config.signal.bucketSec" :step="1" min="1" />
                    <span style="margin-left:4px">秒</span>
                  </n-form-item>
                  <n-form-item label="相邻合并最大间隔">
                    <n-input-number v-model:value="editingPreset.config.signal.mergeGapSec" :step="1" min="1" />
                    <span style="margin-left:4px">秒</span>
                  </n-form-item>
                  <n-form-item label="刷屏检测相似度阈值">
                    <n-input-number v-model:value="editingPreset.config.signal.brushSimilarityThreshold" :step="0.05" min="0" max="1" />
                  </n-form-item>
                </n-form>
              </n-tab-pane>

              <!-- Tab 2: LLM 精排 -->
              <n-tab-pane name="llm" tab="LLM精排">
                <n-form label-placement="left" :label-width="170" size="small">
                  <n-form-item label="启用 LLM 精排">
                    <n-switch v-model:value="editingPreset.config.llm.enabled" />
                  </n-form-item>
                  <n-form-item label="LLM Provider">
                    <n-select v-model:value="editingPreset.config.llm.provider" :options="[{label:'Qwen',value:'qwen'},{label:'Ollama',value:'ollama'}]" style="width:150px" />
                  </n-form-item>
                  <n-form-item label="Model ID">
                    <n-input v-model:value="editingPreset.config.llm.modelId" style="width:200px" />
                  </n-form-item>
                  <n-form-item label="Max Tokens">
                    <n-input-number v-model:value="editingPreset.config.llm.maxTokens" :step="100" min="100" />
                  </n-form-item>
                  <n-form-item label="保留片段数 (Top-K)">
                    <n-input-number v-model:value="editingPreset.config.llm.topK" :step="1" min="1" />
                  </n-form-item>
                  <n-form-item label="每视频最大候选数">
                    <n-input-number v-model:value="editingPreset.config.llm.maxCandidatesPerVideo" :step="1" min="1" />
                  </n-form-item>
                  <n-form-item label="弹幕采样上限">
                    <n-input-number v-model:value="editingPreset.config.llm.danmakuSampleMax" :step="10" min="10" />
                  </n-form-item>
                  <n-form-item label="Prompt 模板">
                    <n-input
                      v-model:value="editingPreset.config.llm.promptTemplate"
                      type="textarea"
                      :autosize="{ minRows: 4, maxRows: 8 }"
                      placeholder="自定义 prompt 模板，留空使用默认模板"
                    />
                  </n-form-item>
                </n-form>
              </n-tab-pane>

              <!-- Tab 3: 导出设置 -->
              <n-tab-pane name="export" tab="导出设置">
                <n-form label-placement="left" :label-width="170" size="small">
                  <n-form-item label="切片格式">
                    <n-select v-model:value="editingPreset.config.export.cutFormat" :options="[{label:'mp4',value:'mp4'},{label:'flv',value:'flv'}]" style="width:120px" />
                  </n-form-item>
                  <n-form-item label="FFmpeg 预设">
                    <n-input v-model:value="editingPreset.config.export.ffmpegPresetId" style="width:200px" />
                  </n-form-item>
                  <n-form-item label="压制弹幕到视频">
                    <n-switch v-model:value="editingPreset.config.export.burnDanmaku" />
                  </n-form-item>
                  <n-form-item label="上传到B站">
                    <n-switch v-model:value="editingPreset.config.export.uploadToBili" />
                  </n-form-item>
                  <n-form-item label="保存路径">
                    <n-input v-model:value="editingPreset.config.export.savePath" placeholder="留空使用录制保存路径" />
                  </n-form-item>
                  <n-form-item label="文件命名模板">
                    <n-input v-model:value="editingPreset.config.export.namingTemplate" />
                  </n-form-item>
                </n-form>
              </n-tab-pane>

              <!-- Tab 4: 增强 -->
              <n-tab-pane name="enhancement" tab="增强">
                <n-form label-placement="left" :label-width="170" size="small">
                  <n-form-item label="ASR 语音识别增强">
                    <n-switch :value="false" disabled />
                    <span style="color:#999;margin-left:8px;font-size:12px">即将上线</span>
                  </n-form-item>
                  <n-form-item label="视觉关键帧分析">
                    <n-switch :value="false" disabled />
                    <span style="color:#999;margin-left:8px;font-size:12px">即将上线</span>
                  </n-form-item>
                </n-form>
              </n-tab-pane>
            </n-tabs>
          </template>
        </div>
      </div>
    </n-card>
  </n-modal>
</template>

<script setup lang="ts">
import type { AutoClipPreset as AutoClipPresetType, AutoClipConfig } from "@biliLive-tools/types";
import { autoClipPresetApi } from "@renderer/apis/presets";
import { useConfirm } from "@renderer/hooks";
import { cloneDeep } from "lodash-es";
import { v4 as uuidv4 } from "uuid";

const visible = defineModel<boolean>("visible", { default: false });
const emit = defineEmits<{ (e: "updated"): void }>();

const showModal = computed({
  get: () => visible.value,
  set: (v) => { visible.value = v; },
});

const presets = ref<AutoClipPresetType[]>([]);
const selectedId = ref<string>("");
const editingPreset = ref<AutoClipPresetType | null>(null);
const activeTab = ref("signal");
const confirm = useConfirm();

const defaultConfig: AutoClipConfig = {
  signal: {
    danmakuDensityThreshold: 2.5, scMinAmount: 30, giftBurstThreshold: 10,
    giftBurstWindowSec: 30, windowPadding: [30, 30], minWindowDuration: 60,
    maxWindowDuration: 300, bucketSec: 10, mergeGapSec: 30, brushSimilarityThreshold: 0.8,
  },
  llm: {
    enabled: true, provider: "qwen", modelId: "", maxTokens: 1000,
    topK: 5, maxCandidatesPerVideo: 15, danmakuSampleMax: 200,
  },
  enhancement: { asrEnabled: false, visualEnabled: false },
  export: {
    cutFormat: "mp4", ffmpegPresetId: "default", burnDanmaku: false,
    uploadToBili: false, savePath: "", namingTemplate: "{{title}}_{{index}}_{{highlight_name}}",
  },
};

async function loadPresets() {
  try {
    presets.value = await autoClipPresetApi.list();
    if (presets.value.length > 0 && !selectedId.value) {
      selectPreset(presets.value[0].id);
    }
  } catch { /* preset file doesn't exist yet */ }
}

function selectPreset(id: string) {
  selectedId.value = id;
  const p = presets.value.find((x) => x.id === id);
  if (p) editingPreset.value = cloneDeep(p);
}

function createPreset() {
  const newPreset: AutoClipPresetType = {
    id: uuidv4(),
    name: "新建预设",
    config: cloneDeep(defaultConfig),
  };
  presets.value.push(newPreset);
  selectedId.value = newPreset.id;
  editingPreset.value = cloneDeep(newPreset);
}

async function savePreset() {
  if (!editingPreset.value) return;
  await autoClipPresetApi.save(editingPreset.value);
  await loadPresets();
  emit("updated");
}

async function deletePreset() {
  if (!editingPreset.value || editingPreset.value.id === "default") return;
  const [ok] = await confirm.warning({ content: "确认删除此预设?" });
  if (!ok) return;
  await autoClipPresetApi.remove(editingPreset.value.id);
  editingPreset.value = null;
  selectedId.value = "";
  await loadPresets();
  emit("updated");
}

function copyPreset() {
  if (!editingPreset.value) return;
  const copy = cloneDeep(editingPreset.value);
  copy.id = uuidv4();
  copy.name = copy.name + " (副本)";
  presets.value.push(copy);
  selectedId.value = copy.id;
  editingPreset.value = cloneDeep(copy);
}

watch(visible, (v) => {
  if (v) loadPresets();
});
</script>
```

- [ ] **Step 2: 验证前端编译**

```bash
cd /home/hellrabbit/biliLive-tools && pnpm run build:app 2>&1 | tail -20
```

Expected: 构建成功。

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/renderer/src/components/AutoClipPresetDialog.vue
git commit -m "feat(ui): add AutoClipPreset editor dialog component"
```

---

### Task 8: RoomSettingDialog — 单直播间 autoClip 开关

**Files:**
- Modify: `packages/app/src/renderer/src/pages/setting/RoomSettingDialog.vue`
- Modify: `packages/app/src/renderer/src/pages/setting/CommonWebhookSetting.vue`

- [ ] **Step 1: RoomSettingDialog 增加 autoClip 开关**

在 `RoomSettingDialog.vue` 的 `<n-form>` 中，`<CommonSetting>` 组件之后（约第35行之前），新增 autoClip 配置区：

```vue
<n-divider />
<h3 style="margin-bottom:8px">自动切片</h3>
<n-form-item>
  <template #label>
    <span class="inline-flex">
      autoClip
      <Tip tip="覆盖全局 autoClip 设置"></Tip>
    </span>
  </template>
  <n-switch v-model:value="data.autoClipEnabled" />
  <n-checkbox v-model:checked="globalFieldsObj.autoClipEnabled" class="global-checkbox">
    全局
  </n-checkbox>
</n-form-item>
<n-form-item>
  <template #label>
    <span class="inline-flex">预设</span>
  </template>
  <n-select
    v-model:value="data.autoClipPresetId"
    :options="autoClipPresetOptions"
    placeholder="使用全局预设"
    clearable
    style="width:200px"
    :disabled="globalFieldsObj.autoClipPresetId"
  />
  <n-checkbox v-model:checked="globalFieldsObj.autoClipPresetId" class="global-checkbox">
    全局
  </n-checkbox>
</n-form-item>
```

在 `<script setup>` 中新增：

```typescript
import { autoClipPresetApi } from "@renderer/apis/presets";

const autoClipPresetOptions = ref<{ label: string; value: string }[]>([]);

onMounted(async () => {
  try {
    const presets = await autoClipPresetApi.list();
    autoClipPresetOptions.value = presets.map((p: any) => ({ label: p.name, value: p.id }));
  } catch { /* ignore */ }
});
```

- [ ] **Step 2: CommonWebhookSetting 追加 noGlobal 字段**

在 `packages/app/src/renderer/src/pages/setting/CommonWebhookSetting.vue` 的 `<script setup>` 中找到 globalFields 列表或其定义位置，以及在 `setting/index.vue` 中找到 `globalFields` 数组（约656行），追加：

```typescript
// 在 globalFields 数组中添加：
"autoClipEnabled",
"autoClipPresetId",
```

同时在 `tempRoomDetail` 默认值中（约721行）追加：

```typescript
autoClipEnabled: undefined,
autoClipPresetId: undefined,
```

- [ ] **Step 3: 验证前端编译**

```bash
cd /home/hellrabbit/biliLive-tools && pnpm run build:app 2>&1 | tail -20
```

Expected: 构建成功。

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/renderer/src/pages/setting/RoomSettingDialog.vue \
        packages/app/src/renderer/src/pages/setting/CommonWebhookSetting.vue \
        packages/app/src/renderer/src/pages/setting/index.vue
git commit -m "feat(ui): add per-room autoClip toggle and preset selection"
```

---

### Task 9: Phase 1 集成验证

- [ ] **Step 1: 完整构建**

```bash
cd /home/hellrabbit/biliLive-tools && pnpm run build:base && pnpm run build:app 2>&1 | tail -10
```

Expected: 构建成功，无类型错误。

- [ ] **Step 2: 运行测试**

```bash
cd /home/hellrabbit/biliLive-tools && pnpm run test 2>&1 | tail -20
```

Expected: 所有已有测试通过。

---

## Phase 2: 自动导出 & 上传闭环

*(Phase 2-4 的详细实现将在 Phase 1 完成后根据实际状态细化，此处列出高层次任务)*

### Task 10: exportClips 完善 + 持久化

**Files:**
- Modify: `packages/shared/src/autoClip/pipeline.ts`

- 将 pipeline 运行结果持久化到 `auto_clip_results` 表
- `reviewMode=true` → status='pending'; `reviewMode=false` → 自动调用 `exportClips()` → status='exported'
- 集成通知发送（切片完成时触发 `sendNotify`）

### Task 11: 自动上传 B 站集成

- 复用 `packages/shared/src/task/bili.ts` 的上传 pipeline
- 在 `exportClips()` 完成后，若 `export.uploadToBili=true`，调用上传
- 更新 `auto_clip_results.bili_aids`

### Task 12: HTTP clips 路由接入 DB

- 替换 `autoClip.ts` 中的 `resultCache` 为 DB 查询
- approve/delete/re-export 路由接入真实操作

---

## Phase 3: 切片管理页

### Task 13: AutoClipManagement 页面

**Files:**
- Create: `packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue`

- 路由 `/autoClip`，组件名 `AutoClipManagement`
- 状态筛选 tabs（全部/待审核/已完成/失败）
- 切片列表，每项显示：标题、评分、时间段、标签、状态、操作按钮
- 预览按钮跳转 `/videoPlayer`
- 手动分析按钮调用 `POST /auto-clip/run`

### Task 14: 导航 & 录播列表按钮

- 在 `Main/index.vue` 添加"自动切片"菜单项
- 在录制列表中加"自动分析"操作按钮

---

## Phase 4: 高级功能

### Task 15: 通知配置

- `NotificationSetting.vue` 新增 autoClip 通知勾选

### Task 16: 时间窗口 & 运行细化

- 时间窗口已在 Phase 1 的类型和 UI 中实现，后端开关逻辑在 Phase 1 Task 4 中已实现

### Task 17: 重新导出 & ASR/视觉占位

- 重新导出按钮对接 `POST /auto-clip/clip/:id/re-export`
- ASR/视觉已在预设编辑器中以禁用状态占位
