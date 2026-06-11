import { describe, it, expect, vi, beforeEach } from "vitest";
import { matchDanmaTimestamp, matchRoomId, matchTitle, matchUser } from "../../src/task/video.js";

describe("matchDanmaTimestamp", () => {
  it("should return the correct timestamp from a valid string", () => {
    const str = 'start_time="2024-08-20T09:48:07.7164935+08:00"';
    const result = matchDanmaTimestamp(str);
    expect(result).toBe(1724118487); // Expected timestamp
  });

  it("should return the correct timestamp from a string with record_start_time", () => {
    const str = "<video_start_time>2024-11-06T15:14:02.000Z</video_start_time>";
    const result = matchDanmaTimestamp(str);
    expect(result).toBe(1730906042); // Expected timestamp
  });

  it("should return the correct timestamp from a string with video_start_time", () => {
    const str = "2121<video_start_time>2024-07-23T18:26:30+08:00</video_start_time>212";
    const result = matchDanmaTimestamp(str);
    expect(result).toBe(1721730390); // Expected timestamp
  });

  it("should return the correct timestamp from a string with 录制时间", () => {
    const str = "录制时间: 2024-01-18T19:01:47.8252335+08:00";
    const result = matchDanmaTimestamp(str);
    expect(result).toBe(1705575707); // Expected timestamp
  });

  it("should return the correct timestamp from a string with 毫秒时间戳", () => {
    const str = "<video_start_time>1744734385686</video_start_time>";
    const result = matchDanmaTimestamp(str);
    expect(result).toBe(1744734385); // Expected timestamp
  });

  it("should return null if parsed time id unvalid", () => {
    const str = "2121<record_start_time>20ewewe</record_start_time>212";
    const result = matchDanmaTimestamp(str);
    expect(result).toBeNull();
  });

  it("should return null if no timestamp is found", () => {
    const str = "no timestamp here";
    const result = matchDanmaTimestamp(str);
    expect(result).toBeNull();
  });
});

describe("matchRoomId", () => {
  it("should return the correct room ID from a valid string", () => {
    const str = '<BililiveRecorderRecordInfo roomid="23141761" shortid="0" ';
    const result = matchRoomId(str);
    expect(result).toBe("23141761"); // Expected room ID
  });

  it("should return the correct room ID from a string with extra characters", () => {
    const str = "1<room_id>22747736</room_id>1";
    const result = matchRoomId(str);
    expect(result).toBe("22747736"); // Expected room ID
  });

  it("should return null if no room ID is found", () => {
    const str = "no room ID here";
    const result = matchRoomId(str);
    expect(result).toBeNull();
  });
});

describe("matchTitle", () => {
  it("should return the correct title from a valid string", () => {
    const str = '1 title="Live Stream Title" 1';
    const result = matchTitle(str);
    expect(result).toBe("Live Stream Title"); // Expected title
  });

  it("should return the correct title from a string 直播标题 regex", () => {
    const str = "直播标题: 精通人性女讲师上线";
    const result = matchTitle(str);
    expect(result).toBe("精通人性女讲师上线"); // Expected title
  });

  it("should return the correct title from a string with room_title regex", () => {
    const str = "1<room_title>新游戏 恋爱单选题 直播</room_title>1";
    const result = matchTitle(str);
    expect(result).toBe("新游戏 恋爱单选题 直播"); // Expected title
  });

  it("should return null if no title is found", () => {
    const str = "no title here";
    const result = matchTitle(str);
    expect(result).toBeNull();
  });
});

