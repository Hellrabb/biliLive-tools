import request from "../request";
import type { AutoClipPreset as AutoClipPresetType, AutoClipConfig } from "@biliLive-tools/types";

const list = async (): Promise<AutoClipPresetType[]> => {
  const res = await request.get("/auto-clip/presets");
  return res.data;
};

const get = async (id: string): Promise<AutoClipPresetType> => {
  const res = await request.get(`/auto-clip/presets/${id}`);
  return res.data;
};

const save = async (preset: AutoClipPresetType) => {
  if (preset.id) {
    return request.put(`/auto-clip/presets/${preset.id}`, preset);
  }
  return request.post("/auto-clip/preset", preset);
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

const getCounts = async (): Promise<{
  all: number; pending: number; analyzing: number; approved: number; exporting: number; exported: number; uploaded: number; failed: number;
}> => {
  const res = await request.get("/auto-clip/clips/counts");
  return res.data;
};

const autoClipPresetApi = { list, get, save, remove, getDefaultConfig, getCounts };
export default autoClipPresetApi;
