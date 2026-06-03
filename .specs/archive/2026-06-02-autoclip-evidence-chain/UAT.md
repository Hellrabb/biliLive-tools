# UAT — autoclip-evidence-chain

> 日期：2026-06-02

## 自动化验证

| 检查项                           | 结果                            |
| -------------------------------- | ------------------------------- |
| 全量单测 `pnpm run test`         | ✅ 51/52 passed, 910/916 passed |
| 基础包构建 `pnpm run build:base` | ✅ 成功                         |
| 类型检查 `vue-tsc --noEmit`      | ✅ 通过                         |
| HTTP 包类型检查 `tsc --noEmit`   | ✅ 通过                         |

## 人工 UAT

### UAT-1：EvidencePanel 完整渲染

1. 启动 Electron app：`pnpm run dev`
2. 导航到「自动切片管理」页面
3. 确认切片列表中存在含 evidence 数据的切片（需先跑一次 autoclip 分析）
4. 点击该切片行
5. 验证右侧 EvidencePanel 渲染：
   - 密度曲线图（Canvas 柱状图+折线）
   - 信号检测详情（密度/阈值/来源）
   - 边界精修对比（如有）
   - LLM 评分卡片
   - 触发弹幕列表

**结果**：_待用户手动验证_

### UAT-2：无证据降级展示

1. 选中一个旧切片（evidence 为 null）
2. 验证 EvidencePanel 显示 "暂无决策证据" + 原因文字

**结果**：_待用户手动验证_

### UAT-3：无选中状态

1. 确保页面加载后无自动选中行
2. 验证 EvidencePanel 显示 "请选择一个切片查看证据"

**结果**：_待用户手动验证_
