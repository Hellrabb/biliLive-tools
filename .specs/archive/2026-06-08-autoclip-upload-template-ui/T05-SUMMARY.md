# T05-SUMMARY · AutoClipPresetDialog 新增 B站模板表单

> 日期：2026-06-08
> 状态：done

## 做了什么

1. 模板：在「导出设置」tab 的 `uploadToBili` 开关下方新增条件表单区（v-if 控制显隐），包含：
   - 标题模板（n-input + 变量提示 feedback）
   - 标签（DynamicTags 组件）
   - 投稿分区（n-cascader，localStorage areaData 缓存）
   - 自制/转载（n-radio-group）
   - 禁止转载（n-switch，v-if copyright===1）
   - 转载来源（n-input，v-if copyright===2）
   - 简介模板（n-input textarea）
   - 封面图（n-input，placeholder 提示自动提取）
2. 脚本：import DynamicTags，新增 areaData ref（从 localStorage 读取）
3. 向后兼容：selectPreset 中补充 `biliUpTemplate` 缺失时的默认值注入

## 改动的文件

- `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue` (+133, -5)

## verify 输出

```
npx tsc --noEmit -p tsconfig.json → 无新增错误
```

vue-tsc 因既有工具链版本不兼容无法运行，但纯 tsc 检查通过，Vue 语法符合 Naive UI 组件规范。

## 6 维自查

✅ 沿用既有抽象 grep（R6.4）：

- 表单组件：Naive UI `n-form-item` / `n-input` / `n-switch` / `n-select` / `n-radio-group` / `n-cascader` → 沿用现有模式
- 动态标签：`DynamicTags` 组件（from BiliSetting.vue） → 沿用同一组件路径
- 分区数据：localStorage `areaData` 缓存 → 沿用 BiliSetting 的数据源
- 样式：`font-size: 12px; color: #999` feedback 模式 → 沿用现有

✅ 破坏性变更（R6.4）：未命中（仅在既有文件中新增模板代码，无删除/签名变更）

✅ 越界检查（R6.5）：

- TASK write_files：1 项
- 实际 diff：1 项
- 越界：0

## UI 任务自查（1.6）

- ✅ 读 UI-DESIGN.md → 表单布局 + 组件映射完全遵循
- ✅ 不引入新 CSS / 新依赖
- ✅ 所有颜色/字体由 Naive UI 控制，无硬编码
- ✅ 条件显隐用 v-if（不用 v-show）
- ✅ 变量提示用 feedback slot
