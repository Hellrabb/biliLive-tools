import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";

// Mock axios so we don't need a real Alist server
const mockPost = vi.fn();
vi.mock("axios", () => ({
  default: {
    create: vi.fn(() => ({
      post: mockPost,
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    })),
  },
}));

import { Alist } from "../src/sync/alist.js";

describe("Alist 上传器测试", () => {
  let alist: Alist;
  let tempDir: string;
  let testFile: string;

  beforeEach(async () => {
    mockPost.mockReset();

    tempDir = path.join(os.tmpdir(), "alist-test-" + Date.now());
    await fs.ensureDir(tempDir);
    testFile = path.join(tempDir, "test-file.txt");
    await fs.writeFile(testFile, "这是测试文件内容");

    alist = new Alist({
      server: "http://localhost:5244",
      username: "admin",
      password: "password",
      remotePath: "/测试",
    });
  });

  afterAll(async () => {
    // cleanup
    try {
      await fs.remove(tempDir);
    } catch {}
    vi.restoreAllMocks();
  });

  it("应该能够登录到AList服务器", async () => {
    mockPost.mockResolvedValueOnce({
      data: { code: 200, data: { token: "mock-token-123" } },
    });

    const result = await alist.login();
    expect(result).toBe(true);
    expect(alist.isLoggedIn()).toBe(true);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith("/api/auth/login/hash", {
      username: "admin",
      password: "password",
    });
  });

  it("应该在凭证错误时登录失败", async () => {
    mockPost.mockResolvedValueOnce({
      data: { code: 401, message: "wrong password" },
    });

    const result = await alist.login();
    expect(result).toBe(false);
  });

  it("应该能够创建远程目录", async () => {
    // login
    mockPost.mockResolvedValueOnce({
      data: { code: 200, data: { token: "mock-token" } },
    });
    await alist.login();
    expect(alist.isLoggedIn()).toBe(true);

    // mkdir
    mockPost.mockResolvedValueOnce({
      data: { code: 200, data: {} },
    });
    const result = await alist.mkdir("test-dir");
    expect(result).toBe(true);
    expect(mockPost).toHaveBeenLastCalledWith("/api/fs/mkdir", {
      path: "test-dir",
    });
  });

  it("应该能够列出远程目录", async () => {
    // login
    mockPost.mockResolvedValueOnce({
      data: { code: 200, data: { token: "mock-token" } },
    });
    await alist.login();

    // list files
    mockPost.mockResolvedValueOnce({
      data: {
        code: 200,
        data: {
          content: [
            { name: "file1.txt", size: 100, is_dir: false },
            { name: "subdir", size: 0, is_dir: true },
          ],
        },
      },
    });
    const files = await alist.listFiles("");
    expect(Array.isArray(files)).toBe(true);
    expect(files.length).toBe(2);
    expect(files[0]).toHaveProperty("name", "file1.txt");
  });

  it("应该能够处理上传前准备工作", async () => {
    // login
    mockPost.mockResolvedValueOnce({
      data: { code: 200, data: { token: "mock-token" } },
    });
    await alist.login();

    const successSpy = vi.fn();
    alist.on("success", successSpy);

    expect(alist.isLoggedIn()).toBe(true);
  });
});
