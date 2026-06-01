<template>
  <div class="evidence-panel">
    <!-- 无选中 -->
    <n-empty v-if="!clip" description="请选择一个切片查看证据" />

    <!-- 无证据 -->
    <n-empty v-else-if="!evidence" description="暂无决策证据" style="margin-top: 24px">
      <template #extra>
        <n-text depth="3">该切片在旧版本中分析，未保存证据链数据</n-text>
      </template>
    </n-empty>

    <!-- 证据面板 -->
    <div v-else class="evidence-content">
      <!-- 密度曲线图 -->
      <n-card size="small" title="弹幕密度曲线" :bordered="true">
        <canvas ref="chartCanvas" class="density-chart" width="600" height="200" />
        <n-text v-if="!hasDensityData" depth="3">弹幕数据不足，无法绘制密度曲线</n-text>
      </n-card>

      <!-- 信号检测详情 -->
      <n-card size="small" title="信号检测" :bordered="true">
        <n-descriptions label-placement="left" :column="2" size="small">
          <n-descriptions-item label="实际最大密度">
            {{ evidence.signalDetails.actualDensity }}
          </n-descriptions-item>
          <n-descriptions-item label="阈值">
            {{ evidence.signalDetails.threshold || "（未设置）" }}
          </n-descriptions-item>
          <n-descriptions-item label="信号来源" :span="2">
            <n-space>
              <n-tag
                v-for="src in evidence.signalDetails.sources"
                :key="src"
                size="small"
                type="info"
              >
                {{ src }}
              </n-tag>
            </n-space>
          </n-descriptions-item>
          <n-descriptions-item
            v-if="evidence.signalDetails.mergedWindows?.length"
            label="合并窗口数"
          >
            {{ evidence.signalDetails.mergedWindows.length }}
          </n-descriptions-item>
        </n-descriptions>
      </n-card>

      <!-- 边界精修对比 -->
      <n-card size="small" title="边界精修" :bordered="true">
        <n-empty
          v-if="!evidence.boundaryRefinements?.length"
          description="未进行边界精修"
          size="small"
        />
        <n-card
          v-for="(ref, idx) in evidence.boundaryRefinements"
          :key="idx"
          size="small"
          class="refinement-card"
        >
          <div class="refinement-row">
            <span class="original-range">
              {{ fmtTime(ref.originalStart) }} – {{ fmtTime(ref.originalEnd) }}
            </span>
            <span class="arrow">→</span>
            <span class="refined-range">
              {{ fmtTime(ref.refinedStart) }} – {{ fmtTime(ref.refinedEnd) }}
            </span>
          </div>
          <n-text v-if="ref.reason" depth="3" class="refinement-reason">
            {{ ref.reason }}
          </n-text>
        </n-card>
      </n-card>

      <!-- LLM 评分 -->
      <n-card size="small" title="LLM 评分详情" :bordered="true">
        <n-empty v-if="!evidence.llmScores?.length" description="无 LLM 评分数据" size="small" />
        <n-card v-for="(sc, idx) in evidence.llmScores" :key="idx" size="small" class="score-card">
          <div class="score-header">
            <n-tag :type="sc.isHighlight ? 'success' : 'default'" size="small">
              {{ sc.isHighlight ? "高光" : "非高光" }}
            </n-tag>
            <n-tag type="info" size="small"> {{ sc.score?.toFixed(1) }} 分 </n-tag>
            <n-tag v-if="sc.highlightType" type="warning" size="small">
              {{ sc.highlightType }}
            </n-tag>
          </div>
          <n-text v-if="sc.reason" depth="2" class="score-reason">
            {{ sc.reason }}
          </n-text>
          <n-space v-if="sc.tags?.length" class="score-tags">
            <n-tag v-for="t in sc.tags" :key="t" size="tiny" :bordered="true">
              {{ t }}
            </n-tag>
          </n-space>
        </n-card>
      </n-card>

      <!-- 触发弹幕列表 -->
      <n-card size="small" title="触发弹幕样本" :bordered="true">
        <n-empty
          v-if="!evidence.triggerDanmaku?.length"
          description="无触发弹幕数据"
          size="small"
        />
        <div v-else class="danmaku-list">
          <div
            v-for="(dm, idx) in evidence.triggerDanmaku.slice(0, 50)"
            :key="idx"
            class="danmaku-item"
          >
            <n-text depth="3" class="danmaku-time">{{ fmtTime(dm.timeOffset) }}</n-text>
            <n-text v-if="dm.user" depth="3" class="danmaku-user">{{ dm.user }}</n-text>
            <n-text class="danmaku-text">{{ dm.text }}</n-text>
          </div>
          <n-text v-if="evidence.triggerDanmaku.length > 50" depth="3">
            ... 还有 {{ evidence.triggerDanmaku.length - 50 }} 条弹幕
          </n-text>
        </div>
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch, nextTick } from "vue";
import { NEmpty, NText, NCard, NDescriptions, NDescriptionsItem, NTag, NSpace } from "naive-ui";