describe("matchUser", () => {
  it("should return the correct user from a valid string", () => {
    const str = '12 name="username" 12';
    const result = matchUser(str);
    expect(result).toBe("username"); // Expected user
  });

  it("should return the correct user from a string with user_name regex", () => {
    const str = "1<user_name>不死鸟总监</user_name>1";
    const result = matchUser(str);
    expect(result).toBe("不死鸟总监"); // Expected user
  });
  it("should return the correct user from a string with user_name regex", () => {
    const str = "1<user_name>不死鸟总监</user_name>1";
    const result = matchUser(str);
    expect(result).toBe("不死鸟总监"); // Expected user
  });

  it("should return the correct user from a string with 主播名 regex", () => {
    const str = "主播名: 棋手战鹰";
    const result = matchUser(str);
    expect(result).toBe("棋手战鹰"); // Expected user
  });

  it("should return null if no user is found", () => {
    const str = "no user here";
    const result = matchUser(str);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// genMergeAssMp4Command — accurateSeek tests
// ---------------------------------------------------------------------------

// Hoisted mocks (vitest)
const mockCmdInputOptions = vi.fn().mockReturnThis();
const mockCmdOutputOptions = vi.fn().mockReturnThis();
const mockCommand = {
  inputOptions: mockCmdInputOptions,
  outputOptions: mockCmdOutputOptions,
  output: vi.fn().mockReturnThis(),
  input: vi.fn().mockReturnThis(),
  complexFilter: vi.fn().mockReturnThis(),
  videoCodec: vi.fn().mockReturnThis(),
  audioCodec: vi.fn().mockReturnThis(),
  videoBitrate: vi.fn().mockReturnThis(),
  audioBitrate: vi.fn().mockReturnThis(),
  size: vi.fn().mockReturnThis(),
  fps: vi.fn().mockReturnThis(),
  format: vi.fn().mockReturnThis(),
  addOption: vi.fn().mockReturnThis(),
};

vi.mock("@renmu/fluent-ffmpeg", () => ({
  default: vi.fn(() => {
    mockCommand.output.mockReturnValue(mockCommand);
    return mockCommand;
  }),
}));

vi.mock("../../src/utils/complexFilter.js", () => ({
  ComplexFilter: vi.fn(() => ({
    addScaleFilter: vi.fn(),
    addSubtitleFilter: vi.fn(),
    addColorkeyFilter: vi.fn(),
    addOverlayFilter: vi.fn(),
    addDrawtextFilter: vi.fn(),
    addFilter: vi.fn(),
    getFilters: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock("../../src/utils/index.js", () => ({
  setFfmpegPath: vi.fn(),
  genFfmpegParams: vi.fn().mockReturnValue([]),
}));

vi.mock("../../src/task/hardware.js", () => ({
  getHardwareAcceleration: vi.fn().mockReturnValue(""),
  selectScaleMethod: vi.fn().mockReturnValue("auto"),
}));

async function getGenMergeAssMp4Command() {
  const mod = await import("../../src/task/video.js");
  return mod.genMergeAssMp4Command;
}

const dummyFiles = {
  videoFilePath: "/fake/video.mp4",
  assFilePath: undefined,
  outputPath: "/fake/output.mp4",
  hotProgressFilePath: undefined,
  subtitlePath: undefined,
};

describe("genMergeAssMp4Command — accurateSeek", () => {
  beforeEach(() => {
    mockCmdInputOptions.mockClear();
    mockCmdOutputOptions.mockClear();
  });

  it("accurateSeek: uses inputOptions -ss and outputOptions -to (no -copyts)", async () => {
    const genMerge = await getGenMergeAssMp4Command();

    await genMerge(
      dummyFiles,
      {
        encoder: "libx264",
        audioCodec: "copy",
        ss: 100,
        to: 150,
        accurateSeek: true,
      },
      { startTimestamp: 0 },
    );

    // Should have used -ss as input option
    const inputCalls = mockCmdInputOptions.mock.calls.flat();
    expect(inputCalls).toContain("-ss 100");

    // Should NOT have -copyts
    expect(inputCalls).not.toContain("-copyts");

    // -to should be an output option (150 - 100 = 50)
    const outputCalls = mockCmdOutputOptions.mock.calls.flat();
    expect(outputCalls).toContain("-to 50");
  });

  it("accurateSeek with encoder=copy: falls back to old path (no -copyts needed)", async () => {
    const genMerge = await getGenMergeAssMp4Command();

    await genMerge(
      dummyFiles,
      {
        encoder: "copy" as any,
        audioCodec: "copy",
        ss: 50,
        to: 80,
        accurateSeek: true,
      },
      { startTimestamp: 0 },
    );

    const inputCalls = mockCmdInputOptions.mock.calls.flat();
    expect(inputCalls).toContain("-ss 50");
    // encoder=copy falls into else branch → no -copyts (copy doesn't add it)
    expect(inputCalls).toContain("-to 80");
  });

  it("without accurateSeek: uses legacy -copyts path", async () => {
    const genMerge = await getGenMergeAssMp4Command();

    await genMerge(
      dummyFiles,
      {
        encoder: "libx264",
        audioCodec: "copy",
        ss: 30,
        to: 60,
        // accurateSeek NOT set
      },
      { startTimestamp: 0 },
    );

    const inputCalls = mockCmdInputOptions.mock.calls.flat();
    expect(inputCalls).toContain("-ss 30");
    expect(inputCalls).toContain("-copyts");
    expect(inputCalls).toContain("-to 60");
  });

  it("accurateSeek with ss but no 'to': does not set output -to", async () => {
    const genMerge = await getGenMergeAssMp4Command();

    await genMerge(
      dummyFiles,
      {
        encoder: "libx264",
        audioCodec: "copy",
        ss: 10,
        accurateSeek: true,
      },
      { startTimestamp: 0 },
    );

    const inputCalls = mockCmdInputOptions.mock.calls.flat();
    expect(inputCalls).toContain("-ss 10");

    // No -to in output options (to wasn't set)
    const outputCalls = mockCmdOutputOptions.mock.calls.flat();
    const hasTo = outputCalls.some((c: string) => c.includes("-to"));
    expect(hasTo).toBe(false);
  });

  it("no ss: does not add any seek options", async () => {
    const genMerge = await getGenMergeAssMp4Command();

    await genMerge(
      dummyFiles,
      {
        encoder: "libx264",
        audioCodec: "copy",
        // no ss
        to: 60,
        accurateSeek: true,
      },
      { startTimestamp: 0 },
    );

    const inputCalls = mockCmdInputOptions.mock.calls.flat();
    const hasSs = inputCalls.some((c: string) => c.startsWith("-ss"));
    expect(hasSs).toBe(false);
  });
});
