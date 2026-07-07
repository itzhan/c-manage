import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const keys = sqliteTable("keys", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const lines = sqliteTable("lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  config: text("config").notNull().default("{}"),
  autoEnabled: integer("auto_enabled").notNull().default(0),
  autoBatchSize: integer("auto_batch_size").notNull().default(10),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const records = sqliteTable("records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lineId: integer("line_id").notNull(),
  name: text("name").notNull(),
  keyCount: integer("key_count").notNull().default(0),
  cachedQuota: integer("cached_quota").notNull().default(0),
  allDisabledSince: integer("all_disabled_since"),
  frozen: integer("frozen").notNull().default(0),
  disabledCount: integer("disabled_count").notNull().default(0),
  lastRefresh: integer("last_refresh"),
  importedAt: integer("imported_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const logs = sqliteTable("logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lineId: integer("line_id").notNull(),
  message: text("message").notNull(),
  level: text("level").notNull().default("info"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const dispatchLocks = sqliteTable("dispatch_locks", {
  lockKey: text("lock_key").primaryKey(),
  lockedAt: integer("locked_at").notNull(),
});
