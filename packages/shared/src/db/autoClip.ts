import BaseModel from "./model/baseModel.js";
import logger from "../utils/log.js";

import type { Database } from "better-sqlite3";

export interface AutoClipResultRow {
  id: string;
  video_path: string;
  danmu_path: string;
  recorder_id: string | null;
  preset_id: string | null;
  status: "analyzing" | "pending" | "approved" | "exporting" | "exported" | "uploaded" | "failed" | "deleted";
  highlights: string; // JSON string
  created_at: string;
  exported_at: string | null;
  uploaded_at: string | null;
  exported_paths: string | null; // JSON string
  bili_aids: string | null; // JSON string
  llm_fallback: number;     // 0 or 1
  output_name: string | null; // custom naming prefix for manual clip
  highlight_count: number;
  first_title: string | null;
}

export default class AutoClipModel extends BaseModel<AutoClipResultRow> {
  table = "auto_clip_results";

  constructor({ db }: { db: Database }) {
    super(db, "auto_clip_results");
    this.createTable();
    this.createIndexes();
    this.runMigrations();
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
        bili_aids TEXT,
        llm_fallback INTEGER NOT NULL DEFAULT 0,
        output_name TEXT,
        highlight_count INTEGER NOT NULL DEFAULT 0,
        first_title TEXT
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

  private runMigrations() {
    // Ensure migration tracking table exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auto_clip_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    const applied = new Set(
      (this.db.prepare("SELECT version FROM auto_clip_schema_migrations").all() as Array<{ version: number }>)
        .map(r => r.version)
    );

    const migrations: Array<{ version: number; name: string; sql: string }> = [
      {
        version: 1,
        name: "add_llm_fallback",
        sql: `ALTER TABLE auto_clip_results ADD COLUMN llm_fallback INTEGER NOT NULL DEFAULT 0`,
      },
      {
        version: 2,
        name: "add_output_name",
        sql: `ALTER TABLE auto_clip_results ADD COLUMN output_name TEXT`,
      },
      {
        version: 3,
        name: "add_highlight_count_and_first_title",
        sql: `ALTER TABLE auto_clip_results ADD COLUMN highlight_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auto_clip_results ADD COLUMN first_title TEXT`,
      },
    ];

    for (const m of migrations) {
      if (!applied.has(m.version)) {
        try {
          // Check if column already exists (idempotent for DBs that ran the old ad-hoc migration)
          const cols = this.db.prepare("PRAGMA table_info(auto_clip_results)").all() as Array<{ name: string }>;
          if (cols.some(c => c.name === "llm_fallback") && m.name === "add_llm_fallback") {
            // Column already exists from old ad-hoc migration, just record version
          } else if (cols.some(c => c.name === "output_name") && m.name === "add_output_name") {
            // Column already exists (idempotent)
          } else {
            this.db.exec(m.sql);
          }
          this.db.prepare("INSERT INTO auto_clip_schema_migrations (version) VALUES (?)").run(m.version);
          logger.info(`AutoClip: applied migration v${m.version} — ${m.name}`);
        } catch (error) {
          logger.error(`AutoClip: migration v${m.version} (${m.name}) failed`, error);
        }
      }
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

  upsertResult(row: AutoClipResultRow) {
    let highlightCount = 0;
    let firstTitle: string | null = null;
    try {
      const parsed = JSON.parse(row.highlights);
      if (Array.isArray(parsed) && parsed.length > 0) {
        highlightCount = parsed.length;
        firstTitle = parsed[0]?.title || null;
      }
    } catch { /* keep defaults */ }

    const sql = `
      INSERT INTO auto_clip_results (
        id, video_path, danmu_path, recorder_id, preset_id,
        status, highlights, created_at, llm_fallback, output_name,
        highlight_count, first_title,
        exported_at, uploaded_at, exported_paths, bili_aids
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
      ON CONFLICT(id) DO UPDATE SET
        video_path = excluded.video_path,
        danmu_path = excluded.danmu_path,
        recorder_id = excluded.recorder_id,
        preset_id = excluded.preset_id,
        status = excluded.status,
        highlights = excluded.highlights,
        llm_fallback = excluded.llm_fallback,
        output_name = excluded.output_name,
        highlight_count = excluded.highlight_count,
        first_title = excluded.first_title,
        exported_at = NULL,
        uploaded_at = NULL,
        exported_paths = NULL,
        bili_aids = NULL
    `;
    return this.db.prepare(sql).run(
      row.id, row.video_path, row.danmu_path, row.recorder_id, row.preset_id,
      row.status, row.highlights, row.created_at,
      row.llm_fallback, row.output_name ?? null,
      highlightCount, firstTitle,
    );
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
    } else {
      conditions.push("status != 'deleted'");
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

  getStatusCounts(): { all: number; pending: number; analyzing: number; approved: number; exporting: number; exported: number; uploaded: number; failed: number } {
    const rows = this.db
      .prepare("SELECT status, COUNT(*) as count FROM auto_clip_results WHERE status != 'deleted' GROUP BY status")
      .all() as Array<{ status: string; count: number }>;

    const counts = { all: 0, pending: 0, analyzing: 0, approved: 0, exporting: 0, exported: 0, uploaded: 0, failed: 0 };
    for (const row of rows) {
      if (row.status in counts) {
        (counts as any)[row.status] = row.count;
      }
      counts.all += row.count;
    }
    return counts;
  }
}
