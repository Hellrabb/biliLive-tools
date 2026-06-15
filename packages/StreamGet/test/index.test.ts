import { describe, it, expect, vi } from "vitest";

// Mock the API module to return canned responses (no network needed)
vi.mock("../src/bilibili/api.js", () => {
  const now = Math.floor(Date.now() / 1000);
  return {
    getRoomInit: vi.fn().mockResolvedValue({
      room_id: 1,
      short_id: 0,
      uid: 100,
      live_status: 1,
      live_time: now,
      encrypted: false,
      is_sp: 0,
    }),
    getStatusInfoByUIDs: vi.fn().mockResolvedValue({
      100: {
        title: "测试直播间",
        uname: "测试主播",
        face: "https://example.com/face.jpg",
        cover_from_user: "https://example.com/cover.jpg",
        live_time: now,
        live_status: 1,
        online: 999,
        room_id: 1,
        short_id: 0,
      },
    }),
    getRoomBaseInfo: vi.fn(),
    getRoomPlayInfo: vi.fn().mockResolvedValue({
      live_status: 1,
      playurl_info: {
        playurl: {
          g_qn_desc: [
            { qn: 400, desc: "蓝光" },
            { qn: 250, desc: "超清" },
          ],
          stream: [
            {
              protocol_name: "http_hls",
              format: [
                {
                  format_name: "ts",
                  codec: [
                    {
                      codec_name: "avc",
                      current_qn: 400,
                      accept_qn: [400, 250],
                      base_url: "https://example.com/live/stream",
                      url_info: [
                        {
                          host: "https://cdn1.example.com",
                          extra: "live/stream.m3u8?token=abc",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    }),
  };
});

import { StreamParser, BilibiliParser, UnsupportedPlatformError } from "../src/index.js";

describe("StreamParser", () => {
  it("should detect bilibili platform", () => {
    const parser = new StreamParser();
    const platform = parser.detectPlatform("https://live.bilibili.com/123");
    expect(platform).toBe("bilibili");
  });

  it("should detect douyu platform", () => {
    const parser = new StreamParser();
    const platform = parser.detectPlatform("https://www.douyu.com/789");
    expect(platform).toBe("douyu");
  });

  it("should detect huya platform", () => {
    const parser = new StreamParser();
    const platform = parser.detectPlatform("https://www.huya.com/abc");
    expect(platform).toBe("huya");
  });

  it("should return null for unsupported platform", () => {
    const parser = new StreamParser();
    const platform = parser.detectPlatform("https://example.com");
    expect(platform).toBeNull();
  });

  it("should list all platforms", () => {
    const parser = new StreamParser();
    const platforms = parser.listPlatforms();
    expect(platforms).toContain("bilibili");
    expect(platforms).toContain("douyu");
    expect(platforms).toContain("huya");
  });

  it("should throw error for unsupported platform when parsing", async () => {
    const parser = new StreamParser();
    await expect(parser.parse("https://example.com")).rejects.toThrow(UnsupportedPlatformError);
  });
});

// Integration tests with mocked API (no network required)
describe("Integration Tests", () => {
  it("should parse bilibili live room (mocked API)", async () => {
    const parser = new BilibiliParser();
    const result = await parser.parse("https://live.bilibili.com/1");

    expect(result.liveInfo).toBeDefined();
    expect(result.liveInfo.platform).toBe("bilibili");
    expect(result.liveInfo.roomId).toBe("1");
    expect(result.liveInfo.living).toBe(true);
    expect(result.liveInfo.title).toBeTruthy();
    expect(result.liveInfo.owner).toBeTruthy();

    // 直播中，应该有流地址
    expect(result.sources).toBeDefined();
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources[0].streams).toBeDefined();
    expect(result.sources[0].streams.length).toBeGreaterThan(0);

    const firstStream = result.sources[0].streams[0];
    expect(firstStream.url).toMatch(/^https?:\/\//);
    expect(typeof firstStream.quality).toBe("number");
    expect(firstStream.qualityDesc).toBeTruthy();
  });
});
