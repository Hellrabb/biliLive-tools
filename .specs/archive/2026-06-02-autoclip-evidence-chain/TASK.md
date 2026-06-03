# TASK — autoclip-evidence-chain

> 来源：REQUIREMENT.md + DESIGN.md + UI-DESIGN.md
> 当前分支 WIP commit：7a2c7506（需清理，含不相关文件）

## 波次图

```
Wave 1 (parallel): T01[P]                          ← 类型基础（所有任务依赖）
Wave 2 (parallel): T02[P] + T03[P] + T04[P]        ← 独立后端模块
Wave 3 (parallel): T05[P](→T02,T03) + T06[P](→T04) ← pipeline 集成 + API
Wave 4 (parallel): T07[P](→T05,T06)                 ← 前端
Wave 5:            T08(→全部)                       ← 测试 + 收尾
```

---

<task id="T01" parallel="true">
  <name>类型定义 + evidence.ts：新增 Evidence/BoundaryRefinement/DensityBucket 接口 + buildEvidence 函数</name>
  <read_files>
    packages/shared/src/autoClip/types.ts
    packages/shared/src/autoClip/signalDetector.ts（确认 DensityBucket 字段）
    packages/shared/src/autoClip/boundaryRefiner.ts（确认 BoundaryRefinement 字段）
  </read_files>
  <write_files>
    packages/shared/src/autoClip/types.ts
    packages/shared/src/autoClip/evidence.ts
  </write_files>
  <action>
    1. types.ts：新增 BoundaryRefinement、Evidence 接口；AutoClipResult 加 evidence?: Evidence
    2. evidence.ts（新文件）：实现 buildEvidence(params) 纯函数
       - 接收 densityBuckets / highlights / refinements / triggerDanmaku / signalDetails
       - 从 highlights 提取 llmScores（score/highlightType/reason/tags/isHighlight）
       - 组装并返回 Evidence 对象
       - 导出供 pipeline.ts 调用
    3. 可选导出 DensityBucket（或直接在 signalDetector.ts 中定义）
  </action>
  <verify>cd packages/shared && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "error|Error" | grep -i evidence || echo "TS OK"</verify>
  <done>TS 编译无类型错误；Evidence 接口含 5 类证据字段；buildEvidence 单元可调用</done>
  <depends_on></depends_on>
</task>

<task id="T02" parallel="true">
  <name>signalDetector + boundaryRefiner：返回值加证据数据（DensityBucket[] + BoundaryRefinement[]）</name>
  <read_files>
    packages/shared/src/autoClip/signalDetector.ts
    packages/shared/src/autoClip/boundaryRefiner.ts
    packages/shared/src/autoClip/types.ts
    packages/shared/test/autoClip/signalDetector.test.ts
    packages/shared/test/autoClip/boundaryRefiner.test.ts
  </read_files>
  <write_files>
    packages/shared/src/autoClip/signalDetector.ts
    packages/shared/src/autoClip/boundaryRefiner.ts
    packages/shared/test/autoClip/signalDetector.test.ts
    packages/shared/test/autoClip/boundaryRefiner.test.ts
  </write_files>
  <action>
    **signalDetector.ts**：
    - detectDanmakuDensityPeaks 返回值从 TimeWindow[] 改为 { windows: TimeWindow[]; buckets: DensityBucket[] }
    - 在计算过程中构建 DensityBucket 数组（已有 counts 数组，只需映射为 DensityBucket）
    - 新增 DensityBucket 接口导出

    **boundaryRefiner.ts**：
    - refineBoundaries 返回值从 HighlightSegment[] 改为 { highlights: HighlightSegment[]; refinements: BoundaryRefinement[] }
    - LLM 调整结果应用到 highlights 前，先保存原始边界
    - 构建 refinements 数组：每个 highlight 的原始 vs 精修后对比 + 调整原因
    - LLM 调用失败或跳过时 refinements = []

    **测试更新**：
    - signalDetector.test.ts：更新断言，解构 { windows, buckets }
    - boundaryRefiner.test.ts：更新断言，解构 { highlights, refinements }

  </action>
  <verify>cd packages/shared && pnpm run test -- autoClip/signalDetector.test.ts autoClip/boundaryRefiner.test.ts</verify>
  <done>两个测试文件全部通过；返回值包含 buckets/refinements 且数据正确</done>
  <depends_on>T01</depends_on>
