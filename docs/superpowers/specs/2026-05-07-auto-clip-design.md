# LLM驱动的自动切片 (AutoClip) — 设计文档

## 概述

利用直播录制产生的视频和弹幕数据，通过 **弹幕信号粗筛 → LLM精排 → 可选多模态增强 → 自动切片导出** 的分层流水线，实现全自动无人值守的视频高光集锦生成。

## 核心决策

| 决策点 | 结论 |
|--------|------|
| 产出形态 | 高光集锦片段（多个独立切片），非完整章节分段 |
| 自动化程度 | 全自动无人值守：录制完成 → 切片 → 上传，无人工介入 |
| 数据源 | 弹幕为主（默认），ASR/视觉多模态为可选升级模块 |
| Layer 1 语义 | 不做情感分类，只做统计异常检测；语义理解完全交给 Layer 2 LLM |

## 架构

```
录制完成回调
    │
    ▼
┌──────────────────────────────────────────────────┐
│ Layer 1: 信号粗筛 (本地, 零成本)                    │
│                                                  │
│ 信号A: 弹幕密度峰值 (μ + 2.5σ 阈值, 10s桶)          │
│ 信号B: SC爆发点 (30s窗口滚动累加金额)                │
│ 信号C: 礼物潮 (30s窗口计数)                         │
│ 信号D: 行为突变检测 (无语义, 纯统计)                  │
│   - 弹幕速率一阶/二阶导数异常                         │
│   - 内容相似度风暴 (编辑距离聚类, 刷屏检测)             │
│   - 互动结构突变 (SC金额分布 / @行为跃变)             │
│                                                  │
│ 产出: N个候选时间窗口, 去重合并                        │
└──────────────────────┬───────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│ Layer 2: LLM 精排 (QwenLLM / Ollama)              │
│                                                  │
│ 每个候选窗口 → 弹幕采样 + SC摘要 + 前后文 → LLM        │
│ LLM 返回: isHighlight, score(0-10), title,        │
│           tags, highlightType, reason,            │
│           bestClipStart/End                       │
│                                                  │
│ 批处理: <5并行, 5-15并行, >15统计预截断              │
│ 产出: Top-K 个带标题/标签/评分的高光片段               │
└──────────────────────┬───────────────────────────┘
                       │
              ┌────────┴────────┐
              │  (可选, 预设开启)  │
              ▼                 ▼
┌─────────────────┐  ┌──────────────────┐
│ Layer 3a: ASR   │  │ Layer 3b: 视觉    │
│ 语音转文字增强    │  │ 关键帧多模态理解   │
│ (复用现有ASR pipeline) │                  │
└────────┬────────┘  └────────┬─────────┘
         └──────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│ Layer 4: 切片导出                                  │
│                                                  │
│ 调用现有 cut() pipeline → ffmpeg 切片              │
│ 可选: 压制弹幕、上传B站、同步网盘                     │
│ 复用现有 DanmuPreset / VideoPreset / FFmpegPreset  │
└──────────────────────────────────────────────────┘
```

## 数据模型

### AutoClipPreset

新增预设类型，与现有 `DanmuPreset` / `VideoPreset` / `FFmpegPreset` 并列。

