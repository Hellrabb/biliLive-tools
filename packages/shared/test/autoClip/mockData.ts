import type { DanmuItem, SC, Gift } from "@biliLive-tools/types";
import type { DanmuStats, HighlightSegment } from "../../src/autoClip/types";

/**
 * Build a minimal DanmuStats object for testing.
 *
 * @param danmu   Flat list of 'text' danmaku items
 * @param sc      SC (Super Chat) items
 * @param gift    Gift items
 * @param guard   Guard items
 * @param duration Video duration in seconds
 */
export function buildDanmuStatsMock(
  danmu: DanmuItem[] = [],
  sc: SC[] = [],
  gift: Gift[] = [],
  guard: DanmuItem[] = [],
  duration: number = 100,
): DanmuStats {
  return {
    danmu,
    sc,
    gift,
    guard: guard as any,
    videoStartTime: 0,
    duration,
  };
}

/**
 * Create a simple DanmuItem (text type) at a given second offset.
 */
export function makeDanmu(timestamp: number, text: string, user?: string): DanmuItem {
  return {
    text,
    ts: timestamp * 1000,
    timestamp,
    type: "text",
    user,
  };
}

/**
 * Create a Super Chat entry at a given second offset.
 */
export function makeSC(
  timestamp: number,
  price: number,
  user: string = "sc_user",
  message: string = "SC message",
): SC {
  return {
    text: message,
    ts: timestamp * 1000,
    timestamp,
    type: "sc",
    user,
    gift_price: price,
  };
}

/**
 * Create a Gift entry at a given second offset.
 */
export function makeGift(
  timestamp: number,
  giftName: string = "小花",
  price: number = 1,
  user: string = "gift_user",
): Gift {
  return {
    text: `${giftName} x1`,
    ts: timestamp * 1000,
    timestamp,
    type: "gift",
    user,
    gift_name: giftName,
    gift_price: price,
  };
}

/**
 * Generate N identical copies of a danmaku spread evenly across duration.
 */
export function generateUniformDanmaku(
  count: number,
  duration: number,
  text: string = "普通弹幕",
): DanmuItem[] {
  const items: DanmuItem[] = [];
  const step = Math.max(1, duration / count);
  for (let i = 0; i < count; i++) {
    items.push(makeDanmu(Math.floor(i * step), `${text} ${i}`));
  }
  return items;
}

/**
 * Generate a dense cluster of danmaku centered around `centerSec` with given spread.
 */
export function generateDanmakuCluster(
  count: number,
  centerSec: number,
  spreadSec: number,
  text: string = "高潮弹幕",
): DanmuItem[] {
  const items: DanmuItem[] = [];
  const half = spreadSec / 2;
  for (let i = 0; i < count; i++) {
    const offset = (Math.random() - 0.5) * spreadSec;
    items.push(makeDanmu(centerSec + offset, `${text} ${i}`));
  }
  return items;
}

/**
 * Create a minimal HighlightSegment for testing.
 * All fields have sensible defaults; overrides are shallow-merged.
 */
export function makeHighlight(overrides: Partial<HighlightSegment> = {}): HighlightSegment {
  return {
    timeRange: [120, 300],
    bestRange: [125, 295],
    score: 8,
    title: "Test Highlight",
    tags: [],
    highlightType: "hype",
    reason: "test",
    signalSources: ["danmakuDensity"],
    isHighlight: true,
    ...overrides,
  };
}
