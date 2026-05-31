import { Context, Next } from "koa";
import log from "@biliLive-tools/shared/utils/log.js";

interface BiliResponseError extends Error {
  code?: number;
  path?: string;
  method?: string;
  statusCode?: number;
  rawResponse?: unknown;
}

const errorMiddleware = async (ctx: Context, next: Next) => {
  try {
    await next();
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.status = 500;
    ctx.body = message;
    ctx.app.emit("error", error, ctx);
    if (error.name === "BiliResponseError") {
      const biliErr = error as BiliResponseError;
      log.error(
        `[BiliResponseError] code=${biliErr.code} status=${biliErr.statusCode} ${biliErr.method?.toUpperCase()} ${biliErr.path} message="${biliErr.message}"`,
      );
    } else {
      log.error(error);
    }
  }
};
export default errorMiddleware;
