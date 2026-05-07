// import { appConfig } from "../index.js";

import { Ollama } from "ollama";

export function getModelList(host: string) {
  const ollama = new Ollama({ host });
  return ollama.list();
}

export function chat(params: { host?: string; model: string; messages: any[]; options?: any }) {
  const host = params.host ?? "http://localhost:11434";
  const ollama = new Ollama({ host: host });
  return ollama.chat({
    model: params.model,
    messages: params.messages,
    options: params.options,
  });
}

export default {
  getModelList,
  chat,
};
