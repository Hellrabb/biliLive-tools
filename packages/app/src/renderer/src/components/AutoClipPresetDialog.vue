<template>
  <n-modal v-model:show="showModal" style="width: 900px" title="预设编辑">
    <n-card :bordered="false" size="small" role="dialog" aria-modal="true">
      <div style="display: flex; gap: 12px">
        <!-- 左侧预设列表 -->
        <div class="preset-list-panel">
          <div style="font-weight: bold; margin-bottom: 8px">预设列表</div>
          <div
            v-for="p in presets"
            :key="p.id"
            :class="['preset-item', { 'preset-item--active': selectedId === p.id }]"
            @click="selectPreset(p.id)"
          >
            {{ p.name }}
          </div>
          <n-button
            dashed
            style="width: 100%; margin-top: 8px"
            @click="createPreset"
            :disabled="!defaultConfig"
          >
            + 新建预设
          </n-button>
        </div>

        <!-- 右侧编辑区 -->
        <div class="preset-editor">
          <div v-if="!editingPreset" class="preset-empty-hint">请选择或创建一个预设</div>

          <template v-else>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px">
              <n-input
                v-model:value="editingPreset.name"
                placeholder="预设名称"
                style="width: 200px"
              />
              <n-button size="small" @click="savePreset" type="primary">保存</n-button>
              <n-button
                v-if="editingPreset.id !== 'default'"
                size="small"
                @click="deletePreset"
                type="error"
                ghost
                >删除</n-button
              >
              <n-button size="small" @click="copyPreset">复制</n-button>
              <n-button size="small" @click="closeDialog">关闭</n-button>
            </div>

            <n-tabs v-model:value="activeTab" type="segment" animated>
              <!-- Tab 1: 信号检测 -->
              <n-tab-pane name="signal" tab="信号检测">
                <n-form label-placement="left" :label-width="170" size="small">
                  <n-form-item label="弹幕密度阈值">
                    <n-input-number
                      v-model:value="editingPreset.config.signal.danmakuDensityThreshold"
                      :step="0.1"
                      min="1"
                    />
                    <span style="margin-left: 4px">x 均值</span>
                  </n-form-item>
                  <n-form-item label="SC 最低金额触发">
                    <n-input-number
                      v-model:value="editingPreset.config.signal.scMinAmount"
                      :step="1"
                      min="0"
                    />
                    <span style="margin-left: 4px">元</span>
                  </n-form-item>
                  <n-form-item label="礼物爆发阈值">
                    <n-input-number
                      v-model:value="editingPreset.config.signal.giftBurstThreshold"
                      :step="1"
                      min="1"
                    />
                    <span style="margin-left: 4px">个</span>
                  </n-form-item>
                  <n-form-item label="礼物统计窗口">
                    <n-input-number
                      v-model:value="editingPreset.config.signal.giftBurstWindowSec"
                      :step="1"
                      min="5"
                    />
                    <span style="margin-left: 4px">秒</span>
                  </n-form-item>
                  <n-form-item label="候选窗口 Padding (前/后)">
                    <n-space>
                      <n-input-number
                        v-model:value="editingPreset.config.signal.windowPadding[0]"
                        :step="1"
                        min="0"
                        style="width: 80px"
                      />
                      <span>/</span>
                      <n-input-number
                        v-model:value="editingPreset.config.signal.windowPadding[1]"
                        :step="1"
                        min="0"
                        style="width: 80px"
                      />
                      <span>秒</span>
                    </n-space>
                  </n-form-item>
                  <n-form-item label="最短候选窗口">
                    <n-input-number
                      v-model:value="editingPreset.config.signal.minWindowDuration"
                      :step="1"
                      min="10"
                    />
                    <span style="margin-left: 4px">秒</span>
                  </n-form-item>
                  <n-form-item label="最长候选窗口">
                    <n-input-number
                      v-model:value="editingPreset.config.signal.maxWindowDuration"
                      :step="1"
                      min="30"
                    />
                    <span style="margin-left: 4px">秒</span>
                  </n-form-item>
                  <n-form-item label="分析桶宽">
                    <n-input-number
                      v-model:value="editingPreset.config.signal.bucketSec"
                      :step="1"
                      min="1"
                    />
                    <span style="margin-left: 4px">秒</span>
                  </n-form-item>
                  <n-form-item label="相邻合并最大间隔">
                    <n-input-number
                      v-model:value="editingPreset.config.signal.mergeGapSec"
                      :step="1"
                      min="1"
                    />
                    <span style="margin-left: 4px">秒</span>
                  </n-form-item>
                  <n-form-item label="刷屏检测相似度阈值">
                    <n-input-number
                      v-model:value="editingPreset.config.signal.brushSimilarityThreshold"
                      :step="0.05"
                      min="0"
                      max="1"
                    />
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
                    <n-select
                      v-model:value="editingPreset.config.llm.provider"
                      :options="[
                        { label: 'Qwen (阿里云百炼)', value: 'qwen' },
                        { label: '阿里云 DashScope', value: 'aliyun' },
                        { label: 'OpenAI 兼容', value: 'openai' },
                        { label: 'Ollama (本地)', value: 'ollama' },
                      ]"
                      style="width: 200px"
                    />
                  </n-form-item>
                  <n-form-item label="Model ID">
                    <n-input
                      v-model:value="editingPreset.config.llm.modelId"
                      style="width: 200px"
                    />
                  </n-form-item>
                  <n-form-item label="Max Tokens">
                    <n-input-number
                      v-model:value="editingPreset.config.llm.maxTokens"
                      :step="100"
                      min="100"
                    />
                  </n-form-item>
                  <n-form-item label="保留片段数 (Top-K)">
                    <n-input-number
                      v-model:value="editingPreset.config.llm.topK"
                      :step="1"
                      min="1"
                    />
                  </n-form-item>
                  <n-form-item label="每视频最大候选数">
                    <n-input-number
                      v-model:value="editingPreset.config.llm.maxCandidatesPerVideo"
                      :step="1"
                      min="1"
                    />
                  </n-form-item>
                  <n-form-item label="弹幕采样上限">
                    <n-input-number
                      v-model:value="editingPreset.config.llm.danmakuSampleMax"
                      :step="10"
                      min="10"
                    />
                  </n-form-item>
                  <n-form-item label="上下文窗口">
                    <n-input-number
                      v-model:value="editingPreset.config.llm.contextWindowSec"
                      :step="5"
                      :min="10"
                      :max="120"
                    />
                    <span style="margin-left: 4px">秒</span>
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
                    <n-select
                      v-model:value="editingPreset.config.export.cutFormat"
                      :options="[
                        { label: 'mp4', value: 'mp4' },
                        { label: 'flv', value: 'flv' },
                      ]"
                      style="width: 120px"
                    />
                  </n-form-item>
                  <n-form-item label="视频编码器">
                    <n-input
                      v-model:value="editingPreset.config.export.encoder"
                      style="width: 200px"
                      placeholder="libx264"
                    />
                  </n-form-item>
                  <n-form-item label="音频编码器">
                    <n-input
                      v-model:value="editingPreset.config.export.audioCodec"
                      style="width: 200px"
                      placeholder="copy"
                    />
                  </n-form-item>
                  <n-form-item label="FFmpeg 预设">
                    <n-input
                      v-model:value="editingPreset.config.export.ffmpegPresetId"
                      style="width: 200px"
                    />
                  </n-form-item>
                  <n-form-item label="压制弹幕到视频">
                    <n-switch v-model:value="editingPreset.config.export.burnDanmaku" />
                  </n-form-item>
                  <n-form-item v-if="editingPreset.config.export.burnDanmaku" label="弹幕预设">
                    <n-select
                      v-model:value="editingPreset.config.export.danmuPresetId"
                      :options="danmuPresetOptions"
                      style="width: 200px"
                      clearable
                      placeholder="选择弹幕压制预设"
                    />
                  </n-form-item>
                  <n-form-item label="上传到B站">
                    <n-switch v-model:value="editingPreset.config.export.uploadToBili" />
                  </n-form-item>
                  <n-form-item
                    label="保存路径"
                    :rule="{
                      trigger: ['blur'],
                      validator: validateSavePath,
                    }"
                  >
                    <n-input
                      v-model:value="editingPreset.config.export.savePath"
                      placeholder="留空使用录制保存路径"
                    />
                    <template #feedback>
                      <span style="font-size: 12px; color: #999">留空则使用录制视频所在目录</span>
                    </template>
                  </n-form-item>
                  <n-form-item label="文件命名模板">
                    <n-input v-model:value="editingPreset.config.export.namingTemplate" />
                  </n-form-item>
                </n-form>
              </n-tab-pane>

              <!-- Tab 4: 弹幕过滤 -->
              <n-tab-pane name="filter" tab="弹幕过滤">
                <n-form label-placement="left" :label-width="170" size="small">
                  <n-form-item label="启用弹幕过滤">
                    <n-switch v-model:value="editingPreset.config.danmakuFilter.enabled" />
                  </n-form-item>
                  <n-form-item label="自动检测垃圾弹幕">
                    <n-switch
                      v-model:value="editingPreset.config.danmakuFilter.autoDetectEnabled"
                    />
                  </n-form-item>
                  <n-divider
                    >过滤规则 ({{
                      editingPreset.config.danmakuFilter.rules?.length ?? 0
                    }})</n-divider
                  >
                  <n-data-table
                    v-if="(editingPreset.config.danmakuFilter.rules?.length ?? 0) > 0"
                    :columns="filterRuleColumns"
                    :data="editingPreset.config.danmakuFilter.rules"
                    size="small"
                    :max-height="300"
                  />
                  <n-empty v-else description="暂无过滤规则" size="small" />
                </n-form>
              </n-tab-pane>

              <!-- Tab 5: 增强 (Phase 1.5) -->
              <n-tab-pane name="enhancement" tab="增强">
                <n-form label-placement="left" :label-width="170" size="small">
                  <n-form-item label="启用 ASR 语音识别">
                    <n-switch v-model:value="editingPreset.config.enhancement.asrEnabled" />
                  </n-form-item>
                  <n-form-item label="启用视觉理解">
                    <n-switch v-model:value="editingPreset.config.enhancement.visualEnabled" />
                  </n-form-item>
                  <n-form-item label="启用边界智能精修">
                    <n-switch
                      v-model:value="editingPreset.config.enhancement.boundaryRefineEnabled"
                    />
                    <template #feedback>
                      <span style="font-size: 12px; color: #999"
                        >分析语音和画面，自动优化切片起止位置，避免剧情不完整</span
                      >
                      <span
                        v-if="
                          editingPreset.config.enhancement.boundaryRefineEnabled &&
                          !editingPreset.config.enhancement.asrEnabled &&
                          !editingPreset.config.enhancement.visualEnabled
                        "
                        style="font-size: 12px; color: #f0a020; display: block; margin-top: 4px"
                      >
                        ⚠ 边界精修需要开启「ASR 语音识别」或「视觉理解」中的至少一项，否则不会生效
                      </span>
                    </template>
                  </n-form-item>
                  <n-form-item
                    v-if="editingPreset.config.enhancement.boundaryRefineEnabled"
                    label="边界精修模型 ID"
                  >
                    <n-input
                      v-model:value="editingPreset.config.llm.boundaryRefineModelId"
                      placeholder="留空使用 LLM 模型"
                      style="width: 250px"
                    />
                    <template #feedback>
                      <span style="font-size: 12px; color: #999"
                        >留空则使用 LLM 模型；填写则以独立模型执行边界精修</span
                      >
                    </template>
                  </n-form-item>
                  <n-form-item
                    v-if="editingPreset.config.enhancement.visualEnabled"
                    label="视觉模型 ID"
                  >
                    <n-input
                      v-model:value="editingPreset.config.llm.visionModelId"
                      placeholder="如 qwen-vl-plus"
                      style="width: 250px"
                    />
                  </n-form-item>
                  <n-form-item
                    v-if="editingPreset.config.enhancement.asrEnabled"
                    label="ASR 模型 ID"
                  >
                    <n-input
                      v-model:value="editingPreset.config.llm.asrModelId"
                      placeholder="留空使用 LLM 模型"
                      style="width: 250px"
                    />
                  </n-form-item>
                </n-form>
              </n-tab-pane>

              <!-- Tab 6: 标题风格 (Phase 2) -->
              <n-tab-pane name="titleStyle" tab="标题风格">
                <n-form label-placement="left" :label-width="170" size="small">
                  <n-form-item
                    v-if="editingPreset.config.llm.titleStyleConfig"
                    label="标题最小长度"
                  >
                    <n-input-number
                      v-model:value="editingPreset.config.llm.titleStyleConfig.minLength"
                      :step="1"
                      :min="8"
                      :max="50"
                    />
                    <span style="margin-left: 4px">字</span>
                  </n-form-item>
                  <n-form-item
                    v-if="editingPreset.config.llm.titleStyleConfig"
                    label="标题最大长度"
                  >
                    <n-input-number
                      v-model:value="editingPreset.config.llm.titleStyleConfig.maxLength"
                      :step="1"
                      :min="10"
                      :max="60"
                    />
                    <span style="margin-left: 4px">字</span>
                  </n-form-item>
                  <n-form-item label="自定义标题 Prompt">
                    <n-input
                      v-model:value="editingPreset.config.llm.titleStylePrompt"
                      type="textarea"
                      :autosize="{ minRows: 4, maxRows: 10 }"
                      placeholder="自定义标题风格 prompt，留空使用内置模板"
                    />
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
import { NSpace, NButton } from "naive-ui";
import { autoClipPresetApi, danmuPresetApi } from "@renderer/apis/presets";
import { useConfirm } from "@renderer/hooks";
import { useNotice } from "@renderer/hooks/useNotice";
import { cloneDeep } from "lodash-es";
import { v4 as uuidv4 } from "uuid";

