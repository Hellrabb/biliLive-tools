<template>
  <div style="padding: 16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <h2 style="margin:0">自动切片管理</h2>
      <n-space>
        <n-button type="primary" @click="manualAnalyze" :loading="analyzing" :disabled="analyzing">
          {{ analyzing ? '分析中...' : '+ 手动分析' }}
        </n-button>
        <n-button @click="refreshList">刷新</n-button>
      </n-space>
    </div>

    <!-- 状态筛选 -->
    <n-radio-group v-model:value="filterStatus" name="status-filter" style="margin-bottom:16px">
      <n-radio-button value="">全部 ({{ counts.all }})</n-radio-button>
      <n-radio-button value="pending">待审核 ({{ counts.pending }})</n-radio-button>
      <n-radio-button value="exporting">导出中 ({{ counts.exporting }})</n-radio-button>
      <n-radio-button value="exported">已完成 ({{ counts.exported }})</n-radio-button>
      <n-radio-button value="uploaded">已上传 ({{ counts.uploaded }})</n-radio-button>
    </n-radio-group>

    <n-empty v-if="!loading && clips.length === 0" description="暂无切片数据" style="margin:40px 0">
      <template #extra>
        <n-button type="primary" @click="manualAnalyze" :disabled="analyzing">手动分析第一个视频</n-button>
      </template>
    </n-empty>

    <template v-if="!loading && clips.length > 0">
    <n-data-table
      :columns="columns"
      :data="clips"
      :loading="loading"
      :pagination="{
        page: currentPage,
        pageSize: pageSize,
        itemCount: totalCount,
        showSizePicker: true,
        pageSizes: [10, 20, 50],
        onUpdatePage: (p: number) => { currentPage = p; refreshList(); },
        onUpdatePageSize: (s: number) => { pageSize = s; currentPage = 1; refreshList(); },
      }"
      :row-key="(r:ClipRow) => r.id"
    />
    </template>

    <!-- 预览弹窗 -->
    <n-modal v-model:show="previewVisible" style="width:800px" title="切片详情">
      <n-card v-if="previewItem" :bordered="false">
        <n-descriptions label-placement="left" :column="2" style="margin-bottom:12px">
          <n-descriptions-item label="状态">{{ previewItem.status }}</n-descriptions-item>
          <n-descriptions-item label="切片数">{{ previewItem.highlightCount }}</n-descriptions-item>
          <n-descriptions-item label="视频">{{ previewItem.video_path }}</n-descriptions-item>
        </n-descriptions>
        <n-divider>高光片段 ({{ previewItem.highlightCount }})</n-divider>
        <n-card v-for="(h, idx) in previewItem.highlights" :key="idx" size="small" style="margin-bottom:8px">
          <n-descriptions label-placement="left" :column="2" size="small">
            <n-descriptions-item label="标题">{{ h.title || 'Untitled' }}</n-descriptions-item>
            <n-descriptions-item label="评分">{{ h.score }}</n-descriptions-item>
            <n-descriptions-item label="时间段">{{ h.bestRange?.[0] ?? '?' }}s - {{ h.bestRange?.[1] ?? '?' }}s</n-descriptions-item>
            <n-descriptions-item label="类型">{{ h.highlightType }}</n-descriptions-item>
            <n-descriptions-item label="原因" :span="2">{{ h.reason }}</n-descriptions-item>
          </n-descriptions>
          <n-space style="margin-top:4px">
            <n-tag v-for="tag in (h.tags || [])" :key="tag" size="small">{{ tag }}</n-tag>
          </n-space>
        </n-card>
      </n-card>
    </n-modal>

    <!-- 弹幕路径确认弹窗 -->
    <n-modal v-model:show="showDanmuDialog" style="width:500px" title="确认弹幕文件路径">
      <n-card :bordered="false" size="small">
        <n-form label-placement="left" :label-width="120">
          <n-form-item label="弹幕文件路径">
            <n-input v-model:value="danmuInputPath" placeholder="输入弹幕 XML 文件路径" />
          </n-form-item>
          <n-form-item label="输出名称（可选）">
            <n-input v-model:value="outputName" placeholder="自定义切片文件名前缀，留空使用默认命名" />
          </n-form-item>
        </n-form>
        <template #footer>
          <n-space justify="end">
            <n-button @click="showDanmuDialog = false">取消</n-button>
            <n-button type="primary" @click="confirmManualAnalyze">开始分析</n-button>
          </n-space>
        </template>
      </n-card>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: "AutoClipManagement" });
