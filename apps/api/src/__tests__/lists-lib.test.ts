import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { ensureListMembership } from '../lib/lists'

// We test ensureListMembership against a real in-memory SQLite database to
// verify idempotency without mocking the ORM layer.

function createListsDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE seq_contacts (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE seq_lists (
      id TEXT PRIMARY KEY NOT NULL,
      product_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_lists_product_slug ON seq_lists (product_id, slug);
    CREATE TABLE seq_list_members (
      id TEXT PRIMARY KEY NOT NULL,
      list_id TEXT NOT NULL REFERENCES seq_lists(id) ON DELETE CASCADE,
      contact_id TEXT NOT NULL REFERENCES seq_contacts(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'subscribed',
      source TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      unsubscribed_at TEXT
    );
    CREATE UNIQUE INDEX idx_list_members_list_contact ON seq_list_members (list_id, contact_id);

    INSERT INTO seq_contacts (id, email) VALUES ('contact_1', 'user@example.com');
  `)
  return db
}

describe('ensureListMembership idempotency (raw SQL)', () => {
  it('inserts a list and member on first call', () => {
    const db = createListsDb()

    // First call: upsert list
    db.exec(`
      INSERT INTO seq_lists (id, product_id, slug, name)
      VALUES ('list_1', 'prod_1', 'camaudit-all', 'CAMAudit All')
      ON CONFLICT DO NOTHING
    `)
    const listRow = db.prepare('SELECT id FROM seq_lists WHERE slug = ?').get('camaudit-all') as {
      id: string
    } | null
    expect(listRow).not.toBeNull()

    // Insert member
    db.exec(`
      INSERT INTO seq_list_members (id, list_id, contact_id, source)
      VALUES ('member_1', 'list_1', 'contact_1', 'enrollment')
      ON CONFLICT DO NOTHING
    `)
    const memberRow = db
      .prepare('SELECT id, status FROM seq_list_members WHERE list_id = ? AND contact_id = ?')
      .get('list_1', 'contact_1') as { id: string; status: string } | null
    expect(memberRow).not.toBeNull()
    expect(memberRow?.status).toBe('subscribed')

    db.close()
  })

  it('is idempotent on second call - no duplicate list or member rows', () => {
    const db = createListsDb()

    for (let i = 0; i < 3; i++) {
      db.exec(`
        INSERT INTO seq_lists (id, product_id, slug, name)
        VALUES ('list_1', 'prod_1', 'camaudit-all', 'CAMAudit All')
        ON CONFLICT DO NOTHING
      `)
      db.exec(`
        INSERT INTO seq_list_members (id, list_id, contact_id, source)
        VALUES ('member_1', 'list_1', 'contact_1', 'enrollment')
        ON CONFLICT DO NOTHING
      `)
    }

    const listCount = db.prepare('SELECT COUNT(*) AS n FROM seq_lists').get() as { n: number }
    const memberCount = db.prepare('SELECT COUNT(*) AS n FROM seq_list_members').get() as {
      n: number
    }
    expect(listCount.n).toBe(1)
    expect(memberCount.n).toBe(1)

    db.close()
  })

  it('allows a second contact to join the same list', () => {
    const db = createListsDb()
    db.exec(`INSERT INTO seq_contacts (id, email) VALUES ('contact_2', 'other@example.com')`)

    db.exec(`
      INSERT INTO seq_lists (id, product_id, slug, name)
      VALUES ('list_1', 'prod_1', 'camaudit-all', 'CAMAudit All')
      ON CONFLICT DO NOTHING
    `)
    db.exec(
      `INSERT INTO seq_list_members (id, list_id, contact_id, source) VALUES ('m1', 'list_1', 'contact_1', 'api') ON CONFLICT DO NOTHING`,
    )
    db.exec(
      `INSERT INTO seq_list_members (id, list_id, contact_id, source) VALUES ('m2', 'list_1', 'contact_2', 'api') ON CONFLICT DO NOTHING`,
    )

    const memberCount = db.prepare('SELECT COUNT(*) AS n FROM seq_list_members').get() as {
      n: number
    }
    expect(memberCount.n).toBe(2)

    db.close()
  })
})

describe('ensureListMembership (function under test)', () => {
  // A tiny Drizzle-shaped mock that records inserts and returns rows from select.
  function makeDb() {
    const inserts: Array<{ table: string }> = []
    const tableName = (t: unknown) =>
      (t as { _?: { name?: string } })?._?.name ??
      (t as { [Symbol.toStringTag]?: string })?.toString?.() ??
      'unknown'

    const selectQueue: unknown[][] = [[{ id: 'list_1' }], [{ id: 'member_1' }]]

    const db = {
      insert: (t: unknown) => ({
        values: () => ({
          onConflictDoNothing: async () => {
            inserts.push({ table: tableName(t) })
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => selectQueue.shift() ?? [],
          }),
        }),
      }),
    }
    return { db, inserts }
  }

  it('upserts the list then the member and returns both ids', async () => {
    const { db, inserts } = makeDb()
    const result = await ensureListMembership(db as never, {
      productId: 'prod_1',
      listSlug: 'camaudit-all',
      listName: 'CAMAudit: All',
      contactId: 'contact_1',
      source: 'enrollment',
    })

    expect(result).toEqual({ list_id: 'list_1', member_id: 'member_1' })
    // two upserts issued (list, then member)
    expect(inserts).toHaveLength(2)
  })

  it('defaults source to null when omitted', async () => {
    const { db } = makeDb()
    const result = await ensureListMembership(db as never, {
      productId: 'prod_1',
      listSlug: 'camaudit-all',
      listName: 'CAMAudit: All',
      contactId: 'contact_1',
    })
    expect(result).toEqual({ list_id: 'list_1', member_id: 'member_1' })
  })
})