</task>

<task id="T03" parallel="true">
  <name>DB migration v6：auto_clip_results 表加 evidence TEXT 列</name>
  <read_files>
    packages/shared/src/db/autoClip.ts
    packages/shared/src/db/model/baseModel.ts
    packages/shared/test/autoClip/dbConstraint.test.ts
  </read_files>
  <write_files>
    packages/shared/src/db/autoClip.ts
    packages/shared/test/autoClip/dbConstraint.test.ts
  </write_files>
  <action>
    1. AutoClipResultRow 接口加 evidence: string | null 字段
    2. 新增 migration v6：ALTER TABLE auto_clip_results ADD COLUMN evidence TEXT
    3. 确保幂等：检查列是否已存在，存在则跳过
    4. upsertResult 无需修改（已有 spread + 字段映射）
    5. dbConstraint.test.ts：新增 evidence 列写入/读取/NULL 测试
  </action>
  <verify>cd packages/shared && pnpm run test -- autoClip/dbConstraint.test.ts</verify>
  <done>migration v6 执行成功；evidence 列可写入 JSON 字符串；NULL 值兼容；幂等重跑不报错</done>
  <depends_on>T01</depends_on>
</task>

<task id="T04" parallel="true">
  <name>pipeline.ts：证据数据捕获 + buildEvidence 调用</name>
  <read_files>
    packages/shared/src/autoClip/pipeline.ts
    packages/shared/src/autoClip/evidence.ts
    packages/shared/src/autoClip/types.ts
    packages/shared/src/autoClip/signalDetector.ts
    packages/shared/src/autoClip/boundaryRefiner.ts
    packages/shared/test/autoClip/pipeline.test.ts
  </read_files>
  <write_files>
    packages/shared/src/autoClip/pipeline.ts
    packages/shared/test/autoClip/pipeline.test.ts
  </write_files>
  <action>
    1. import buildEvidence from evidence.ts
    2. 信号检测后：捕获 evidenceDanmakuCurve（densityBuckets）+ evidenceTriggerDanmaku（从 candidates 提取弹幕样本）+ evidenceSignalDetails
    3. LLM 排序后：从 highlights 提取 llmScores
    4. 边界精修后：捕获 evidenceRefinements
    5. Pipeline 末尾：try/catch 包裹 buildEvidence() 调用，失败时 logger.warn + evidence = undefined
    6. 将 evidence 挂到返回的 AutoClipResult 上
    7. 更新 pipeline.test.ts：断言 result.evidence 包含预期字段
  </action>
  <verify>cd packages/shared && pnpm run test -- autoClip/pipeline.test.ts</verify>
  <done>pipeline 返回的 AutoClipResult.evidence 不为 undefined（正常路径）；evidence 含 5 类数据；buildEvidence 失败不阻塞 pipeline</done>
  <depends_on>T01, T02</depends_on>
</task>

<task id="T05" parallel="true">
  <name>service.ts + HTTP routes：evidence 持久化 + API 暴露</name>
  <read_files>
    packages/shared/src/autoClip/service.ts
    packages/http/src/routes/autoClip.ts
    packages/shared/src/autoClip/types.ts
    packages/shared/test/autoClip/service.test.ts
  </read_files>
  <write_files>
    packages/shared/src/autoClip/service.ts
    packages/http/src/routes/autoClip.ts
    packages/shared/test/autoClip/service.test.ts
  </write_files>
  <action>
    **service.ts**：
    - analyzeAndSave 中：result.evidence 存在时 JSON.stringify 写入 upsertResult 的 evidence 字段

    **routes/autoClip.ts**：
    - 新增 parseEvidenceSafe(raw) 辅助函数：try/catch JSON.parse，失败返回 null
    - GET /clips 响应中每行加 evidence: parseEvidenceSafe(r.evidence)
    - GET /clips/:id 响应加 evidence
    - POST /run 初始行加 evidence: null
    - 所有 GET 路由的 evidence 解析失败时 logger.warn 单行

    **service.test.ts**：
    - 验证 analyzeAndSave 后 DB 中 evidence 列非空（含有效 JSON）

  </action>
  <verify>cd packages/shared && pnpm run test -- autoClip/service.test.ts && cd ../../packages/http && pnpm run test 2>&1 | tail -5</verify>
  <done>service 测试通过（evidence 正确持久化）；HTTP 测试通过；API 返回 evidence 字段；损坏 JSON 返回 null</done>
  <depends_on>T03, T04</depends_on>
