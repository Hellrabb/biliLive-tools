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
      <n-radio-button value="exported">已完成 ({{ counts.exported }})</n-radio-button>
      <n-radio-button value="uploaded">已上传 ({{ counts.uploaded }})</n-radio-button>
    </n-radio-group>

    <n-alert v-if="hasLlmFallback" type="warning" style="margin-bottom:12px" closable>
      AI 精排服务不可用，以下评分为启发式算法估算。请检查系统设置中的 AI 配置是否正确。
    </n-alert>

    <n-empty v-if="!loading && filteredData.length === 0" description="暂无切片数据" style="margin:40px 0">
      <template #extra>
        <n-button type="primary" @click="manualAnalyze" :disabled="analyzing">手动分析第一个视频</n-button>
      </template>
    </n-empty>

    <template v-if="!loading && filteredData.length > 0">
    <n-data-table
      :columns="columns"
      :data="filteredData"
      :loading="loading"
      :pagination="{ pageSize: 20 }"
      :row-key="(r:any) => r.id"
    />
    </template>

    <!-- 预览弹窗 -->
    <n-modal v-model:show="previewVisible" style="width:800px" title="切片预览">
      <n-card v-if="previewItem" :bordered="false">
        <n-descriptions label-placement="left" :column="2">
          <n-descriptions-item label="标题">{{ previewItem.title }}</n-descriptions-item>
          <n-descriptions-item label="评分">{{ previewItem.score }}</n-descriptions-item>
          <n-descriptions-item label="时间段">{{ previewItem.timeRange }}</n-descriptions-item>
          <n-descriptions-item label="类型">{{ previewItem.highlightType }}</n-descriptions-item>
          <n-descriptions-item label="原因" :span="2">{{ previewItem.reason }}</n-descriptions-item>
        </n-descriptions>
        <n-space style="margin-top:12px">
          <n-tag v-for="tag in previewItem.tags" :key="tag" size="small">{{ tag }}</n-tag>
        </n-space>
      </n-card>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: "AutoClipManagement" });
import { useRouter } from "vue-router";
import { NButton, NSpace, NTag, NAlert, NDataTable, useNotification } from "naive-ui";
import request from "@renderer/apis/request";
import showDirectoryDialog from "@renderer/components/showDirectoryDialog";

interface ClipItem {
  id: string;
  title: string;
  score: number;
  timeRange: string;
  tags: string[];
  highlightType: string;
  reason: string;
  video_path: string;
  startTime: number;
  endTime: number;
  status: string;
  created_at: string;
  recorder_id: string;
  preset_id: string;
  llmFallback?: boolean;
}

const router = useRouter();
const notice = useNotification();
const loading = ref(false);
const analyzing = ref(false);
const clips = ref<ClipItem[]>([]);
const filterStatus = ref("");
const previewVisible = ref(false);
const previewItem = ref<ClipItem | null>(null);

const counts = computed(() => {
  const all = clips.value.length;
  const pending = clips.value.filter(c => c.status === "pending").length;
  const exported = clips.value.filter(c => c.status === "exported").length;
  const uploaded = clips.value.filter(c => c.status === "uploaded").length;
  return { all, pending, exported, uploaded };
});

const hasLlmFallback = computed(() => clips.value.some(c => c.llmFallback));

const filteredData = computed(() => {
  if (!filterStatus.value) return clips.value;
  return clips.value.filter(c => c.status === filterStatus.value);
});

