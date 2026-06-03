# T06-SUMMARY — 前端 EvidencePanel.vue + Master-Detail 布局

- **Task ID**: T06
- **状态**: ✅ 完成
- **日期**: 2026-06-02

## 产出

### EvidencePanel.vue（新组件，370 行）

- Props: `clip: ClipWithEvidence | null`
- 三种渲染状态：无选中 → n-empty / 无证据 → n-empty + 降级文字 / 有证据 → 完整 5 类面板
- 密度曲线图：Canvas 自绘，绿色柱状图 + 橙色密度折线，读取 CSS 变量，响应 DPR
- 信号检测详情：n-descriptions 2 列（实际密度 / 阈值 / 信号来源 / 合并窗口数）
- 边界精修对比：n-card small × N，原始范围灰色删除线 → 精修后绿色粗体 + 原因
- LLM 评分卡片：n-card small × N，n-tag 显示高光/非高光 + 分数 + 类型 + 理由 + 标签
- 触发弹幕列表：时间戳 + 用户名 + 内容，最多显示 50 条 + "还有 N 条"
- 格式辅助：`fmtTime(sec)` → `m:ss`
- 响应式：`@media (max-width: 900px)` 调整图表高度

### Index.vue（修改）

- 新增 `selectedClipId` ref + `selectedClip` computed
- 新增 `EvidencePanel` import
- n-data-table 添加 row-props：选中行背景 + 左边框 3px 高亮 + onClick 设置 selectedClipId
- 页面布局改为 master-detail：`.list-panel` (flex: 0 0 44%) + `.detail-panel` (flex: 1)
- 响应式：≤900px 切换为上下布局

## 验证

- ✅ `vue-tsc --noEmit` 通过（无 Evidence/EvidencePanel 相关类型错误）
- ⚠️ MANUAL 验证待 T07 阶段启动 Electron app 确认渲染效果

## 遵循

- 全部使用 CSS 变量（无硬编码 hex）
- 零外部图表依赖（Canvas 自绘）
- Naive UI 组件优先（n-card / n-empty / n-descriptions / n-tag）
- 无 emoji 图标
- UI-DESIGN.md § 3/§ 4/§ 5 全部 do/don't 满足
