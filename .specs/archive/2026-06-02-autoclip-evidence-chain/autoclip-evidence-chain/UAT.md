# UAT — autoclip-evidence-chain

- **Change ID**: `autoclip-evidence-chain`
- **日期**: 2026-06-04

## 自动化验证（T07）

| 检查项                    | 结果                               |
| ------------------------- | ---------------------------------- |
| `pnpm run test`           | ✅ 910 passed, 0 failed, 6 skipped |
| `pnpm run build:base`     | ✅ EXIT_CODE=0                     |
| `vue-tsc --noEmit`        | ✅ 0 errors                        |
| Docker `backend` target   | ✅ 构建成功                        |
| Docker `fullstack` target | ✅ 构建成功                        |

## UAT 结果

### UAT-1 · 前端证据面板渲染 (AC-6)

**步骤**: 打开 AutoClipManagement → 点击含 evidence 数据的切片行 → 观察右侧 EvidencePanel

**结果**: ✅ 通过（修复 evidence 映射 bug 后）

**详情**: 初始部署时 EvidencePanel 显示"暂无决策证据"。排查发现 `Index.vue` 的 `refreshList()` 在构造 `ClipRow` 时丢弃了 `evidence` 字段。修复后证据面板正常渲染 5 类证据数据。

**修复提交**: `fix: pass evidence field through ClipRow mapping in refreshList`

### UAT-2 · 无证据降级展示 (AC-7)

**步骤**: 点击旧切片（evidence 为 null）→ 观察 EvidencePanel

**结果**: ✅ 通过

**详情**: EvidencePanel 显示 "暂无决策证据" + "该切片在旧版本中分析，未保存证据链数据" 降级提示文字，无报错无白屏。

### UAT-3 · 左右分栏布局 (UI)

**步骤**: 调整浏览器宽度，观察 master-detail 布局

**结果**: ✅ 修复后通过

**详情**: 初始版本左侧 44% 固定比例导致表格内容溢出覆盖右侧面板。修复为左侧 `flex: 1` + `overflow: auto`，右侧固定 420px，并添加高度约束。

**修复提交**: `fix: prevent master-detail layout overlap in AutoClipManagement`

## AC 覆盖总结

| AC   | 描述                    | 验证方式               | 结果 |
| ---- | ----------------------- | ---------------------- | ---- |
| AC-1 | Pipeline 证据捕获完整性 | pipeline.test.ts       | ✅   |
| AC-2 | 证据链 DB 持久化        | dbConstraint.test.ts   | ✅   |
| AC-3 | DB Migration v6 幂等    | 重复启动               | ✅   |
| AC-4 | HTTP API 返回 evidence  | HTTP test suite        | ✅   |
| AC-5 | API 容错                | parseEvidenceSafe 测试 | ✅   |
| AC-6 | 前端证据面板渲染        | 手动 UAT               | ✅   |
| AC-7 | 无证据降级展示          | 手动 UAT               | ✅   |
| AC-8 | 构建与回归              | test + build:base      | ✅   |
