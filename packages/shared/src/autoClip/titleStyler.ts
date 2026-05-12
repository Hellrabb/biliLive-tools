import pLimit from "p-limit";
import logger from "../utils/log.js";
import type { HighlightSegment, TitleStyleConfig } from "./types.js";
import { extractAndParseJSON } from "./jsonParser.js";
import { LLM_CONCURRENCY, LLM_REQUEST_TIMEOUT_MS } from "./constants.js";
import { sanitizeForPrompt } from "./promptSanitizer.js";

// ---------------------------------------------------------------------------
// Prompt templates
// ---------------------------------------------------------------------------

const ADAPTIVE_PROMPT_BASE = `你是一位创意文案写手。基于以下直播片段的信息，为切片生成一个 {min}-{max} 字、富有文化和诗意的标题。

风格要求：{style_guide}

直播片段信息：
- 事件摘要：{summary}
{asr_section}
{frame_section}
- 弹幕氛围：{danmaku}

返回 ONLY 有效 JSON（不要 markdown）：
{"title": "诗意标题"}`;

const STYLE_GUIDES: Record<string, string> = {
  funny: `幽默俏皮，用梗或网络流行语转译事件。轻松诙谐，有记忆点。
参考：节目效果，虽迟但到 / 主播的嘴，骗人的鬼 / 笑死，这就是传说中的天选之人`,

  impressive: `大气震撼，有冲击力的意象和修辞，如见证历史的庄重感。
参考：此刻，世界为之屏息 / 这一瞬，足以载入史册 / 鬼神之技，凡人退散`,

  touching: `温情含蓄，细腻的情感表达，有留白和不言明的温柔。
参考：世间所有的相遇都是久别重逢 / 万语千言，化作无声 / 你是我最柔软的铠甲`,

  hype: `热血澎湃，燃、炸、高能的表达，让人起鸡皮疙瘩。
参考：燃起来了，这就是信仰之跃 / 全场起立，见证神迹 / 我的剑，就是你的剑`,

  troll: `戏谑调侃，幽默反转，先扬后抑或先抑后扬的喜剧节奏。
参考：大型翻车现场，见证历史 / 这波操作，弹幕都看傻了 / 你以为稳了？不存在的`,

  not_highlight: `简洁概括，平实但有温度。描述发生了什么事即可。`,
};


// ---------------------------------------------------------------------------
// buildTitlePrompt
// ---------------------------------------------------------------------------

export function buildTitlePrompt(
  highlight: HighlightSegment,
  asrTranscript: string | undefined,
  danmakuContext: string,
  frameDescription?: string,
  config?: TitleStyleConfig,
): string {
  const min = config?.minLength ?? 20;
  const max = config?.maxLength ?? 30;
  const summary = sanitizeForPrompt(highlight.title || "直播精彩片段");

  const asrSection = asrTranscript
    ? `- 主播语音：${sanitizeForPrompt(asrTranscript)}`
    : "";
  const frameSection = frameDescription
    ? `- 画面描述：${sanitizeForPrompt(frameDescription)}`
    : "";

  // If customPrompt is provided, use it as the template (overrides built-in templates)
  if (config?.customPrompt) {
    const styleGuide = STYLE_GUIDES[highlight.highlightType] ?? STYLE_GUIDES.not_highlight!;
    return config.customPrompt
      .replace(/\{min\}/g, String(min))
      .replace(/\{max\}/g, String(max))
      .replace(/\{summary\}/g, summary)
      .replace(/\{asr_section\}/g, asrSection)
      .replace(/\{frame_section\}/g, frameSection)
      .replace(/\{danmaku\}/g, danmakuContext || "无特殊弹幕模式")
      .replace(/\{style_guide\}/g, styleGuide);
  }

  const styleGuide = STYLE_GUIDES[highlight.highlightType] ?? STYLE_GUIDES.not_highlight!;

  return ADAPTIVE_PROMPT_BASE
    .replace(/\{min\}/g, String(min))
    .replace(/\{max\}/g, String(max))
    .replace(/\{style_guide\}/g, styleGuide)
    .replace(/\{summary\}/g, summary)
    .replace(/\{asr_section\}/g, asrSection)
    .replace(/\{frame_section\}/g, frameSection)
    .replace(/\{danmaku\}/g, danmakuContext || "无特殊弹幕模式");
}

// ---------------------------------------------------------------------------
// generateStyledTitles
// ---------------------------------------------------------------------------

export async function generateStyledTitles(
  highlights: HighlightSegment[],
  context: {
    asrMap: Map<number, string>;
    frameMap: Map<number, string>;
  },
  sendMessage: (prompt: string, signal?: AbortSignal) => Promise<string>,
  config?: TitleStyleConfig,
): Promise<HighlightSegment[]> {
  if (highlights.length === 0) return highlights;

  const limit = pLimit(LLM_CONCURRENCY);

  const sendWithTimeout = (prompt: string): Promise<string> => {
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Title styling LLM timeout"));
      }, LLM_REQUEST_TIMEOUT_MS);
      sendMessage(prompt, controller.signal)
        .then((res) => { clearTimeout(timer); resolve(res); })
        .catch((err) => {
          clearTimeout(timer);
          if (err?.name === "AbortError") {
            reject(new Error("Title styling LLM timeout"));
          } else {
            reject(err);
          }
        });
    });
  };

  const tasks = highlights.map((h, i) =>
    limit(async () => {
      try {
        const asrTranscript = context.asrMap.get(i);
        const frameDescription = context.frameMap.get(i);

        const danmakuContext = [
          h.tags.length > 0 ? `标签：${h.tags.join("、")}` : "",
          h.reason ? `高光原因：${h.reason}` : "",
        ].filter(Boolean).join("；");

        const prompt = buildTitlePrompt(
          h,
          asrTranscript,
          danmakuContext,
          frameDescription,
          config,
        );

        const raw = await sendWithTimeout(prompt);
        const parsed = parseTitleResponse(raw);

        if (parsed) {
          h.title = parsed;
        }
      } catch (err) {
        logger.warn(`titleStyler: failed to generate styled title for highlight ${i}: ${err}`);
        // Keep Phase 1 content summary
      }
    }),
  );

  await Promise.allSettled(tasks);

  return highlights;
}

// ---------------------------------------------------------------------------
// parseTitleResponse
// ---------------------------------------------------------------------------

export function parseTitleResponse(raw: string): string | null {
  const parsed = extractAndParseJSON<{ title?: string }>(raw);
  if (parsed && typeof parsed.title === "string" && parsed.title.length > 0) {
    return parsed.title.trim();
  }
  const trimmed = raw.trim();
  // Reject text that looks like an LLM error/refusal message
  const likelyErrorPatterns = [
    /^(I|Sorry|Error|无法|不能|抱歉|对不起|Please)/i,
    /^(As an AI|I am|I cannot|I'm unable)/i,
  ];
  const looksLikeError = likelyErrorPatterns.some((p) => p.test(trimmed));

  if (
    !looksLikeError &&
    trimmed.length >= 8 &&
    trimmed.length <= 50 &&
    !trimmed.includes("\n") &&
    !trimmed.includes("{")
  ) {
    return trimmed;
  }
  return null;
}
