# DESIGN — autoclip-evidence-chain

- **Change ID**: `autoclip-evidence-chain`
- **关联**: `REQUIREMENT.md`、`CONTEXT.md`

---

## 0. 技术栈选定

> 既有项目，栈已锁定。

- **选定**：沿用既有 biliLive-tools 栈
- **前端**：Vue 3 (Composition API) + Naive UI + TypeScript
- **后端**：Node.js 24 ESM + Koa + awilix DI
- **数据库**：better-sqlite3（同步 SQLite）
- **关键依赖**：无新增依赖。密度曲线图使用 Canvas API 自绘或引入轻量图表库（TASK 阶段确定）
- **明确排除**：ECharts / D3.js（过度工程，密度曲线只需简易柱状/折线图）

---

## 0.5 既有架构对齐

### 0.5.1 触碰模块

```
既有·触碰：
- packages/shared/src/autoClip/types.ts（加 Evidence 接口）
- packages/shared/src/autoClip/pipeline.ts（加 evidence 捕获 + buildEvidence 调用）
- packages/shared/src/autoClip/signalDetector.ts（返回值加 DensityBucket[]）
- packages/shared/src/autoClip/boundaryRefiner.ts（返回值加 refinements）
- packages/shared/src/autoClip/service.ts（analyzeAndSave 写 evidence）
- packages/shared/src/db/autoClip.ts（migration v6 + evidence 列）
- packages/http/src/routes/autoClip.ts（API 加 evidence 字段）
- packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue（master-detail 布局）

新增：
- packages/shared/src/autoClip/evidence.ts（buildEvidence 函数）
- packages/app/src/renderer/src/pages/AutoClipManagement/components/EvidencePanel.vue

禁动清单（不可碰）：
- packages/shared/src/index.ts（init() DI 容器签名不可变）
- packages/shared/src/config.ts（AppConfig 不可变）
- packages/liveManager/（录制引擎与本次无关）
- packages/types/src/index.ts（公共类型包，Evidence 放 autoClip 内部 types.ts）
```

### 0.5.2 既有抽象沿用

| 本次需要       | 既有？路径                   | 决定                                         |
| -------------- | ---------------------------- | -------------------------------------------- |
| DB migration   | `BaseModel.migrate()`        | 沿用（v6 pattern 与 v1-v5 一致）             |
| DI 注入        | awilix container             | 沿用（不新增注册项）                         |
| 日志           | `logger` from `utils/log.ts` | 沿用                                         |
| Pipeline abort | `checkAborted(signal)`       | 沿用                                         |
| JSON 解析容错  | 无通用工具                   | 新建 `parseEvidenceSafe`（内联在 routes 中） |
| 前端数据表     | Naive UI `n-data-table`      | 沿用（加 row-props 实现选中行高亮）          |
| 前端图表       | 无                           | 新建（Canvas API 自绘密度曲线，零依赖）      |

### 0.5.3 沿用 vs 引入新模式

```
- API 路由：**沿用** koa-router + container.resolve 获取 service
- DB 访问：**沿用** AutoClipModel extends BaseModel
- 前端状态：**沿用** Vue 3 ref/computed（不新增 Pinia store）
- 证据链构建：**引入新模式**（buildEvidence 纯函数）→ 理由：证据组装逻辑独立于 pipeline，方便测试和复用
- 前端 master-detail：**引入新模式**（selectedClipId ref + computed selectedClip）→ 理由：Naive UI data-table 无内置行选中，通过 row-props onClick 实现
```

---

## 1. 决策清单