import { useRouter } from "vue-router";
import { NButton, NSpace, NTag, NDivider, NDataTable } from "naive-ui";
import request from "@renderer/apis/request";
import showDirectoryDialog from "@renderer/components/showDirectoryDialog";
import { useNotice } from "@renderer/hooks/useNotice";

import type { AutoClipClipRow } from "@biliLive-tools/types";

interface ClipRow extends AutoClipClipRow {
  previewTitle: string;
  previewScore: number;
  highlightCount: number;
}

const router = useRouter();
const notice = useNotice();
const loading = ref(false);
const analyzing = ref(false);
const clips = ref<ClipRow[]>([]);
const filterStatus = ref("");
const currentPage = ref(1);
const pageSize = ref(20);
const totalCount = ref(0);
const previewVisible = ref(false);
const previewItem = ref<ClipRow | null>(null);
const exportingId = ref<string | null>(null);

const counts = ref({ all: 0, pending: 0, analyzing: 0, approved: 0, exporting: 0, exported: 0, uploaded: 0 });

const columns = [
  { title: "预览标题", key: "previewTitle", width: 200, ellipsis: { tooltip: true } },
  { title: "评分", key: "previewScore", width: 60, render: (r: any) => r.previewScore?.toFixed(1) },
  { title: "片段数", key: "highlightCount", width: 70 },
  {
    title: "状态", key: "status", width: 80,
    render: (r: any) => {
      const map: Record<string, string> = { pending: "待审核", approved: "已批准", analyzing: "分析中", exporting: "导出中", exported: "已完成", uploaded: "已上传", failed: "失败" };
      return map[r.status] || r.status;
    },
  },
  {
    title: "LLM", key: "llmFallback", width: 55,
    render: (r: any) => r.llmFallback ? h(NTag, { type: "warning", size: "small" }, () => "启发") : null,
  },
  { title: "时间", key: "created_at", width: 160, render: (r: any) => r.created_at?.slice(0, 16).replace("T", " ") },
  {
    title: "操作", key: "actions", width: 300,
    render: (row: ClipRow) => {
      return h(NSpace, {}, () => [
        h(NButton, { size: "small", onClick: () => previewClip(row) }, () => "预览"),
        h(NButton, { size: "small", type: "info", onClick: () => {
          const first = row.highlights[0];
          if (!first) return;
          router.push({ path: "/videoPlayer", query: { source: row.video_path, start: String(first.bestRange?.[0] ?? 0), end: String(first.bestRange?.[1] ?? 0) } });
        } }, () => "打开视频"),
        row.status === "pending" ? h(NButton, {
          size: "small", type: "primary",
          disabled: exportingId.value !== null,
          loading: exportingId.value === row.id,
          onClick: () => approveClip(row),
        }, () => "确认导出") : null,
        h(NButton, { size: "small", type: "error", ghost: true, onClick: () => deleteClip(row) }, () => "删除"),
      ]);
    },
  },
];

async function refreshList() {
  loading.value = true;
  try {
    const offset = (currentPage.value - 1) * pageSize.value;
    const [clipsRes, countsRes] = await Promise.all([
      request.get("/auto-clip/clips", {
        params: {
          status: filterStatus.value || undefined,
          limit: pageSize.value,
          offset,
        },
      }),
      request.get("/auto-clip/clips/counts"),
    ]);

    // Update global counts
    const c = countsRes.data;
    counts.value = { all: c.all ?? 0, pending: c.pending ?? 0, analyzing: c.analyzing ?? 0, approved: c.approved ?? 0, exporting: c.exporting ?? 0, exported: c.exported ?? 0, uploaded: c.uploaded ?? 0 };

    const raw = clipsRes.data?.data ?? [];
    totalCount.value = clipsRes.data?.total ?? raw.length;
    clips.value = raw.map((r: any) => {
      const highlights = r.highlights || [];
      const first = highlights[0] ?? {};
      return {
        id: r.id,
        video_path: r.video_path,
        status: r.status,
        created_at: r.created_at,
        recorder_id: r.recorder_id,
        preset_id: r.preset_id,
        llmFallback: r.llmFallback ?? false,
        highlights,
        previewTitle: first.title || "Untitled",
        previewScore: first.score ?? 0,
        highlightCount: highlights.length,
      } as ClipRow;
    });
  } catch (e) {
    console.error("Failed to load clips:", e);
  } finally {
    loading.value = false;
  }
}

