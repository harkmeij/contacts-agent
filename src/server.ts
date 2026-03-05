import express, { Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import { runAgent } from "./agent.js";
import {
  addContact,
  updateContact,
  deleteContact,
  listContacts,
  getContact,
  logInteraction,
} from "./contacts.js";
import type { ContactType, ContactStatus } from "./contacts.js";
import { enrichContact } from "./enrich.js";

const app = express();
app.use(express.json({ limit: "64kb" }));

const SECRET = process.env.AGENT_SYNC_SECRET || "";

function validateSecret(req: Request, res: Response): boolean {
  const provided = req.headers["x-agent-secret"];
  if (!SECRET || typeof provided !== "string") {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  try {
    if (!timingSafeEqual(Buffer.from(provided), Buffer.from(SECRET))) {
      res.status(403).json({ error: "Forbidden" });
      return false;
    }
  } catch {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// Health check — no auth
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// POST /message — natural language agent
app.post("/message", async (req: Request, res: Response) => {
  if (!validateSecret(req, res)) return;
  const { message } = req.body as { message?: unknown };
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Missing message" });
    return;
  }
  try {
    const response = await runAgent(message);
    res.json({ response });
  } catch (err) {
    console.error("[contacts-agent] Agent error:", err);
    res.status(500).json({ error: "Agent failed", detail: String(err) });
  }
});

// GET /contacts — list all contacts
app.get("/contacts", (req: Request, res: Response) => {
  if (!validateSecret(req, res)) return;
  const type = req.query.type as ContactType | undefined;
  res.json(listContacts(type));
});

// POST /contacts — create contact
app.post("/contacts", (req: Request, res: Response) => {
  if (!validateSecret(req, res)) return;
  const { type, name, ...fields } = req.body as {
    type: ContactType;
    name: string;
    company?: string;
    email?: string;
    phone?: string;
    instagram?: string;
    linkedin?: string;
    twitter?: string;
    youtube?: string;
    tiktok?: string;
    website?: string;
    notes?: string;
  };
  if (!type || !name) {
    res.status(400).json({ error: "type and name are required" });
    return;
  }
  const contact = addContact(type, name, fields);
  res.status(201).json(contact);

  // Fire-and-forget enrichment — runs after response is sent
  enrichContact(contact.id).catch((err) =>
    console.error(`[contacts] Enrichment failed for id=${contact.id}:`, err),
  );
});

// PATCH /contacts/:id — update contact
app.patch("/contacts/:id", (req: Request, res: Response) => {
  if (!validateSecret(req, res)) return;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const existing = getContact(id);
  if (!existing) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  const fields = req.body as Partial<{
    type: ContactType;
    name: string;
    company: string | null;
    email: string | null;
    phone: string | null;
    instagram: string | null;
    linkedin: string | null;
    twitter: string | null;
    youtube: string | null;
    tiktok: string | null;
    website: string | null;
    notes: string | null;
    status: ContactStatus;
  }>;
  const updated = updateContact(id, fields);
  res.json(updated);
});

// DELETE /contacts/:id — delete contact
app.delete("/contacts/:id", (req: Request, res: Response) => {
  if (!validateSecret(req, res)) return;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const ok = deleteContact(id);
  if (!ok) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  res.status(204).send();
});

// POST /contacts/:id/interactions — log interaction
app.post("/contacts/:id/interactions", (req: Request, res: Response) => {
  if (!validateSecret(req, res)) return;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const existing = getContact(id);
  if (!existing) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  const { note } = req.body as { note?: unknown };
  if (!note || typeof note !== "string") {
    res.status(400).json({ error: "note is required" });
    return;
  }
  const interaction = logInteraction(id, note);
  res.status(201).json(interaction);
});

export function startServer(): void {
  const port = parseInt(process.env.PORT || "3001", 10);
  app.listen(port, () => console.log(`[contacts-agent] Server on port ${port}`));
}
