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
