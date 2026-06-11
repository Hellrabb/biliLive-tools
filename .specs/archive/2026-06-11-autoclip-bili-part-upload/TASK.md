# TASK: autoclip B站上传改为同一稿件分P

- **Change ID**: `autoclip-bili-part-upload`
- **关联**: `@.specs/autoclip-bili-part-upload/REQUIREMENT.md`、`@.specs/autoclip-bili-part-upload/DESIGN.md`

---

## 波次划分

```
Wave 1: T01（单任务，无并行）
```

---

## 任务清单

```xml
<task id="T01" parallel="false" status="pending">
  <name>重构 uploadToBili：聚合切片为分P上传</name>
  <read_files>
    packages/shared/src/autoClip/service.ts
    packages/shared/src/task/bili.ts
    packages/shared/src/autoClip/exportPipeline.ts
  </read_files>
  <write_files>
    packages/shared/src/autoClip/service.ts
  </write_files>
  <action>
    修改 `uploadToBili` 方法，将逐切片循环调用 `addMedia` 改为聚合批量调用。

    具体点：
    1. 将 for-of 循环改为：先遍历 exportedResults 构建 `videos` 数组（每个元素 { path, title }），
       再一次性调用 `biliApi.addMedia(videos, options, uid)`。
    2. 分P标题逻辑（见 D3）：每个分P的 title 默认用 highlight.title；
       若 presetConfig.export.biliUpTemplate.partTitleTemplate 非空，则用模板渲染。
    3. 封面逻辑（见 D2）：只截取第一个切片（exportedResults[0]）的 bestRange 中点帧；
       摘除循环内逐切片截帧的代码。
    4. 稿件主标题（见 D4）：titleTemplate 中的 {{highlightTitle}} 变量取第一个切片的标题。
    5. 调整日志文案：`已添加 ${exportedResults.length} 个B站上传任务`
       → `已添加 1 个B站上传任务（含 ${exportedResults.length} 个分P）`。
    6. 保留现有的 cover 手动路径回退、optionalOverrides 收集、error handling 结构不变。

    沿用既有抽象：
    - biliApi.addMedia 从 `../task/bili.js` 导入（已支持多 video 数组分P）
    - sampleFrames 从 `./exportPipeline.js` 导入（封面截帧）
    - renderTitleTemplate / renderDescTemplate（service.ts 内已有）
  </action>
  <verify>cd packages/shared && npx tsc --noEmit</verify>
  <done>AC-1（多切片→单稿件分P）、AC-2（titleTemplate 标题）、AC-3（分P标题）、AC-4（封面第一切片截帧）、AC-5（单切片降级单P）全部满足</done>
  <depends_on></depends_on>
</task>
```

---

## 状态字段说明

- `status="pending"` — 未开始
- `status="in_progress"` — 进行中
- `status="done"` — 已完成（verify 通过）

---

## 阻塞日志

| 任务 | 阻塞原因 | 待人工决策项 | 时间 |
| ---- | -------- | ------------ | ---- |
|      |          |              |      |

---

## Fix 任务（来自 REVIEW / INTEGRATION）

```xml
<!-- 占位 -->
```
