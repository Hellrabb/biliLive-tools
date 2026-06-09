# T02-SUMMARY · templateRenderer 模板渲染工具

> 日期：2026-06-08
> 状态：done

## 做了什么

新建 `packages/shared/src/autoClip/templateRenderer.ts`：

- `TemplateContext` 接口（4 字段：highlightTitle / roomName / date / uploadDate）
- `applyTemplateVariables()` — 通用 replaceAll 模板渲染
- `renderTitleTemplate()` — 标题渲染 + 80 字截断
- `renderDescTemplate()` — 简介渲染

## 改动的文件

- `packages/shared/src/autoClip/templateRenderer.ts` (+58 行，新文件)

## verify 输出

```
npx tsc --noEmit -p tsconfig.json → 无错误
```

## 6 维自查

✅ 沿用既有抽象 grep（R6.4）：

- 模板替换模式：webhook.ts:formatPartTitle() 有 `.replaceAll('{{var}}', val)` 模式 → 沿用（简化版，不用 ejs）
- 未找到其他同类模板渲染器 → 新建合理

✅ 破坏性变更（R6.4）：

- 未命中（纯新增文件，无删除/签名变更）

✅ 越界检查（R6.5）：

- TASK write_files：1 项（packages/shared/src/autoClip/templateRenderer.ts）
- 实际 diff：1 项
- 越界：0

## 数据库迁移

N/A
