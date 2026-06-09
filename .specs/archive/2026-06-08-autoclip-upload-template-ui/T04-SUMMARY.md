# T04-SUMMARY · uploadToBili 改写 + 封面自动提取

> 日期：2026-06-08
> 状态：done

## 做了什么

1. 数据源切换：`uploadToBili()` 从 `presetConfig.export.biliUpTemplate` 读取模板配置，删除 videoPreset "autoClip" 查找逻辑
2. 模板渲染：调用 `renderTitleTemplate` / `renderDescTemplate` 替换变量
3. 封面自动提取：cover 为空时从 `bestRange` 中点采样一帧，保存到切片同目录
4. 向后兼容：`biliUpTemplate` 未配置时字段级回退 `DEFAULT_BILIUP_CONFIG`

## 改动的文件

- `packages/shared/src/autoClip/service.ts` (+73, -19)

## verify 输出

```
npx tsc --noEmit -p tsconfig.json → 无错误
```

## 6 维自查

✅ 沿用既有抽象 grep（R6.4）：

- 模板渲染：T02 新建的 `templateRenderer.ts` → 沿用
- 帧提取：`frameSampler.ts` 已有 `sampleFrames()` → 沿用
- B站上传：`task/bili.ts` 已有 `addMedia()` → 沿用
- 默认值：`videoPreset.ts` `DEFAULT_BILIUP_CONFIG` → 沿用作为 fallback

✅ 破坏性变更（R6.4）：未命中（修改方法内部实现，`uploadToBili()` 是 private 方法，外部调用签名不变）

✅ 越界检查（R6.5）：

- TASK write_files：1 项
- 实际 diff：1 项
- 越界：0
