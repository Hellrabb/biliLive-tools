import BaseModel from "./model/baseModel.js";
import logger from "../utils/log.js";

import type { Database } from "better-sqlite3";

export interface AutoClipResultRow {
  id: string;
  video_path: string;
  danmu_path: string;
  recorder_id: string | null;
  preset_id: string | null;
  status: "pending" | "approved" | "exported" | "uploaded" | "deleted";
  highlights: string; // JSON string
  created_at: string;
  exported_at: string | null;
  uploaded_at: string | null;
  exported_paths: string | null; // JSON string
  bili_aids: string | null; // JSON string
}

export default class AutoClipModel extends BaseModel<AutoClipResultRow> {
  table = "auto_clip_results";

  constructor({ db }: { db: Database }) {
    super(db, "auto_clip_results");
    this.createTable();
    this.createIndexes();
  }

  createTable() {
    const sql = `
      CREATE TABLE IF NOT EXISTS auto_clip_results (
        id TEXT PRIMARY KEY,
        video_path TEXT NOT NULL,
        danmu_path TEXT NOT NULL,
        recorder_id TEXT,
        preset_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        highlights TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        exported_at TEXT,
        uploaded_at TEXT,
        exported_paths TEXT,
        bili_aids TEXT
      ) STRICT;
    `;
    super.createTable(sql);
    return true;
  }

  createIndexes() {
    try {
      const indexes = [
        {
          name: "idx_auto_clip_status",
          sql: `CREATE INDEX IF NOT EXISTS idx_auto_clip_status ON auto_clip_results(status)`,
        },
        {
          name: "idx_auto_clip_recorder",
          sql: `CREATE INDEX IF NOT EXISTS idx_auto_clip_recorder ON auto_clip_results(recorder_id)`,
        },
        {
          name: "idx_auto_clip_created",
          sql: `CREATE INDEX IF NOT EXISTS idx_auto_clip_created ON auto_clip_results(created_at)`,
        },
      ];
      for (const idx of indexes) {
        if (!this.checkIndexExists(idx.name)) {
          this.db.prepare(idx.sql).run();
          logger.info(`已创建索引: ${idx.name}`);
        }
      }
    } catch (error) {
      logger.error("创建 auto_clip_results 索引失败:", error);
    }
  }

  private checkIndexExists(indexName: string): boolean {
    const result = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='auto_clip_results' AND name=?`)
      .get(indexName);
    return !!result;
  }

  saveResult(row: AutoClipResultRow) {
    return this.insert(row);
  }

  getResults(filter?: {
    status?: string;
    recorderId?: string;
    limit?: number;
    offset?: number;
  }): { data: AutoClipResultRow[]; total: number } {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.status) {
      conditions.push("status = ?");
      params.push(filter.status);
    }
    if (filter?.recorderId) {
      conditions.push("recorder_id = ?");
      params.push(filter.recorderId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;

    const countSql = `SELECT COUNT(*) as total FROM auto_clip_results ${whereClause}`;
    const countResult = this.db.prepare(countSql).get(...params) as { total: number };

    const dataSql = `SELECT * FROM auto_clip_results ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const data = this.db.prepare(dataSql).all(...params, limit, offset) as AutoClipResultRow[];

    return { data, total: countResult.total };
  }

  getResultById(id: string): AutoClipResultRow | undefined {
    return this.db.prepare("SELECT * FROM auto_clip_results WHERE id = ?").get(id) as AutoClipResultRow | undefined;
  }

  updateStatus(id: string, status: string) {
    return this.db.prepare("UPDATE auto_clip_results SET status = ? WHERE id = ?").run(status, id);
  }

  markExported(id: string, exportedPaths: string[]) {
    return this.db
      .prepare("UPDATE auto_clip_results SET status = 'exported', exported_at = datetime('now'), exported_paths = ? WHERE id = ?")
      .run(JSON.stringify(exportedPaths), id);
  }

  markUploaded(id: string, biliAids: string[]) {
    return this.db
      .prepare("UPDATE auto_clip_results SET status = 'uploaded', uploaded_at = datetime('now'), bili_aids = ? WHERE id = ?")
      .run(JSON.stringify(biliAids), id);
  }

  deleteResult(id: string) {
    return this.db.prepare("UPDATE auto_clip_results SET status = 'deleted' WHERE id = ?").run(id);
  }
}
