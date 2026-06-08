/**
 * 模板变量渲染工具。
 * 项目级模板变量统一用 `{{camelCaseVar}}` 格式，`replaceAll` 替换。
 * 不引入 ejs/handlebars——理由见 DESIGN.md 决策 2。
 */

/** 模板变量上下文 */
export interface TemplateContext {
  /** LLM 生成的高光标题 */
  highlightTitle: string;
  /** 录制直播间名称 */
  roomName: string;
  /** 录制日期 YYYY-MM-DD */
  date: string;
  /** 上传日期 YYYY-MM-DD */
  uploadDate: string;
}

/**
 * 对模板字符串做变量替换。
 * 未识别的 `{{unknown}}` 原样保留不替换。
 * 变量值为 null/undefined 时替换为空字符串。
 *
 * @param template - 含 `{{var}}` 占位符的模板字符串
 * @param vars - 变量名 → 值的映射（不含双花括号）
 * @returns 替换后的字符串
 */
export function applyTemplateVariables(
  template: string,
  vars: Record<string, string | undefined>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value ?? "");
  }
  return result;
}

/**
 * 对 TemplateContext 做标题模板渲染并截断到 B站 80 字符限制。
 */
export function renderTitleTemplate(template: string, ctx: TemplateContext): string {
  return applyTemplateVariables(template, {
    highlightTitle: ctx.highlightTitle,
    roomName: ctx.roomName,
    date: ctx.date,
    uploadDate: ctx.uploadDate,
  })
    .trim()
    .slice(0, 80);
}

/**
 * 对 TemplateContext 做简介模板渲染。
 */
export function renderDescTemplate(template: string, ctx: TemplateContext): string {
  return applyTemplateVariables(template, {
    highlightTitle: ctx.highlightTitle,
    roomName: ctx.roomName,
    date: ctx.date,
    uploadDate: ctx.uploadDate,
  }).trim();
}
