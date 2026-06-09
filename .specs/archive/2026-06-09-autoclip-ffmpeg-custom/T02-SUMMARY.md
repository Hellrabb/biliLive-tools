# T02 完成摘要 — Home 页面支持 ?tab= 查询参数

- **AC 覆盖**：AC-5 前置条件
- **修改文件**：`packages/app/src/renderer/src/pages/Home/index.vue`
- **验证**：`typecheck` 通过（`node` + `web`）

## 改动

1. **Import**：添加 `import { useRoute } from "vue-router"`（line 168）

2. **`route` 实例**：`const route = useRoute()`（line 187）

3. **`activeTab` ref**（line 197）：`const activeTab = ref("common-setting")`

4. **`watchEffect`**（line 199-207）：
   - 读取 `route.query.tab`
   - 白名单校验：`common-setting` / `upload-setting` / `danmukufactory-setting` / `ffmpeg-setting`
   - query 有效 → 覆盖 `activeTab`；query 为空 → 不覆盖（走默认）

5. **模板**：`<n-tabs>` 加 `v-model:value="activeTab"`（line 20）

## 跳转测试

从 AutoClip 对话框点击"编辑此预设 →"：

```
router.push({ path: '/home', query: { tab: 'ffmpeg-setting' } })
```

→ URL 变为 `/#/home?tab=ffmpeg-setting` → Home 页面自动切换到 ffmpeg 设置 tab
