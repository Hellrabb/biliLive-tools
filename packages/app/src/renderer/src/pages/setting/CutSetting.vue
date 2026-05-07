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
  try {
    const presets = await autoClipPresetApi.list();
    presetOptions.value = presets.map((p: any) => ({ label: p.name, value: p.id }));
  } catch { /* ignore */ }
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