const visible = defineModel<boolean>("visible", { default: false });
const emit = defineEmits<{ (e: "updated"): void }>();

const showModal = computed({
  get: () => visible.value,
  set: (v) => {
    visible.value = v;
  },
});

const presets = ref<AutoClipPresetType[]>([]);
const selectedId = ref<string>("");
const editingPreset = ref<AutoClipPresetType | null>(null);
const activeTab = ref("signal");

const filterRuleColumns = [
  {
    title: "模式",
    key: "mode",
    width: 70,
    render: (r: any) =>
      (({ exact: "精确", contains: "包含", regex: "正则" }) as Record<string, string>)[r.mode] ??
      r.mode,
  },
  { title: "规则", key: "pattern", ellipsis: { tooltip: true } },
  {
    title: "来源",
    key: "source",
    width: 60,
    render: (r: any) => (r.source === "auto" ? "自动" : "手动"),
  },
  {
    title: "操作",
    key: "actions",
    width: 120,
    render: (row: any) => {
      return h(NSpace, {}, () => [
        h(
          NButton,
          {
            size: "tiny",
            type: row.enabled ? "success" : "default",
            ghost: true,
            onClick: () => {
              const rules = editingPreset.value!.config.danmakuFilter.rules;
              if (rules) {
                const idx = rules.findIndex((r: any) => r.id === row.id);
                if (idx !== -1) rules[idx]!.enabled = !rules[idx]!.enabled;
              }
            },
          },
          () => (row.enabled ? "启用" : "禁用"),
        ),
        h(
          NButton,
          {
            size: "tiny",
            type: "error",
            ghost: true,
            onClick: () => {
              const rules = editingPreset.value!.config.danmakuFilter.rules;
              if (rules) {
                const idx = rules.findIndex((r: any) => r.id === row.id);
                if (idx !== -1) rules.splice(idx, 1);
              }
            },
          },
          () => "删除",
        ),
      ]);
    },
  },
];