interface DanmakuItem {
  timeOffset: number;
  text: string;
  user?: string;
}

interface DensityPoint {
  timeOffset: number;
  count: number;
  density: number;
}

interface EvidenceData {
  danmakuDensityCurve: DensityPoint[];
  triggerDanmaku: DanmakuItem[];
  signalDetails: {
    actualDensity: number;
    threshold?: number;
    sources: string[];
    mergedWindows?: Array<{ start: number; end: number }>;
  };
  boundaryRefinements: Array<{
    originalStart: number;
    originalEnd: number;
    refinedStart: number;
    refinedEnd: number;
    reason?: string;
  }>;
  llmScores: Array<{
    score: number;
    highlightType: string;
    reason: string;
    tags: string[];
    isHighlight: boolean;
  }>;
}

const props = defineProps<{
  clip: { evidence?: EvidenceData | null } | null;
}>();

const chartCanvas = ref<HTMLCanvasElement | null>(null);

const evidence = computed(() => props.clip?.evidence ?? null);

const hasDensityData = computed(() => {
  const curve = evidence.value?.danmakuDensityCurve;
  return curve && curve.length > 0;
});

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function drawChart(): void {
  const canvas = chartCanvas.value;
  if (!canvas) return;

  const curve = evidence.value?.danmakuDensityCurve;

  if (!curve || curve.length === 0) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 200 * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = 200;
  const pad = { top: 16, right: 16, bottom: 28, left: 48 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  // 读取 CSS 变量颜色
  const style = getComputedStyle(canvas);
  const barColor = style.getPropertyValue("--color-primary").trim() || "#18a058";
  const lineColor = style.getPropertyValue("--color-warning").trim() || "#d48806";
  const gridColor = style.getPropertyValue("--border-primary").trim() || "#eeeeee";
  const textColor = style.getPropertyValue("--text-muted").trim() || "#666666";

  ctx.clearRect(0, 0, w, h);

  const maxDensity = Math.max(...curve.map((b) => b.density), 0.1);
  const barWidth = Math.max(1, cw / curve.length - 1);

  // 网格线
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ch / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
  }

  // 柱状图
  for (let i = 0; i < curve.length; i++) {
    const x = pad.left + (cw / curve.length) * i;
    const barH = (curve[i]!.density / maxDensity) * ch;
    ctx.fillStyle = barColor;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(x, pad.top + ch - barH, barWidth, barH);
  }
  ctx.globalAlpha = 1;

  // 密度折线
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < curve.length; i++) {
    const x = pad.left + (cw / curve.length) * i + barWidth / 2;
    const y = pad.top + ch - (curve[i]!.density / maxDensity) * ch;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Y 轴标签
  ctx.fillStyle = textColor;
  ctx.font = "10px system-ui";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const val = (maxDensity / 4) * (4 - i);
    const y = pad.top + (ch / 4) * i + 3;
    ctx.fillText(val.toFixed(1), pad.left - 6, y);
  }

  // X 轴标签
  ctx.textAlign = "center";
  const xSteps = Math.min(5, curve.length);
  for (let i = 0; i <= xSteps; i++) {
    const idx = Math.floor((curve.length / xSteps) * i);
    if (idx >= curve.length) continue;
    const x = pad.left + (cw / curve.length) * idx + barWidth / 2;
    ctx.fillText(fmtTime(curve[idx]!.timeOffset), x, h - 6);
  }
}

onMounted(() => {
  nextTick(() => drawChart());
});

watch(
  () => props.clip?.evidence,
  () => {
    nextTick(() => drawChart());
  },
);
</script>

<style scoped>
.evidence-panel {
  padding: 4px 0;
}

.evidence-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.density-chart {
  width: 100%;
  height: 200px;
  border-radius: 4px;
  background: var(--bg-secondary, #f9fafb);
}

.refinement-card {
  margin-bottom: 8px;
}

.refinement-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.original-range {
  color: var(--text-muted, #999);
  text-decoration: line-through;
}

.arrow {
  color: var(--color-primary, #18a058);
  font-weight: bold;
}

.refined-range {
  color: var(--color-primary, #18a058);
  font-weight: bold;
}

.refinement-reason {
  display: block;
  margin-top: 4px;
  font-size: 12px;
}

.score-card {
  margin-bottom: 8px;
}

.score-header {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.score-reason {
  display: block;
  font-size: 13px;
  line-height: 1.5;
}

.score-tags {
  margin-top: 6px;
}

.danmaku-list {
  max-height: 300px;
  overflow-y: auto;
}

.danmaku-item {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid var(--border-primary, #eee);
  font-size: 13px;
}

.danmaku-time {
  flex-shrink: 0;
  width: 48px;
  font-variant-numeric: tabular-nums;
}

.danmaku-user {
  flex-shrink: 0;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.danmaku-text {
  flex: 1;
  word-break: break-all;
}

@media (max-width: 900px) {
  .density-chart {
    height: 140px;
  }
}
</style>