```typescript
// packages/types/src/preset.ts

interface AutoClipConfig {
  // Layer 1 信号粗筛
  signal: {
    danmakuDensityThreshold: number;   // 弹幕密度超标倍数 (相对均值), 默认 2.5
    scMinAmount: number;               // SC最低金额触发, 默认 30
    giftBurstThreshold: number;        // N秒内礼物数, 默认 10
    giftBurstWindowSec: number;        // 礼物统计窗口秒数, 默认 30
    windowPadding: [number, number];   // 候选窗口前后padding秒数, 默认 [30, 30]
    minWindowDuration: number;         // 最短候选窗口秒数, 默认 60
    maxWindowDuration: number;         // 最长候选窗口秒数, 默认 300
    bucketSec: number;                 // 信号分析桶宽秒数, 默认 10
    mergeGapSec: number;              // 相邻热点合并的最大间隔秒数, 默认 30
    brushSimilarityThreshold: number; // 刷屏检测相似度阈值, 默认 0.8
  };

  // Layer 2 LLM 精排
  llm: {
    enabled: boolean;
    provider: "qwen" | "ollama";
    modelId: string;
    maxTokens: number;                // 默认 1000
    topK: number;                     // 最终保留片段数, 默认 5
    maxCandidatesPerVideo: number;    // 送入LLM的最大候选数, 默认 15
    danmakuSampleMax: number;         // 每个候选窗口弹幕采样上限, 默认 200
    promptTemplate?: string;          // 自定义 prompt 模板
  };

  // Layer 3 可选增强
  enhancement: {
    asrEnabled: boolean;
    visualEnabled: boolean;           // 多模态关键帧 (保留扩展点, 首版不实现)
  };

  // Layer 4 导出
  export: {
    cutFormat: "mp4" | "flv";         // 默认 mp4
    ffmpegPresetId: string;           // 引用已有 FFmpegPreset
    burnDanmaku: boolean;             // 是否压制弹幕
    uploadToBili: boolean;
    savePath: string;
    namingTemplate: string;           // 默认 "{{title}}_{{index}}_{{highlight_name}}"
  };
}
```

### AutoClipResult

```typescript
interface AutoClipResult {
  id: string;
  videoPath: string;
  danmuPath: string;
  highlights: HighlightSegment[];
  skipped?: boolean;
  skippedReason?: string;
}

interface HighlightSegment {
  timeRange: [number, number];    // 秒
  bestRange: [number, number];    // LLM推荐的最佳区间
  score: number;                  // 0-10
  title: string;
  tags: string[];
  highlightType: "funny" | "impressive" | "touching" | "hype" | "troll";
  reason: string;
  signalSources: string[];        // 触发该片段被选中的信号源
}
```

## Layer 1 信号粗筛算法详解

### 信号 A: 弹幕密度峰值

1. 将时间轴切为等宽桶（桶宽 `bucketSec` 秒）
2. 计算全场桶内弹幕数均值 μ 和标准差 σ
3. 标记 > μ + (threshold × σ) 的桶为热点桶
4. 合并相邻热点桶（gap < `mergeGapSec` 则合并）
5. 按 `windowPadding` 扩展边界

### 信号 B: SC 爆发点

1. 扫描 SC 列表，按 `giftBurstWindowSec` 窗口滚动累加金额
2. 窗口内总额 >= `scMinAmount` 则标记
3. 以 SC 爆发窗口中心 ± padding 生成候选

### 信号 C: 礼物潮

1. 礼物时间线按 `giftBurstWindowSec` 窗口计数
2. 窗口内礼物数 >= `giftBurstThreshold` 则标记
3. 同信号 B 逻辑生成候选

### 信号 D: 行为突变检测（零语义，纯统计）

**不做情感分类。语义理解完全交给 Layer 2。**

1. **弹幕速率一阶/二阶导数异常**
   - 计算 10s 桶弹幕数的 Δ（一阶差）和 ΔΔ（二阶差）
   - Δ > 3σ 的桶 → 标记为"突然热闹"
   - ΔΔ > 3σ 的桶 → 标记为"爆发式热闹"（比渐热更可能是高光）

2. **内容相似度风暴**
   - 滑动窗口内，用编辑距离/最长公共子串聚类
   - 短时间内出现大量高相似度（>= `brushSimilarityThreshold`）弹幕 → "观众刷屏同一件事"
   - 这是最强的高光信号，比密度峰值更精准

3. **互动结构突变**
   - SC 金额分布突变（平时 1 元 SC → 突然连续高额 SC）
   - 用户 @ 行为集中度突变

### 去重与合并

四路信号产出的候选窗口取并集 → 按时间重叠合并 → 按 `minWindowDuration` / `maxWindowDuration` 裁剪 → 按优先级排序输出。

## Layer 2 LLM 精排

### LLM Prompt 模板

