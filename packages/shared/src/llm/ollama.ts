// import { appConfig } from "../index.js";

import { Ollama } from "ollama";

export function getModelList(host: string) {
  const ollama = new Ollama({ host });
  return ollama.list();
}

export function chat(params: {
  host?: string;
  model: string;
  messages: any[];
  options?: any;
  signal?: AbortSignal;
}) {
  const host = params.host ?? "http://localhost:11434";
  const ollama = new Ollama({
    host,
    fetch: params.signal
      ? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: params.signal }))
      : undefined,
  });
  return ollama.chat({
    model: params.model,
    messages: params.messages,
    options: params.options,
  });
}

export async function chatMultimodal(opts: {
  host: string;
  model: string;
  prompt: string;
  images: string[];
  signal?: AbortSignal;
}): Promise<string> {
  const response = await fetch(`${opts.host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      messages: [{
        role: "user",
        content: opts.prompt,
        images: opts.images,
      }],
      stream: false,
    }),
    signal: opts.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Ollama multimodal chat failed: ${response.status} ${text}`);
  }

  const data = await response.json() as { message?: { content?: string } };
  return data?.message?.content ?? "";
}

export default {
  getModelList,
  chat,
  chatMultimodal,
};
