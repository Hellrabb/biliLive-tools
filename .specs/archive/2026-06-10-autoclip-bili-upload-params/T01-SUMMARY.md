# T01-SUMMARY — 扩展 BiliUpTemplateConfig 类型 + JSDoc

- **Change**: autoclip-bili-upload-params
- **Task**: T01
- **日期**: 2026-06-10

## 做了什么

将 `BiliUpTemplateConfig` 从 8 字段扩展为覆盖 `BiliupConfig` 全部适用字段（22+ 字段），全部新增字段标记为 optional。补充每个字段的 JSDoc 注释（约束、默认值、格式说明）。

### 改动文件

- `packages/types/src/index.ts`（+56 −5）

### 新增字段

`partTitleTemplate`, `dolby`, `hires`, `dynamic`, `watermark`, `openElec`, `closeDanmu`, `closeReply`, `selectiionReply`, `autoComment`, `commentTop`, `comment`, `no_disturbance`, `recreate`, `dtime`, `is_only_self`, `space_hidden`, `seasonId`, `sectionId`, `topic_name`, `mission_id`, `human_type2`

### 保留的 autoclip 特有字段

`titleTemplate`（模板变量替换）, `descTemplate`（模板变量替换）—— 对应 `BiliupConfig.title` / `BiliupConfig.desc`，但 autoclip 使用模板语法，不可互换。

## verify 输出

```
$ cd packages/types && pnpm run build
> @biliLive-tools/types@3.13.1 build
> tsc
```

✅ 构建通过，无类型错误。

## 6 维自查（R6.4）

- ✅ 沿用既有抽象 grep：N/A（类型定义扩展，无逻辑代码）
- ✅ R2 变更传播：仅修改 `BiliUpTemplateConfig` 接口，`AutoClipExportConfig` 引用路径不变
- ✅ R1 认知过载：新增字段按分组注释（autoclip 特有 / 对齐 BiliupConfig），结构清晰
- ✅ R6 领域扭曲：字段名与 BiliupConfig 完全一致，JSDoc 注释对齐官方语义

## 破坏性变更（R4.6）

- 未命中 → 跳过。仅新增 optional 字段，完全向后兼容。

## 越界检查（R6.5）

- ✅ TASK write_files：`packages/types/src/index.ts`
- ✅ 实际 diff：`packages/types/src/index.ts`
- ✅ 越界：0