const confirm = useConfirm();
const notice = useNotice();

const danmuPresetOptions = ref<{ label: string; value: string }[]>([]);
const initialSnapshot = ref<string>("");

const defaultConfig = ref<AutoClipConfig | null>(null);

async function fetchDefaultConfig() {
  try {
    defaultConfig.value = await autoClipPresetApi.getDefaultConfig();
  } catch {
    notice.warning("无法加载默认配置，请检查后端服务");
    defaultConfig.value = null;
  }
}

async function loadPresets() {
  try {
    presets.value = await autoClipPresetApi.list();
    if (presets.value.length > 0 && !selectedId.value) {
      selectPreset(presets.value[0].id);
    }
  } catch {
    /* preset file doesn't exist yet */
  }
}

async function loadDanmuPresets() {
  try {
    const res = await danmuPresetApi.list();
    danmuPresetOptions.value = (res || []).map((p: any) => ({
      label: p.name || p.id,
      value: p.id,
    }));
  } catch {
    /* non-critical, presets may not be configured */
  }
}

async function selectPreset(id: string) {
  // Guard against unsaved changes — same logic as closeDialog
  if (editingPreset.value && JSON.stringify(editingPreset.value) !== initialSnapshot.value) {
    const [ok] = await confirm.warning({
      title: "未保存的修改",
      content: "切换预设将丢失当前修改，是否继续？",
      positiveText: "放弃修改并切换",
      negativeText: "继续编辑",
    });
    if (!ok) return;
  }

  selectedId.value = id;
  const p = presets.value.find((x) => x.id === id);
  if (p) {
    editingPreset.value = cloneDeep(p);
    // Ensure titleStyleConfig exists for older presets that lack it
    if (!editingPreset.value.config.llm.titleStyleConfig) {
      editingPreset.value.config.llm.titleStyleConfig = { maxLength: 30, minLength: 20 };
    }
    initialSnapshot.value = JSON.stringify(editingPreset.value);
  }
}

