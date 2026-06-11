# CHANGE: 非审批模式自动切片结果在管理列表不可见

- **Change ID**: fix-autoclip-nonapproval-list
- **创建日期**: 2026-06-10
- **路径建议**: 最短（已实现，补 artifact + review + 归档）
- **状态**: active

---

## Why（为什么做）

`autoClipReviewMode = false`（非审批模式）时，自动切片结果在 AutoClipManagement 页面列表中不可见。用户只能通过任务队列中出现的"压制任务"间接确认切片已执行。

根因有三个：

1. 状态筛选 radio-group 缺少 `"approved"` 选项——非审批模式下 clip 状态为 `"approved"`，但筛选栏没有对应 tab
2. `<keep-alive>` 缓存导致页面切回时数据不刷新——只有 `onMounted` 没有 `onActivated`
3. "确认导出"按钮仅对 `"pending"` 状态显示——`"approved"` 状态 clip 缺少操作入口

## What（做什么）

修复 AutoClipManagement 页面的三个 UI 缺陷，确保非审批模式下的切片结果可正常查看和操作。

## 视觉调性

不适用（bug 修复，无新增 UI 设计）。

## 影响面

- [ ] 影响 `REQUIREMENT.md`
- [ ] 影响 `DESIGN.md` / 引入新 ADR
- [ ] 影响现有 AC
- [ ] 影响数据模型 / 迁移
- [ ] 影响外部 API 兼容性
- [x] 仅修复 bug，无范围变化

## 范围排除（这次不做）

- 不修改后端 API（`/clips`、`/approve-and-export`、`/re-export` 端点均无需改动）
- 不修改 `autoClipReviewMode` 默认值或语义
- 不改动 AutoClipManagement 以外的页面

## 验收线

1. 非审批模式下完成自动切片后，在 AutoClipManagement 页面"已批准" tab 可见结果
2. 从其他页面切回 AutoClipManagement 时，数据自动刷新（无需手动点"刷新"）
3. `"approved"` 状态 clip 显示"重新导出"按钮，点击后可正常导出

## 风险与未知

- `reExportClip` API 函数是新增的前端封装，依赖后端已有的 `/re-export` 端点（已存在，无后端改动）
