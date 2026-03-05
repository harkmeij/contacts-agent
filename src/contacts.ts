import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export type ContactType = "sponsor" | "client" | "collaborator" | "press" | "other";
export type ContactStatus = "active" | "inactive" | "pending";

export interface Contact {
  id: number;
  type: ContactType;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  instagram: string | null;
  website: string | null;
  notes: string | null;
  status: ContactStatus;
  created_at: string;
  updated_at: string;
}

export interface Interaction {
  id: number;
  contact_id: number;
  note: string;
  created_at: string;
}

let db: Database.Database;

export function initDb(): void {
  const dbDir = process.env.DB_DIR || "./data";
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, "contacts.db");
  db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT NOT NULL CHECK(type IN ('sponsor','client','collaborator','press','other')),
      name        TEXT NOT NULL,
      company     TEXT,
      email       TEXT,
      phone       TEXT,
      instagram   TEXT,
      website     TEXT,
      notes       TEXT,
      status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','pending')),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contact_interactions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      note        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  console.log(`[contacts] DB initialized at ${dbPath}`);
}

function getDb(): Database.Database {
  if (!db) initDb();
  return db;
}

export function addContact(
  type: ContactType,
  name: string,
  fields: {
    company?: string;
    email?: string;
    phone?: string;
    instagram?: string;
    website?: string;
    notes?: string;
  } = {},
): Contact {
  const stmt = getDb().prepare(`
    INSERT INTO contacts (type, name, company, email, phone, instagram, website, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    type,
    name,
    fields.company ?? null,
    fields.email ?? null,
    fields.phone ?? null,
    fields.instagram ?? null,
    fields.website ?? null,
    fields.notes ?? null,
  );
  return getContact(result.lastInsertRowid as number)!;
}

export function updateContact(
  id: number,
  fields: Partial<{
    type: ContactType;
    name: string;
    company: string | null;
    email: string | null;
    phone: string | null;
    instagram: string | null;
    website: string | null;
    notes: string | null;
    status: ContactStatus;
  }>,
): Contact | null {
  const allowed = ["type", "name", "company", "email", "phone", "instagram", "website", "notes", "status"];
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const key of allowed) {
    if (key in fields) {
      sets.push(`${key} = ?`);
      values.push(fields[key as keyof typeof fields]);
    }
  }

  if (sets.length === 0) return getContact(id);

  sets.push("updated_at = datetime('now')");
  values.push(id);

  getDb().prepare(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return getContact(id);
}

export function logInteraction(contact_id: number, note: string): Interaction {
  const stmt = getDb().prepare(`
    INSERT INTO contact_interactions (contact_id, note) VALUES (?, ?)
  `);
  const result = stmt.run(contact_id, note);
  return getDb()
    .prepare("SELECT * FROM contact_interactions WHERE id = ?")
    .get(result.lastInsertRowid) as Interaction;
}

export function searchContacts(query?: string, type?: ContactType): Contact[] {
  if (query) {
    const q = `%${query}%`;
    if (type) {
      return getDb()
        .prepare(
          "SELECT * FROM contacts WHERE type = ? AND (name LIKE ? OR company LIKE ? OR email LIKE ? OR instagram LIKE ?) ORDER BY name",
        )
        .all(type, q, q, q, q) as Contact[];
    }
    return getDb()
      .prepare(
        "SELECT * FROM contacts WHERE name LIKE ? OR company LIKE ? OR email LIKE ? OR instagram LIKE ? ORDER BY name",
      )
      .all(q, q, q, q) as Contact[];
  }
  if (type) {
    return getDb().prepare("SELECT * FROM contacts WHERE type = ? ORDER BY name").all(type) as Contact[];
  }
  return getDb().prepare("SELECT * FROM contacts ORDER BY name").all() as Contact[];
}

export function listContacts(type?: ContactType): Contact[] {
  return searchContacts(undefined, type);
}

export function getContact(id: number): Contact | null {
  return (getDb().prepare("SELECT * FROM contacts WHERE id = ?").get(id) as Contact) ?? null;
}

export function deleteContact(id: number): boolean {
  const result = getDb().prepare("DELETE FROM contacts WHERE id = ?").run(id);
  return result.changes > 0;
}

export function getInteractions(contact_id: number): Interaction[] {
  return getDb()
    .prepare("SELECT * FROM contact_interactions WHERE contact_id = ? ORDER BY created_at DESC")
    .all(contact_id) as Interaction[];
}