</task>

<task id="T06" parallel="true">
  <name>前端：EvidencePanel.vue 组件 + AutoClipManagement master-detail 布局</name>
  <read_files>
    packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue
    packages/app/src/renderer/src/assets/css/styles.less
    packages/shared/src/autoClip/types.ts（Evidence 接口参考）
  </read_files>
  <write_files>
    packages/app/src/renderer/src/pages/AutoClipManagement/components/EvidencePanel.vue
    packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue
  </write_files>
  <action>
    **EvidencePanel.vue**（新组件）：
    Props: clip: ClipRow | null（含 evidence 字段）
    渲染规则（按 UI-DESIGN.md § 3）：
    - clip === null → n-empty "请选择一个切片"
    - evidence === null → n-empty "暂无决策证据" + 原因文字
    - evidence 有数据：
      a) 密度曲线图：Canvas 元素 200px 高，绿色柱状图 + 橙色密度折线。读取 CSS 变量作为颜色
      b) 信号检测详情：n-descriptions 2列（密度/阈值/来源/窗口）
      c) 边界精修对比：n-card small × N（原始→精修 + 原因），原始范围灰色删除线
      d) LLM 评分卡片：n-card small × N，n-tag 显示分数/类型
      e) 触发弹幕列表：时间戳 + 用户 + 内容

    **Index.vue**：
    - 新增 selectedClipId ref + selectedClip computed
    - n-data-table 加 row-props：选中行背景+左边框高亮
    - 页面布局改为 master-detail（左侧表格 flex:1 + 右侧 EvidencePanel width:420px）
    - import EvidencePanel

    遵循 UI-DESIGN.md § 5：用 CSS 变量、Naive UI 组件、Canvas 自绘、无 emoji

  </action>
  <verify>cd packages/app && npx vue-tsc --noEmit 2>&1 | grep -i "evidence\|EvidencePanel" | head -5 || echo "TS OK"; echo "MANUAL: 启动 Electron app，打开 AutoClipManagement，点击切片行验证证据面板渲染"</verify>
  <done>EvidencePanel 组件渲染 5 类证据；无证据降级显示；行选中交互正常；TS 编译无错误</done>
  <depends_on>T05</depends_on>
</task>

<task id="T07" parallel="false">
  <name>WIP 分支清理 + 全量测试 + 收尾验证</name>
  <read_files>
    packages/shared/src/autoClip/
    packages/shared/test/autoClip/
    packages/http/src/routes/autoClip.ts
    packages/app/src/renderer/src/pages/AutoClipManagement/
  </read_files>
  <write_files>
  </write_files>
  <action>
    1. **WIP 提交清理**：git reset HEAD~1 --soft，仅 stage 证据链相关文件（约 20 个），不相关的还原
    2. 全量测试：pnpm run test
    3. 构建验证：pnpm run build:base
    4. 确认所有 8 条 AC 通过
    5. commit 为干净的功能提交（无无关文件）
  </action>
  <verify>pnpm run test && pnpm run build:base</verify>
  <done>全量测试通过（无回归）；build:base 成功；commit 仅含证据链相关文件；8 条 AC 全覆盖</done>
  <depends_on>T01, T02, T03, T04, T05, T06</depends_on>
</task>