```
你是一个直播录像切片助手。以下是一段直播弹幕数据，请根据弹幕判断该时段是否值得切片。

弹幕统计: 共{count}条, 密度{density}条/秒, SC金额{scTotal}元,
         独立观众{uniqueUsers}人, 刷屏{brush}次

弹幕内容 (按时间排列):
[00:00] 来了来了
[00:02] 主播今天这个操作太极限了！！
...

SC 记录:
  {user} ￥{amount}: {message}
  ...

请返回 JSON（只返回 JSON，不要其他内容）:
{
  "isHighlight": true/false,
  "score": 0-10,
  "title": "切片标题(15字以内)",
  "tags": ["标签1", "标签2"],
  "highlightType": "funny/impressive/touching/hype/troll/not_highlight",
  "reason": "简短判断理由(20字以内)",
  "bestClipStart": 窗口内最佳起点秒数,
  "bestClipEnd": 窗口内最佳终点秒数
}
```

### 批处理策略

| 候选数 | 策略 |
|--------|------|
| < 5 | 串行调用, 全量精排 |
| 5-15 | 并行调用, 按 score 排序取 topK |
| > 15 | 统计预排名（刷屏次数 + SC金额 + 密度峰值）, 截断到 15 再并行 LLM 精排 |

### 费用估算

- 每个候选窗口 ~1000 tokens/次（prompt + completion）
- Qwen-Turbo: ¥0.3/百万输入 + ¥0.6/百万输出 ≈ 极低成本
- 一场 4 小时直播 ~10 个候选 → ~10000 tokens → < ¥0.01

## 编排与集成

### 触发时机

录制 task 完成事件 → 检查该直播间是否绑定了 `AutoClipPreset` → 自动触发 pipeline。

### 编排器

新增 `packages/shared/src/autoClip/pipeline.ts`:

```typescript
export async function runAutoClipPipeline(params: {
  videoPath: string;
  danmuPath: string;
  preset: AutoClipConfig;
  onProgress: (stage: string, pct: number, message: string) => void;
}): Promise<AutoClipResult>
```

### HTTP 路由

```
POST /auto-clip/run              — 手动触发
GET  /auto-clip/result/:id       — 查询结果
GET  /sse/autoClip/:id           — SSE 进度推送
```

### Docker 兼容性

- `autoClip` 模块在 `packages/shared` 中实现，不依赖 Electron
- CLI 暴露 `bililive-cli auto-clip` 命令用于调试
- HTTP server 层完成录制→切片→上传的完整链路

## 新增文件清单

```
packages/shared/src/autoClip/
├── pipeline.ts          # 编排器, 串联全流程
├── signalDetector.ts    # Layer 1: 四路信号检测 + 去重合并
├── llmRanker.ts         # Layer 2: LLM精排与命名
├── types.ts             # HighlightSegment, ClipCandidate 等类型

packages/types/src/
└── preset.ts            # 新增 AutoClipConfig 类型

packages/shared/src/presets/
└── autoClipPreset.ts    # AutoClipPreset 类 (继承 BasePreset 模式)

packages/http/src/routes/
└── autoClip.ts          # POST /auto-clip/run, GET /auto-clip/result/:id
```

## 复用现有模块

| 功能 | 复用模块 |
|------|---------|
| 弹幕解析 | `packages/shared/src/danmu/index.ts` `parseDanmu()` |
| 弹幕密度/热度 | `packages/shared/src/danmu/hotProgress.ts` `generateDanmakuData()` |
| LLM 调用 | `packages/shared/src/ai/llm/qwen.ts` `QwenLLM` / `packages/shared/src/llm/ollama.ts` |
| ASR | `packages/shared/src/ai/asr/adapter.ts` `recognize()` |
| 视频切片 | `packages/shared/src/task/video.ts` `cut()` `burn()` |
| 上传 B站 | `packages/shared/src/task/bili.ts` 现有上传任务 |
| 预设系统 | `packages/shared/src/presets/index.ts` |
| 进度推送 | `packages/http/src/routes/sse.ts` SSE 基础设施 |
| 录制回调 | `packages/shared/src/recorder/index.ts` `recorderManager` |

## 不实现（当前范围外）

- **实时切片**: 首版仅支持录制完成后的离线分析，不支持直播中实时高光检测
- **全自动多模态视觉理解**: 保留扩展点，首版不实现
- **跨平台内容理解差异**: 首版统一处理，不考虑 B站/抖音/斗鱼的弹幕文化差异
- **LLM 微调/Fine-tune**: 首版使用通用模型 + prompt 工程，不训练专用模型
