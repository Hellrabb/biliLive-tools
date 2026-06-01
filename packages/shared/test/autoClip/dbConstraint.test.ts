import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import AutoClipModel from "../../src/db/autoClip.js";

/**
 * DB Constraint tests for auto_clip_results table.
 *
 * Validates that the migration (v5) cleans existing dirty id data
 * and that subsequent inserts with NULL or empty id are rejected.
 */

function createOldSchema(db: DatabaseType) {
  // Simulate the pre-v5 table: id TEXT PRIMARY KEY but without STRICT,
  // and no explicit NOT NULL. KEY_PK alone means implicit NOT NULL in
  // SQLite, but we want to test that dirty data (already stored with
  // empty string) gets cleaned by the migration.
  db.exec(`
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
      first_title TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Create migration tracking table so AutoClipModel doesn't recreate
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_clip_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Mark migrations 1-4 as already applied (old DB)
  const insertMig = db.prepare(
    "INSERT OR IGNORE INTO auto_clip_schema_migrations (version) VALUES (?)",
  );
  [1, 2, 3, 4].forEach((v) => insertMig.run(v));
}

describe("auto_clip_results DB constraint", () => {
  let db: DatabaseType;
  let model: AutoClipModel;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  describe("migration v5: clean dirty ids", () => {
    it("cleans rows with empty string id", () => {
      createOldSchema(db);

      // Insert a row with empty id (bypassing PRIMARY KEY = NOT NULL)
      // In SQLite, TEXT PRIMARY KEY = NOT NULL, so empty string is NOT null.
      // But empty string breaks upsertResult ON CONFLICT(id).
      db.prepare(
        `
        INSERT INTO auto_clip_results (id, video_path, danmu_path, created_at)
        VALUES (?, ?, ?, ?)
      `,
      ).run("", "/v/test.mp4", "/d/test.xml", "2025-01-01T00:00:00Z");

      // Insert a clean row for comparison
      db.prepare(
        `
        INSERT INTO auto_clip_results (id, video_path, danmu_path, created_at)
        VALUES (?, ?, ?, ?)
      `,
      ).run("good-id-1", "/v/good.mp4", "/d/good.xml", "2025-01-01T00:00:00Z");

      // Verify dirty row exists
      const dirtyBefore = db
        .prepare("SELECT id FROM auto_clip_results WHERE id = ''")
        .all() as Array<{ id: string }>;
      expect(dirtyBefore).toHaveLength(1);

      // Initialize AutoClipModel — this runs createTable + runMigrations
      model = new AutoClipModel({ db });

      // After migration, empty id should be cleaned (not empty)
      const dirtyAfter = db
        .prepare("SELECT id FROM auto_clip_results WHERE id = ''")
        .all() as Array<{ id: string }>;
      expect(dirtyAfter).toHaveLength(0);

      // The cleaned row should have a 32-char hex id
      const allRows = db
        .prepare("SELECT id FROM auto_clip_results WHERE id != 'good-id-1'")
        .all() as Array<{ id: string }>;
      expect(allRows).toHaveLength(1);
      expect(allRows[0]!.id).toMatch(/^[0-9a-f]{32}$/);
    });

    it("cleans rows with NULL id", () => {
      // Create table where id allows NULL (no PRIMARY KEY constraint)
      // to simulate a truly broken state
      db.exec(`
        CREATE TABLE auto_clip_results (
          id TEXT,
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
          first_title TEXT,
          retry_count INTEGER NOT NULL DEFAULT 0
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS auto_clip_schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      const insertMig = db.prepare(
        "INSERT OR IGNORE INTO auto_clip_schema_migrations (version) VALUES (?)",
      );
      [1, 2, 3, 4].forEach((v) => insertMig.run(v));

      // Insert a row with NULL id
      db.prepare(
        `
        INSERT INTO auto_clip_results (id, video_path, danmu_path, created_at)
        VALUES (?, ?, ?, ?)
      `,
      ).run(null, "/v/null.mp4", "/d/null.xml", "2025-01-01T00:00:00Z");

      // Verify NULL row exists
      const nullBefore = db
        .prepare("SELECT id FROM auto_clip_results WHERE id IS NULL")
        .all() as Array<{ id: string }>;
      expect(nullBefore).toHaveLength(1);

      // Initialize AutoClipModel
      model = new AutoClipModel({ db });

      // After migration, no NULL ids
      const nullAfter = db
        .prepare("SELECT id FROM auto_clip_results WHERE id IS NULL")
        .all() as Array<{ id: string }>;
      expect(nullAfter).toHaveLength(0);

      // The cleaned row should have a 32-char hex id
      const cleaned = db.prepare("SELECT id FROM auto_clip_results").all() as Array<{ id: string }>;
      expect(cleaned).toHaveLength(1);
      expect(cleaned[0]!.id).toMatch(/^[0-9a-f]{32}$/);
    });

    it("migration is idempotent (safe to run twice)", () => {
      createOldSchema(db);

      // Insert clean data
      db.prepare(
        `
        INSERT INTO auto_clip_results (id, video_path, danmu_path, created_at)
        VALUES (?, ?, ?, ?)
      `,
      ).run("id-1", "/v/1.mp4", "/d/1.xml", "2025-01-01T00:00:00Z");

      // First initialization
      model = new AutoClipModel({ db });
      expect(
        db.prepare("SELECT COUNT(*) as c FROM auto_clip_results").get() as { c: number },
      ).toEqual({ c: 1 });

      // Second initialization should not break anything
      const model2 = new AutoClipModel({ db });
      expect(
        db.prepare("SELECT COUNT(*) as c FROM auto_clip_results").get() as { c: number },
      ).toEqual({ c: 1 });

      // Verify schema_migrations was not duplicated
      const migCount = db
        .prepare("SELECT COUNT(*) as c FROM auto_clip_schema_migrations")
        .get() as { c: number };
      expect(migCount.c).toBe(6); // versions 1-6
    });
  });

  describe("constraint enforcement after migration", () => {
    it("rejects insert with empty string id via direct SQL", () => {
      createOldSchema(db);

      // Pre-clean data
      db.prepare(
        `
        INSERT INTO auto_clip_results (id, video_path, danmu_path, created_at)
        VALUES (?, ?, ?, ?)
      `,
      ).run("clean-id", "/v/c.mp4", "/d/c.xml", "2025-01-01T00:00:00Z");

      // Run migration
      model = new AutoClipModel({ db });

      // After migration, inserting empty id should fail
      // (rebuilt table has explicit NOT NULL + CHECK(id != ''))
      expect(() => {
        db.prepare(
          `
          INSERT INTO auto_clip_results (id, video_path, danmu_path, created_at)
          VALUES (?, ?, ?, ?)
        `,
        ).run("", "/v/empty.mp4", "/d/empty.xml", "2025-01-01T00:00:00Z");
      }).toThrow();
    });

    it("rejects insert with NULL id via direct SQL", () => {
      createOldSchema(db);

      // Pre-clean data
      db.prepare(
        `
        INSERT INTO auto_clip_results (id, video_path, danmu_path, created_at)
        VALUES (?, ?, ?, ?)
      `,
      ).run("clean-id", "/v/c.mp4", "/d/c.xml", "2025-01-01T00:00:00Z");

      // Run migration
      model = new AutoClipModel({ db });

      expect(() => {
        db.prepare(
          `
          INSERT INTO auto_clip_results (id, video_path, danmu_path, created_at)
          VALUES (?, ?, ?, ?)
        `,
        ).run(null, "/v/null.mp4", "/d/null.xml", "2025-01-01T00:00:00Z");
      }).toThrow();
    });

    it("upsertResult continues to work with valid id", () => {
      createOldSchema(db);
      model = new AutoClipModel({ db });

      const validId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      model.upsertResult({
        id: validId,
        video_path: "/v/test.mp4",
        danmu_path: "/d/test.xml",
        recorder_id: "rec-1",
        preset_id: null,
        status: "pending",
        highlights: "[]",
        created_at: "2025-01-01T00:00:00Z",
        exported_at: null,
        uploaded_at: null,
        exported_paths: null,
        bili_aids: null,
        llm_fallback: 0,
        output_name: null,
        highlight_count: 0,
        first_title: null,
        retry_count: 0,
      });

      const row = db.prepare("SELECT * FROM auto_clip_results WHERE id = ?").get(validId) as any;
      expect(row).toBeTruthy();
      expect(row.id).toBe(validId);
      expect(row.video_path).toBe("/v/test.mp4");
    });
  });

  describe("new database (clean init)", () => {
    it("creates table with NOT NULL constraint on id", () => {
      // Fresh DB - no old schema
      model = new AutoClipModel({ db });

      // Verify table schema has NOT NULL on id
      const cols = db.prepare("PRAGMA table_info(auto_clip_results)").all() as Array<{
        name: string;
        notnull: number;
      }>;
      const idCol = cols.find((c) => c.name === "id");
      expect(idCol).toBeDefined();
      expect(idCol!.notnull).toBe(1);
    });

    it("upsertResult rejects empty id (throws SQLITE_CONSTRAINT_NOTNULL)", () => {
      model = new AutoClipModel({ db });

      expect(() => {
        model.upsertResult({
          id: "",
          video_path: "/v/test.mp4",
          danmu_path: "/d/test.xml",
          recorder_id: null,
          preset_id: null,
          status: "pending",
          highlights: "[]",
          created_at: "2025-01-01T00:00:00Z",
          exported_at: null,
          uploaded_at: null,
          exported_paths: null,
          bili_aids: null,
          llm_fallback: 0,
          output_name: null,
          highlight_count: 0,
          first_title: null,
          retry_count: 0,
        });
      }).toThrow();
    });
  });
});
