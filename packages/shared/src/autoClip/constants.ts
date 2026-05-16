/** 并发 LLM 请求上限 */
export const LLM_CONCURRENCY = 3;

/** 单个 LLM 请求超时 (ms) */
export const LLM_REQUEST_TIMEOUT_MS = 60_000;

/** LLM rank 构建 prompt 时每个候选窗口前后采样的最大弹幕数 */
export const MAX_SURROUNDING_ITEMS = 10;

/** 刷屏检测滑动窗口宽度 (秒) */
export const BRUSH_WINDOW_SEC = 10;

/** 刷屏检测每个窗口内采样对数上限 (控制 O(n^2) 代价) */
export const MAX_BRUSH_SAMPLE = 80;

/** 刷屏检测候选窗口内 brushFrequency 计算采样上限 */
export const MAX_BRUSH_FREQ_SAMPLE = 150;

/** ASR 音频片段在 clip 边界两侧的 padding (秒) */
export const ASR_PADDING_SEC = 3;

/** 内容理解 (ASR + 帧描述) 并发度 */
export const ASR_CONCURRENCY = 3;

/** 帧提取并发 ffmpeg 进程数上限 */
export const FRAME_CONCURRENCY = 3;

/** 单帧提取超时 (ms) */
export const FRAME_EXTRACT_TIMEOUT_MS = 30_000;

/** prompt 注入防护: 文本最大长度 (字符) */
export const PROMPT_MAX_LENGTH = 200;

/** Maximum characters allowed in a user-supplied regex filter pattern to prevent ReDoS */
export const MAX_REGEX_PATTERN_LENGTH = 100;