| #   | 决策                                                                                                   | 备选                                      | 选择理由                                                                                  | 取舍代价                                                         |
| --- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| D1  | Evidence 作为 `AutoClipResult` 的可选字段（`evidence?: Evidence`）                                     | 独立表存储                                | 与结果一一对应，无需额外 JOIN；证据数据随结果一起返回 API                                 | 旧数据无 evidence 字段，前端需处理 null                          |
| D2  | 证据捕获失败不阻塞 pipeline（`try/catch` 包裹 buildEvidence，失败时 logger.warn + evidence=undefined） | 失败即 pipeline 整体失败                  | 证据是辅助功能，不应因证据 bug 导致核心切片功能不可用                                     | 部分切片可能缺证据，前端需降级展示                               |
| D3  | signalDetector 返回值从 `TimeWindow[]` 改为 `{ windows, buckets }`                                     | 新增独立函数计算 buckets                  | 避免重复遍历 danmu 数据；buckets 已在信号检测过程中计算完毕                               | 调用方和测试需全部更新 destructure                               |
| D4  | boundaryRefiner 返回值从 `HighlightSegment[]` 改为 `{ highlights, refinements }`                       | 在 boundaryRefiner 内部构建 Evidence 片段 | 保持 boundaryRefiner 职责单一（只做精修）；证据组装由 buildEvidence 统一负责              | 调用方需解构；pipeline 需新增 refinements 变量跟踪               |
| D5  | DB migration v6：`ALTER TABLE ADD COLUMN evidence TEXT`（JSON 序列化存储）                             | 独立 evidence 表 + JOIN                   | evidence 与结果 1:1 绑定，JSON 列简单直接，无需额外表维护                                 | 无法按 evidence 内部字段做 SQL 查询（JSON 查询在 SQLite 中受限） |
| D6  | 密度曲线图使用 Canvas API 自绘（零外部依赖）                                                           | Chart.js / ECharts                        | 数据量小（每个切片最多几百个数据点），Canvas 2D 上下文足以绘制柱状图+折线；避免引入新依赖 | 交互（缩放/拖拽）需自行实现，留到 v2                             |
| D7  | Evidence 类型放在 `autoClip/types.ts` 而非 `packages/types/`                                           | 放在公共 types 包                         | Evidence 是 autoclip 内部概念，不跨模块引用；避免污染公共类型包                           | 如果未来其他模块需要 Evidence 类型，需迁移                       |

---

## 2. 数据流

```
┌─────────────────────────────────────────────────────────────────┐
│                    runAutoClipPipeline()                         │
│                                                                  │
│  parseDanmu ──► detectSignals ──► rankCandidates ──► ...        │
│       │               │                │                         │
│       │     ┌─────────┴──────┐         │                         │
│       │     │ densityBuckets │         │                         │
│       │     │ triggerDanmaku │         │                         │
│       │     │ signalDetails  │         │                         │
│       │     └───────┬────────┘         │                         │
│       │             │                  │                         │
│       │     ┌───────▼──────────────────▼───────┐                 │
│       │     │  LLM scores + highlightTypes     │                 │
│       │     └───────────────┬──────────────────┘                 │
│       │                     │                                    │
│       │     ┌───────────────▼──────────────────┐                 │
│       │     │  refineBoundaries               │                 │
│       │     │  → { highlights, refinements }  │                 │
│       │     └───────────────┬──────────────────┘                 │
│       │                     │                                    │
│       │     ┌───────────────▼──────────────────┐                 │
│       │     │  buildEvidence({                 │                 │
│       │     │    densityBuckets,               │                 │
│       │     │    highlights,                   │                 │
│       │     │    refinements,                  │                 │
│       │     │    triggerDanmaku,               │                 │
│       │     │    signalDetails,                │                 │
│       │     │  })                              │                 │
│       │     └───────────────┬──────────────────┘                 │
│       │                     │                                    │
└───────┼─────────────────────┼────────────────────────────────────┘
        │                     │
        ▼                     ▼
  AutoClipResult        evidence?: Evidence
        │                     │
        └─────────┬───────────┘
                  │
                  ▼
    AutoClipService.analyzeAndSave()
         │
         ├──► upsertResult({ ..., evidence: JSON.stringify(evidence) })
         │
         ▼
    auto_clip_results 表（evidence TEXT 列）


┌──────────────────────────────────────────────────────────────────┐
│  前端                                                             │
│                                                                   │
│  GET /api/auto-clip/clips                                         │
│       │                                                           │
│       ▼                                                           │
│  parseEvidenceSafe(row.evidence) ──► clips[i].evidence            │
│       │                                                           │
│       ▼                                                           │
│  AutoClipManagement/Index.vue                                     │
│       │                                                           │
│       ├── n-data-table（切片列表 · 点击行选中）                    │
│       │                                                           │
│       └── EvidencePanel.vue（右侧面板 · 基于 selectedClip）        │
│              │                                                    │
│              ├── 密度曲线图（Canvas 柱状图+折线）                  │
│              ├── 触发弹幕列表（时间/内容/用户）                    │
│              ├── 信号检测详情（密度/阈值/来源/窗口）               │
│              ├── 边界精修对比（原始 ↔ 精修 + 原因）                │
│              ├── LLM 评分卡片（分数/类型/理由/标签）               │
│              └── 无证据降级占位（evidence === null 时）            │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. 关键接口定义

```ts
// === types.ts 新增 ===

interface BoundaryRefinement {
  originalStart: number;
  originalEnd: number;
  refinedStart: number;
  refinedEnd: number;
  reason?: string;
}