function previewClip(item: ClipRow) {
  previewItem.value = item;
  previewVisible.value = true;
}

async function approveClip(row: ClipRow) {
  if (exportingId.value) return;
  exportingId.value = row.id;
  try {
    notice.info(`正在导出 ${row.highlightCount} 个切片...`);
    const res = await request.post(`/auto-clip/clip/${row.id}/approve-and-export`);
    const exportedPaths = res.data?.exportedPaths ?? [];
    if (exportedPaths.length > 0) {
      notice.success(`导出完成，共 ${exportedPaths.length} 个文件`);
    }
    if (res.data?.failedCount > 0) {
      notice.warning(`${res.data.failedCount} 个切片导出失败`);
    }
    await refreshList();
  } catch (e: any) {
    notice.error(`操作失败: ${e?.response?.data?.error || e.message}`);
  } finally {
    exportingId.value = null;
  }
}

async function deleteClip(row: ClipRow) {
  try {
    await request.post(`/auto-clip/clip/${row.id}/delete`);
    notice.success("已删除");
    await refreshList();
  } catch (e: any) {
    notice.error(`删除失败: ${e?.response?.data?.error || e.message}`);
  }
}

// Dialog state
const showDanmuDialog = ref(false);
const danmuInputPath = ref("");
const pendingVideoPath = ref("");
const outputName = ref("");

function triggerManualAnalyze(filePath: string) {
  const guessed = filePath.replace(/\.[^.]+$/, ".xml");
  danmuInputPath.value = guessed;
  pendingVideoPath.value = filePath;
  outputName.value = "";
  showDanmuDialog.value = true;
}

async function confirmManualAnalyze() {
  showDanmuDialog.value = false;
  const videoPath = pendingVideoPath.value;
  const danmuPath = danmuInputPath.value || videoPath.replace(/\.[^.]+$/, ".xml");

  analyzing.value = true;
  notice.info("正在分析中，请稍候...");
  try {
    const res = await request.post("/auto-clip/run", {
      videoPath,
      danmuPath,
      outputName: outputName.value || undefined,
    });
    const taskId = res.data?.taskId;

    if (!taskId) {
      notice.error("启动分析失败: 未返回 taskId");
      return;
    }

    // Poll for results — max 90 attempts, 2s interval = ~3 minutes
    let consecutive404s = 0;
    for (let attempt = 0; attempt < 90; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const resultRes = await request.get(`/auto-clip/result/${taskId}`);
        consecutive404s = 0;
        if (resultRes.data) {
          if (resultRes.data.status === "analyzing") {
            continue;
          }
          if (resultRes.data.status === "failed") {
            notice.error("分析失败，请稍后重试");
            await refreshList();
            return;
          }
          if (resultRes.data.highlights?.length > 0) {
            notice.success("分析完成，请查看结果");
          } else {
            notice.info("分析完成，未检测到高光片段");
          }
          await refreshList();
          return;
        }
      } catch {
        consecutive404s++;
        // If 404 persists for 5 consecutive polls (10s), the row likely disappeared
        if (consecutive404s >= 5) {
          notice.error("分析失败：任务丢失，请重试");
          return;
        }
      }
    }
    notice.warning("分析超时，请稍后刷新查看结果");
    await refreshList();
  } catch (e: any) {
    notice.error(`分析失败: ${e?.response?.data?.error || e.message}`);
  } finally {
    analyzing.value = false;
  }
}

// Replace manualAnalyze to use trigger function instead of prompt()
async function manualAnalyze() {
  let files: string[] | undefined;

  if (window.isWeb) {
    files = await showDirectoryDialog({
      type: "file", multi: false,
      exts: ["mp4", "flv", "mkv", "webm", "avi", "mov", "ts"],
    });
  } else if (window.api?.openFile) {
    files = await window.api.openFile({ multi: false });
  } else {
    notice.error("文件选择不可用（当前环境不支持）");
    return;
  }

  if (!files || files.length === 0) return;
  triggerManualAnalyze(files[0]);
}

watch(filterStatus, () => {
  currentPage.value = 1;
  refreshList();
});

onMounted(() => {
  refreshList();
});
</script>
