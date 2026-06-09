# REVIEW: 修复 AutoClip 导出设置中 FFmpeg 编辑预设按钮无响应

- **Change ID**: fix-autoclip-ffmpeg-edit-preset
- **审查日期**: 2026-06-10
- **审查人**: AI Reviewer (6-review path B — 未装 brooks-lint)

## 变更摘要

| 文件                                                                | 改动                                                                             |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue` | 模板 L298: 按钮 `@click` 从内联 `router.push(...)` 改为调用 `editFfmpegPreset()` |
| 同上                                                                | 脚本 L739-742: 新增 3 行函数 `editFfmpegPreset()`                                |

```diff
- @click="router.push({ path: '/home', query: { tab: 'ffmpeg-setting' } })"
+ @click="editFfmpegPreset"

+ function editFfmpegPreset() {
+   visible.value = false;
+   router.push({ path: "/home", query: { tab: "ffmpeg-setting" } });
+ }
```

---

## 第一轮 · Spec 合规审查

| 验收线                                                | 实现                                         | 测试          | 判定 |
| ----------------------------------------------------- | -------------------------------------------- | ------------- | ---- |
| 点击「编辑此预设 →」→ 弹窗关闭 → 跳转到 FFmpeg 设置页 | `visible.value = false` + `router.push(...)` | UAT-1（手动） | ✅   |

- [x] 验收线已实现
- [x] 无范围蔓延（仅修改按钮 handler，未触及无关逻辑）
- [x] 未引入 CHANGE.md「范围排除」中禁止的内容
- [x] 未触动禁动清单中的模块

**结论**：✅ 第一轮通过。

---

## 第二轮 · 代码质量审查（6 维衰退风险）

### 🟢 R1 · Cognitive Overload 认知过载

**Symptom**: 无。新增函数 3 行，命名 `editFfmpegPreset` 直接表达意图（编辑 FFmpeg 预设）。
**Source**: McConnell · Code Complete · Ch5 "Design in Construction" — 好名字消除认知负担。
**Consequence**: N/A。
**Remedy**: N/A。

### 🟢 R2 · Change Propagation 变更传播

**Symptom**: 无。变更完全局限在 `AutoClipPresetDialog.vue` 单文件内，不修改任何导出接口。
**Source**: Fowler · Refactoring · Divergent Change — 单一变更不应跨多个模块。
**Consequence**: N/A。
**Remedy**: N/A。

### 🟢 R3 · Knowledge Duplication 知识重复

**Symptom**: 无。`editFfmpegPreset()` 是新增的唯一函数，没有在其他地方重复表达同一逻辑。
**Source**: Hunt & Thomas · Pragmatic Programmer · DRY 原则。
**Consequence**: N/A。
**Remedy**: N/A。

### 🟢 R4 · Accidental Complexity 偶然复杂

**Symptom**: 无。原代码在模板内联 `router.push({ path: '/home', query: { tab: 'ffmpeg-setting' } })`，现在提取为命名函数，加上关闭弹窗逻辑。代码**比原来更简洁**（模板从 5 行缩为 1 行），是减法而非加法。
**Source**: Brooks · Mythical Man-Month · "Accidental vs Essential Complexity"。
**Consequence**: N/A。
**Remedy**: N/A。

### 🟢 R5 · Dependency Disorder 依赖混乱

**Symptom**: 无。函数使用 `visible`（`defineModel` prop）和 `router`（`useRouter()`），都是 Vue 3 标准依赖，依赖方向正确（UI 组件 → Vue Router）。
**Source**: Martin · Clean Architecture · Dependency Rule。
**Consequence**: N/A。
**Remedy**: N/A。

### 🟢 R6 · Domain Model Distortion 领域扭曲

**Symptom**: 无。`editFfmpegPreset` 命名清晰映射业务意图：编辑 FFmpeg 预设。
**Source**: Evans · DDD · Ubiquitous Language。
**Consequence**: N/A。
**Remedy**: N/A。

**结论**：✅ 第二轮通过。6 个维度均未发现问题。

---

## 第三轮 · UI 视觉审查

变更仅涉及按钮的 `@click` handler，**无视觉变化**（相同按钮文案、相同 `type="info"`、相同 `text` 样式）。

- [x] 无硬编码颜色/字号/间距
- [x] 无新增 UI 组件
- [x] 无 UI anti-pattern 引入

**结论**：✅ 第三轮通过（纯行为变更，无视觉影响）。

---

## 第四轮 · 补充审查

- **4.1 技术债评估**：❌ 未命中触发条件（非里程碑/大版本，CONTEXT.md 技术债段 5 天内更新过）。
- **4.2 跨模型 spot-check**：❌ 未命中触发条件（无安全/并发变更，无函数 > 80 行）。

---

## 总结

| 轮次              | 结果 | Critical | Major | Minor |
| ----------------- | ---- | -------- | ----- | ----- |
| 第一轮 · Spec     | ✅   | 0        | 0     | 0     |
| 第二轮 · 代码质量 | ✅   | 0        | 0     | 0     |
| 第三轮 · UI       | ✅   | 0        | 0     | 0     |
| 第四轮 · 补充     | 跳过 | —        | —     | —     |

**审查结论**：✅ 全部通过。无修复任务。可进入 7-integration。