interface Evidence {
  danmakuDensityCurve: Array<{ timeOffset: number; count: number; density: number }>;
  triggerDanmaku: Array<{ timeOffset: number; text: string; user?: string }>;
  signalDetails: {
    actualDensity: number;
    threshold: number;
    sources: string[];
    mergedWindows?: Array<{ start: number; end: number }>;
  };
  boundaryRefinement: BoundaryRefinement | null;
  llmScores: Array<{
    score: number;
    highlightType: string;
    reason: string;
    tags: string[];
    isHighlight: boolean;
  }>;
}

// === evidence.ts 新增 ===

function buildEvidence(params: {
  densityBuckets: DensityBucket[];
  highlights: HighlightSegment[];
  refinements: BoundaryRefinement[];
  triggerDanmaku: Array<{ timeOffset: number; text: string; user?: string }>;
  signalDetails: Evidence["signalDetails"];
}): Evidence;

// === signalDetector.ts 变更 ===

function detectDanmakuDensityPeaks(...): { windows: TimeWindow[]; buckets: DensityBucket[] };

// === boundaryRefiner.ts 变更 ===

function refineBoundaries(...): Promise<{ highlights: HighlightSegment[]; refinements: BoundaryRefinement[] }>;
```

---

## 4. 风险

| #   | 风险                                                                                              | 影响                                           | 概率 | 缓解                                                                                      |
| --- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---- | ----------------------------------------------------------------------------------------- |
| R1  | **evidence JSON 过大**：弹幕密度数据点可能很多（时长/桶宽），导致 DB 行体积膨胀                   | 查询变慢、API 响应大                           | 中   | 密度数据点上限 ~600（10min/1s buckets）；前端只渲染可见范围；必要时压缩存储               |
| R2  | **Canvas API 渲染兼容**：Electron 内 Chromium 版本可能不支持某些 Canvas 2D 特性                   | 密度曲线图渲染异常                             | 低   | 使用基础 Canvas API（fillRect + stroke）；兼容 Chromium 120+                              |
| R3  | **WIP 分支污染**：当前 `feature/autoclip-evidence-chain` 的 WIP commit 混杂了 88 个文件的无关变更 | DEV 阶段从脏分支开始，可能漏修或引入不相关改动 | 中   | DEV 阶段第一步：`git reset HEAD~1 --soft`，选择性 `git add` 仅证据链相关文件，重新 commit |
| R4  | **API 响应大小增长**：每个 clip 增加 evidence JSON，列表接口可能返回大量数据                      | 前端加载变慢                                   | 低   | 列表接口可考虑分页或 evidence 懒加载（`GET /clips/:id/evidence`），v1 先捆绑返回          |

---

## 5. 不在范围

- 证据数据的导出功能（JSON/PDF）
- 密度曲线图的交互式缩放/拖拽
- 跨切片证据对比分析
- 按 evidence 内容查询/过滤
- 独立的 evidence 懒加载 API（`GET /clips/:id/evidence`）
- 证据压缩/归档策略

---

## 9. 架构沉淀建议

### 9.1 新增可复用抽象

| 路径                                   | 能力                                             | 触发场景                       | 复用建议                                          |
| -------------------------------------- | ------------------------------------------------ | ------------------------------ | ------------------------------------------------- |
| `autoClip/evidence.ts:buildEvidence()` | 将 pipeline 各阶段的中间数据组装为 Evidence 对象 | 新增管线阶段需要追加证据字段时 | 在 buildEvidence 中追加新字段，不改 pipeline 主体 |

### 9.2 新增项目级决策

| 决策         | 取值                   | 影响范围          | 推翻代价                       |
| ------------ | ---------------------- | ----------------- | ------------------------------ |
| 证据数据存储 | SQLite TEXT 列（JSON） | autoclip 结果存储 | 低：可随时迁移到独立表或 JSONB |
| 前端图表方案 | Canvas API 自绘        | autoclip 证据面板 | 低：可随时替换为 Chart.js 等库 |

### 9.3 新增跨模块契约

```
- auto_clip_results 表新增 evidence TEXT 列（migration v6 · 幂等 ADD COLUMN）
- GET /api/auto-clip/clips 和 GET /api/auto-clip/clips/:id 响应新增 evidence 字段（可选，null 兼容）
- refineBoundaries 返回值契约变更：{ highlights, refinements }（调用方需解构）
- detectDanmakuDensityPeaks 返回值契约变更：{ windows, buckets }（调用方需解构）
```

### 9.4 依赖变动

本 change 无新增外部依赖。

### 9.5 禁动清单变化

```
- 新增禁动：evidence 的 JSON 解析必须走 parseEvidenceSafe（容错），禁止直接 JSON.parse(evidence) 在路由中裸调
```