const columns = [
  { title: "标题", key: "title", width: 200, ellipsis: { tooltip: true } },
  { title: "评分", key: "score", width: 60, render: (r: any) => r.score?.toFixed(1) },
  { title: "时间段", key: "timeRange", width: 140 },
  {
    title: "标签", key: "tags", width: 200,
    render: (r: any) => r.tags?.map((t: string) => h(NTag, { size: "small", style: { marginRight: "4px" } }, () => t)),
  },
  {
    title: "状态", key: "status", width: 80,
    render: (r: any) => {
      const map: Record<string, string> = { pending: "待审核", approved: "已批准", exported: "已完成", uploaded: "已上传" };
      return map[r.status] || r.status;
    },
  },
  { title: "时间", key: "created_at", width: 160, render: (r: any) => r.created_at?.slice(0, 16).replace("T", " ") },
  {
    title: "操作", key: "actions", width: 260,
    render: (row: any) => {
      return h(NSpace, {}, () => [
        h(NButton, { size: "small", onClick: () => previewClip(row) }, () => "预览"),
        h(NButton, {
          size: "small", type: "info",
          onClick: () => openVideo(row),
        }, () => "打开视频"),
        row.status === "pending" ? h(NButton, {
          size: "small", type: "primary",
          onClick: () => approveClip(row.dbId),
        }, () => "确认导出") : null,
        h(NButton, {
          size: "small", type: "error", ghost: true,
          onClick: () => deleteClip(row.dbId),
        }, () => "删除"),
      ]);
    },
  },
];

async function refreshList() {
  loading.value = true;
  try {
    const res = await request.get("/auto-clip/clips", { params: { status: filterStatus.value || undefined } });
    const raw = res.data?.data ?? res.data ?? [];
    clips.value = raw.flatMap((r: any) => {
      const highlights = r.highlights || [];
      return highlights.map((h: any, i: number) => ({
        id: `${r.id}_${i}`,
        dbId: r.id,
        title: h.title || "Untitled",
        score: h.score ?? 0,
        timeRange: `${h.bestRange?.[0] ?? "?"}s - ${h.bestRange?.[1] ?? "?"}s`,
        tags: h.tags || [],
        highlightType: h.highlightType || "",
        reason: h.reason || "",
        video_path: r.video_path,
        startTime: h.bestRange?.[0] ?? 0,
        endTime: h.bestRange?.[1] ?? 0,
        status: r.status,
        created_at: r.created_at,
        recorder_id: r.recorder_id,
        preset_id: r.preset_id,
        llmFallback: r.llmFallback ?? false,
      }));
    });
  } catch (e) {
    console.error("Failed to load clips:", e);
  } finally {
    loading.value = false;
  }
}

function previewClip(item: ClipItem) {
  previewItem.value = item;
  previewVisible.value = true;
}

function openVideo(item: ClipItem) {
  router.push({
    path: "/videoPlayer",
    query: { source: item.video_path, start: String(item.startTime), end: String(item.endTime) },
  });
}

async function approveClip(dbId: string) {
  try {
    notice.info("正在导出切片...");
    const res = await request.post(`/auto-clip/clip/${dbId}/approve-and-export`);
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
  }
}

async function deleteClip(dbId: string) {
  try {
    await request.post(`/auto-clip/clip/${dbId}/delete`);
    notice.success("已删除");
    await refreshList();
  } catch (e: any) {
    notice.error(`删除失败: ${e?.response?.data?.error || e.message}`);
  }
}

async function manualAnalyze() {
  let files: string[] | undefined;

  if (window.isWeb) {
    files = await showDirectoryDialog({
      type: "file",
      multi: false,
      exts: ["mp4", "flv", "mkv", "webm", "avi", "mov", "ts"],
    });
  } else if (window.api?.openFile) {
    files = await window.api.openFile({ multi: false });
  } else {
    notice.error("文件选择不可用（当前环境不支持）");
    return;
  }

  if (!files || files.length === 0) return;

  // 让用户确认/修改弹幕文件路径
  const guessedDanmuPath = files[0].replace(/\.[^.]+$/, ".xml");
  const danmuPath = prompt("弹幕文件路径（留空使用默认推导）:", guessedDanmuPath) || guessedDanmuPath;

  analyzing.value = true;
  notice.info("正在分析中，请稍候...");
  try {
    await request.post("/auto-clip/run", {
      videoPath: files[0],
      danmuPath,
    });
    notice.success("分析完成，请查看结果");
    await refreshList();
  } catch (e: any) {
    notice.error(`分析失败: ${e?.response?.data?.error || e.message}`);
  } finally {
    analyzing.value = false;
  }
}

onMounted(() => {
  refreshList();
});
</script>
