# LESSONS.md — biliLive-tools

> 记录开发中反复出现的问题模式，供后续 change 参考。

## 活跃条目

### L-crypto-migration

**来源**: `fix-docker-security-regressions` (2026-06-16)

**问题模式**: 加密方案升级时，如果旧密钥从代码中移除，必须同时提供解密回退路径。`getKeyCandidates()` 应始终包含旧密钥作为末位回退，配合 `decodeUser()` 的自动迁移逻辑（旧密钥解密→新密钥重加密）。

**检查清单**（当再次修改加密/密钥体系时）:

- [ ] `getKeyCandidates()` 是否包含所有历史密钥？
- [ ] `decodeUser()` 的 `usedKeyIndex > 0` 迁移路径是否正常工作？
- [ ] `verifyBiliKey` API 是否同时检查 env var 和 config 文件？
- [ ] Docker `.env` 是否已 gitignore？
- [ ] 启动日志是否告知用户密钥来源（env/生成/已有）？

### 观察（Monitored）

- **2026-06-09** | `autoclip-ffmpeg-custom` — `getPresetLabel()` if-else 链待改为 keyed lookup（6 分支，在阈值边缘）。触发条件：下次新增编码器类型时一并重构为 `Map<string, preset[]>`。
- **2026-06-09** | `autoclip-ffmpeg-custom` — `try/catch { /* comment */ }` 静默吞错反模式：`loadDanmuPresets()` 和旧的 `loadFfmpegPresets()` 均存在。本次只修复了 `loadFfmpegPresets()`，`loadDanmuPresets()`（line 672-673）仍为静默。触发条件：下次修改 AutoClipPresetDialog 时一并改。
- **2026-06-12** | `fix-autoclip-output-dir` — `cut()` 对绝对路径跳过 `parseSavePath`（其中含 `fs.ensureDir`），ffmpeg 在不存在目录中 `open()` 返回 EINVAL 而非 ENOENT（Docker overlay 文件系统行为）。教训：任何生成输出文件路径的函数必须在调用 ffmpeg 前显式确保目录存在。修复：`cut()` + `mergeAssMp4()` 中均添加 `fs.ensureDir(dirname(outputPath))`。
- **2026-06-12** | `fix-autoclip-gpu-fallback` — `genMergeAssMp4Command` 和 `genFfmpegParams` 各自独立添加输出 `-ss` 选项，accurateSeek 引入 `-to` 输出选项后，三个时间选项互相冲突导致 ffmpeg 硬件编码器静默回退 CPU。教训：**跨模块 ffmpeg 选项冲突**——修改 `genMergeAssMp4Command` 的选项生成时必须同时检查 `genFfmpegParams` 是否有重复/冲突选项。触发条件：任何对这两个函数中 ffmpeg 选项的修改，review 时必须 cross-check 另一个函数。
- **2026-06-13** | `fix-autoclip-encoder-batching` — **硬编码默认值覆盖用户配置**：`AUTO_CLIP_DEFAULT_CONFIG.export.encoder = "libx264"` 被每个新建 autoclip 预设继承，原优先级 `exportConfig > ffmpegPreset` 导致默认值始终取胜。教训：默认值应使用 falsy 值（`""` / `undefined`），让优先级链正确回退。`??` vs `||` 的选择要匹配值的 falsy 语义——`??` 不处理空字符串。
- **2026-06-13** | `fix-autoclip-encoder-batching` — **异步竞态**：`addMedia` 返回后才注册 `task-end` 监听获取 AID，两次导出几乎同时完成时第二次在第一次注册监听前检查 Map → 看不到 AID → 重复创建投稿。教训：在 `await` 之前写入 pending Promise 占位，用 Promise 而非裸值做并发安全的 Map 缓存。触发条件：任何"检查 Map → await → 写入 Map"的模式都是竞态。
- **2026-06-14** | `fix-cover-gray-frame` — `frameSampler.extractOneFrame` 和 `genMergeAssMp4Command` 是两个独立的 ffmpeg 入口，accurateSeek 只修了后者。教训：**批量修复类 bug 必须全量排查所有同类入口**（grep 所有 `-ss.*-i` 的 ffmpeg 调用点），不能只修第一个找到的。
- **2026-06-14** | `fix-accurate-seek-preset-fallback` — **对 ffmpeg 行为的错误假设**：原注释写"去掉 -copyts 后 ffmpeg 自动丢弃关键帧之前的坏帧"——实际上没有输出 `-ss` 时 ffmpeg 仍然输出关键帧之后 ALL decoded frames。教训：**涉及第三方工具的假设必须用命令行实测验证**，不能凭文档或推理下结论。
- **2026-06-14** | `revert-padded-seek-video` — 接上条，经实测发现 ffmpeg transcoding 默认启用 `-accurate_seek`，输入 `-ss` 已自动丢弃预 seek 帧。之前加的 padded output seek 多余且有害（关键帧位置不定时引入额外音视频）。教训：**修复后发现更根本的机制时，应立即回退多余改动**——宁可少修不可多修。frameSampler 保留 padded seek 因为 `-vframes 1` 不走 `-accurate_seek`。
- **2026-06-14** | `fix-accurate-seek-preset-fallback` — **容器中 appConfig 未持久化**：`container.resolve("appConfig")` 返回编译默认值而非 JSON 持久化值，`autoClipPresetId` 为空导致回退链断裂。教训：依赖 `container.resolve("appConfig")` 做关键决策时需验证运行时值，必要时加硬编码兜底。
- **2026-06-11** | `fix-autoclip-three-bugs` — R6: `dailyUploadAids` Map 是进程内状态，应用重启后丢失，同天后续切片可能创建新投稿而非追加。建议：启动时从 DB 查询当日已上传记录恢复 AID。
- **2026-06-05** | `files.ts` 路径校验逻辑去重 — `packages/http/src/routes/files.ts:171-217` 存在 10 行 × 2 处内部重复块，建议提取 `validateFilePath()`。触发条件：下次修改 files.ts 时一并重构。
- **2026-06-05** | `signalDetector.ts` (591行) 复杂度持续监控 — 当前为 autoClip 最大单文件，若继续增长至 700+ 行则强制拆分。触发条件：每次修改 signalDetector.ts 时检查行数。
- **2026-06-05** | `NotificationType` / `LLMType` 导出确认 — ts-prune 报告零引用，需确认是否为公共 API 后更新 CONTEXT.md「既有抽象索引」或移除导出。触发条件：下次涉及 enum.ts 的修改时一并确认。

## 已关闭条目

- **2026-06-05** | `health-fix-2026-06` — better-sqlite3 原生模块不兼容（预编译二进制 Node 24 但运行时 Node 22），通过 `node-gyp rebuild` 从源码重编译解决。教训：`pnpm rebuild` 不一定能解决原生模块问题——如果预编译二进制存在，pnpm 可能跳过了源码编译。需 `rm -rf build/ && npx node-gyp rebuild` 强制源码重编译。
- **2026-06-05** | `health-fix-2026-06` — ESLint plugin 栈版本不兼容（ESLint 8 vs flat config）。教训：`@vue/eslint-config-typescript@14+` 和 `@vue/eslint-config-prettier@10+` 都要求 ESLint 9+。ESLint 8 项目必须锁版 `@vue/eslint-config-typescript@13` + `@vue/eslint-config-prettier@8`。长期应迁移到 flat config。
- **2026-06-05** | `health-fix-2026-06` — vitest 覆盖率工具版本匹配：`@vitest/coverage-v8@4.x` 需要 `vitest@4.x`，使用 `vitest@3.x` 的项目需安装 `@vitest/coverage-v8@3.x`。
