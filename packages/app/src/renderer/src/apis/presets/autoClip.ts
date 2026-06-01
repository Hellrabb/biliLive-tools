import request from "../request";
import type { AutoClipPreset as AutoClipPresetType, AutoClipConfig } from "@biliLive-tools/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(s: string): boolean {
  return UUID_RE.test(s);
}

const list = async (): Promise<AutoClipPresetType[]> => {
  const res = await request.get("/auto-clip/presets");
  return res.data;
};

const get = async (id: string): Promise<AutoClipPresetType> => {
  const res = await request.get(`/auto-clip/presets/${id}`);
  return res.data;
};

const save = async (preset: AutoClipPresetType) => {
  if (preset.id && isValidUUID(preset.id)) {
    return request.put(`/auto-clip/presets/${preset.id}`, preset);
  }
  return request.post("/auto-clip/presets", preset);
};

const remove = async (id: string) => {
  return request.delete(`/auto-clip/presets/${id}`);
};

const getDefaultConfig = async (): Promise<AutoClipConfig> => {
  const res = await request.get("/auto-clip/default-config");
  return res.data;
};

export async function batchApproveAndExport(ids: string[]) {
  return request.post("/auto-clip/clips/batch-approve-and-export", { ids });
}

export async function getCounts(): Promise<{
  all: number;
  pending: number;
  analyzing: number;
  approved: number;
  exporting: number;
  exported: number;
  uploaded: number;
  failed: number;
}> {
  const res = await request.get("/auto-clip/clips/counts");
  return res.data;
}

export interface ClipListParams {
  status?: string;
  limit?: number;
  offset?: number;
}

export async function getClips(params: ClipListParams) {
  const res = await request.get("/auto-clip/clips", { params });
  return res.data;
}

export async function getResult(taskId: string) {
  const res = await request.get(`/auto-clip/result/${taskId}`);
  return res.data;
}

export async function runAnalysis(payload: {
  videoPath: string;
  danmuPath: string;
  presetId?: string;
  outputName?: string;
}) {
  const res = await request.post("/auto-clip/run", payload);
  return res.data;
}

export async function cancelAnalysis(taskId: string) {
  const res = await request.post(`/auto-clip/cancel/${taskId}`);
  return res.data;
}

export async function approveAndExport(clipId: string) {
  const res = await request.post(`/auto-clip/clips/${clipId}/approve-and-export`);
  return res.data;
}

export async function deleteClip(clipId: string) {
  const res = await request.post(`/auto-clip/clips/${clipId}/delete`);
  return res.data;
}

const autoClipPresetApi = { list, get, save, remove, getDefaultConfig, getCounts };
export default autoClipPresetApi;
