import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

const dbDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const globalForDb = globalThis as unknown as { __sqlite?: Database.Database };

if (!globalForDb.__sqlite) {
  const sqlite = new Database(path.join(dbDir, "c-manage.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS keys (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE IF NOT EXISTS lines (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', auto_enabled INTEGER NOT NULL DEFAULT 0, auto_batch_size INTEGER NOT NULL DEFAULT 10, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY AUTOINCREMENT, line_id INTEGER NOT NULL, name TEXT NOT NULL, key_count INTEGER NOT NULL DEFAULT 0, cached_quota INTEGER NOT NULL DEFAULT 0, all_disabled_since INTEGER, frozen INTEGER NOT NULL DEFAULT 0, last_refresh INTEGER, imported_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, line_id INTEGER NOT NULL, message TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info', created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE IF NOT EXISTS channel_slots (id INTEGER PRIMARY KEY AUTOINCREMENT, line_id INTEGER NOT NULL, remote_channel_id INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '', total_quota INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL DEFAULT (unixepoch()));
  `);

  const lineCount = (sqlite.prepare("SELECT COUNT(*) as c FROM lines").get() as { c: number }).c;
  if (lineCount === 0) {
    sqlite.prepare("INSERT INTO lines (label, config) VALUES (?, ?)").run("线路1", JSON.stringify({
      baseUrl: "https://c.mrpoola.asia", authType: "session",
      authValue: "session=MTc4MTk0Njg0MHxEWDhFQVFMX2dBQUJFQUVRQUFEX2tQLUFBQVVHYzNSeWFXNW5EQVFBQW1sa0EybHVkQVFDQUFZR2MzUnlhVzVuREFvQUNIVnpaWEp1WVcxbEJuTjBjbWx1Wnd3SkFBZHJkVzVzYVdGdUJuTjBjbWx1Wnd3R0FBUnliMnhsQTJsdWRBUUNBQlFHYzNSeWFXNW5EQWdBQm5OMFlYUjFjd05wYm5RRUFnQUNCbk4wY21sdVp3d0hBQVZuY205MWNBWnpkSEpwYm1jTUNRQUhaR1ZtWVhWc2RBPT18wBPlXngSSsKu6SaUAks2tTiA5A_BV1pYLa5CdSff-SM=",
      newApiUser: "3", channelName: "ng-anthropic-0702-qm0006", channelType: "14",
      models: "claude-opus-4-6,claude-opus-4-7,claude-opus-4-8",
      groups: "anthropic", tag: "ng", priority: "10", weight: "10"
    }));
    sqlite.prepare("INSERT INTO lines (label, config) VALUES (?, ?)").run("线路2-RS", JSON.stringify({
      baseUrl: "http://47.237.218.105", authType: "session",
      authValue: "session=MTc4Mjk3NzAyOHxEWDhFQVFMX2dBQUJFQUVRQUFEX2tmLUFBQVVHYzNSeWFXNW5EQW9BQ0hWelpYSnVZVzFsQm5OMGNtbHVad3dLQUFoaFpHMXBiakF3T1FaemRISnBibWNNQmdBRWNtOXNaUU5wYm5RRUFnQVVCbk4wY21sdVp3d0lBQVp6ZEdGMGRYTURhVzUwQkFJQUFnWnpkSEpwYm1jTUJ3QUZaM0p2ZFhBR2MzUnlhVzVuREFrQUIyUmxabUYxYkhRR2MzUnlhVzVuREFRQUFtbGtBMmx1ZEFRQ0FEbz18K02f4CXlYBfRnyqG0mz9tv1pPC8_yzN4kmwq_ll-eBM=",
      newApiUser: "29", channelName: "rs0001", channelType: "14",
      models: "claude-opus-4-1-20250805,claude-opus-4-5-20251101,claude-opus-4-6,claude-opus-4-7,claude-sonnet-4-20250514,claude-sonnet-4-5-20250929,claude-sonnet-4-6,claude-haiku-4-5-20251001,claude-opus-4-20250514,claude-opus-4-8,claude-fable-5,claude-sonnet-5",
      groups: "claude_    3", tag: "rs", priority: "0", weight: "0"
    }));
    const now = Math.floor(Date.now() / 1000);
    const seed = [
      { name: "ng-anthropic-0702-qm0001", kc: 12, q: 142372492 },
      { name: "ng-anthropic-0702-qm0002", kc: 8, q: 105734100 },
      { name: "ng-anthropic-0702-qm0003", kc: 15, q: 183272387 },
      { name: "ng-anthropic-0702-qm0004", kc: 9, q: 116535449 },
      { name: "ng-anthropic-0702-qm0005", kc: 5, q: 58209352 },
    ];
    const ins = sqlite.prepare("INSERT INTO records (line_id,name,key_count,cached_quota,all_disabled_since,frozen,last_refresh,imported_at) VALUES (1,?,?,?,?,1,?,?)");
    for (const s of seed) ins.run(s.name, s.kc, s.q, now - 301, now, now);
  }

  globalForDb.__sqlite = sqlite;
}

export const db = drizzle(globalForDb.__sqlite!, { schema });