function createPreset() {
  if (!defaultConfig.value) return;
  const newPreset: AutoClipPresetType = {
    id: uuidv4(),
    name: "新建预设",
    config: cloneDeep(defaultConfig.value),
  };
  presets.value.push(newPreset);
  selectedId.value = newPreset.id;
  editingPreset.value = cloneDeep(newPreset);
  initialSnapshot.value = JSON.stringify(editingPreset.value);
}

async function savePreset() {
  if (!editingPreset.value) return;
  // Frontend validation
  if (!editingPreset.value.name || !editingPreset.value.name.trim()) {
    notice.error("预设名称不能为空");
    return;
  }
  if (editingPreset.value.config.llm.enabled) {
    if (!editingPreset.value.config.llm.modelId) {
      notice.error("LLM 已启用但未填写 Model ID");
      return;
    }
    if (editingPreset.value.config.llm.topK < 1) {
      notice.error("Top-K 不能小于 1");
      return;
    }
  }
  if (editingPreset.value.config.signal.minWindowDuration < 10) {
    notice.error("最短候选窗口不能小于 10 秒");
    return;
  }
  await autoClipPresetApi.save(editingPreset.value);
  // After save, update snapshot to reflect saved state
  initialSnapshot.value = JSON.stringify(editingPreset.value);
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
  initialSnapshot.value = JSON.stringify(editingPreset.value);
}

async function closeDialog() {
  if (editingPreset.value && JSON.stringify(editingPreset.value) !== initialSnapshot.value) {
    const [ok] = await confirm.warning({
      title: "未保存的修改",
      content: "确定关闭？修改将丢失。",
      positiveText: "确定关闭",
      negativeText: "继续编辑",
    });
    if (!ok) return;
  }
  visible.value = false;
}

function validateSavePath(_rule: unknown, value: string): boolean | Error {
  if (!value || value.trim() === "") return true;
  if (/\.\./.test(value)) return new Error("路径不能包含 ..");
  return true;
}

watch(visible, async (v) => {
  if (v) {
    await fetchDefaultConfig();
    await loadPresets();
    await loadDanmuPresets();
  }
});
</script>

<style scoped>
.preset-list-panel {
  width: 180px;
  flex-shrink: 0;
}
.preset-item {
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 3px;
  margin-bottom: 4px;
}
.preset-item--active {
  background: #e8f5e9;
  font-weight: bold;
}
.preset-editor {
  flex: 1;
  min-width: 0;
}
.preset-empty-hint {
  text-align: center;
  padding: 40px;
  color: #999;
}
</style>
