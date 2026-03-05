import Anthropic from "@anthropic-ai/sdk";
import { TodoistApi } from "@doist/todoist-api-typescript";
import {
  addContact,
  updateContact,
  logInteraction,
  searchContacts,
  getContact,
} from "./contacts.js";
import type { ContactType, ContactStatus } from "./contacts.js";

function getAnthropic(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

function getTodoist(): TodoistApi {
  return new TodoistApi(process.env.TODOIST_API_KEY!);
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "add_contact",
    description:
      "Add a new contact — sponsor, client, collaborator, press, or other. Use when Mark mentions someone new to track.",
    input_schema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: ["sponsor", "client", "collaborator", "press", "other"],
          description: "Contact type",
        },
        name: { type: "string", description: "Full name or brand name" },
        company: { type: "string", description: "Company or brand name (if different from name)" },
        email: { type: "string", description: "Email address" },
        phone: { type: "string", description: "Phone number" },
        instagram: { type: "string", description: "Instagram handle (e.g. @gobik)" },
        website: { type: "string", description: "Website URL" },
        notes: { type: "string", description: "Any extra notes about this contact" },
      },
      required: ["type", "name"],
    },
  },
  {
    name: "update_contact",
    description: "Update an existing contact's fields or status.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "Contact ID" },
        type: { type: "string", enum: ["sponsor", "client", "collaborator", "press", "other"] },
        name: { type: "string" },
        company: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        instagram: { type: "string" },
        website: { type: "string" },
        notes: { type: "string" },
        status: { type: "string", enum: ["active", "inactive", "pending"] },
      },
      required: ["id"],
    },
  },
  {
    name: "log_interaction",
    description:
      "Log an interaction with a contact — email sent, call made, meeting held, deal discussed, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: { type: "number", description: "ID of the contact" },
        note: { type: "string", description: "Description of the interaction, e.g. 'Emailed Sara about Q2 deal'" },
      },
      required: ["contact_id", "note"],
    },
  },
  {
    name: "search_contacts",
    description:
      "Search or list contacts. Use to look up a person/brand, or list all contacts of a type.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Name, email, company, or Instagram fragment to search for",
        },
        type: {
          type: "string",
          enum: ["sponsor", "client", "collaborator", "press", "other"],
          description: "Filter by contact type",
        },
      },
    },
  },
  {
    name: "create_todoist_task",
    description: "Create a Todoist follow-up task related to a contact.",
    input_schema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "Task title" },
        due_string: { type: "string", description: "Natural language due date, e.g. 'in 2 weeks'" },
        description: { type: "string", description: "Optional task description/notes" },
      },
      required: ["content"],
    },
  },
];

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "add_contact": {
        const contact = addContact(input.type as ContactType, input.name as string, {
          company: input.company as string | undefined,
          email: input.email as string | undefined,
          phone: input.phone as string | undefined,
          instagram: input.instagram as string | undefined,
          website: input.website as string | undefined,
          notes: input.notes as string | undefined,
        });
        return JSON.stringify({ success: true, contact });
      }

      case "update_contact": {
        const id = input.id as number;
        const existing = getContact(id);
        if (!existing) return JSON.stringify({ success: false, error: `Contact id=${id} not found` });
        const updated = updateContact(id, {
          type: input.type as ContactType | undefined,
          name: input.name as string | undefined,
          company: input.company !== undefined ? (input.company as string | null) : undefined,
          email: input.email !== undefined ? (input.email as string | null) : undefined,
          phone: input.phone !== undefined ? (input.phone as string | null) : undefined,
          instagram: input.instagram !== undefined ? (input.instagram as string | null) : undefined,
          website: input.website !== undefined ? (input.website as string | null) : undefined,
          notes: input.notes !== undefined ? (input.notes as string | null) : undefined,
          status: input.status as ContactStatus | undefined,
        });
        return JSON.stringify({ success: true, contact: updated });
      }

      case "log_interaction": {
        const contactId = input.contact_id as number;
        const existing = getContact(contactId);
        if (!existing) return JSON.stringify({ success: false, error: `Contact id=${contactId} not found` });
        const interaction = logInteraction(contactId, input.note as string);
        return JSON.stringify({ success: true, interaction, contact_name: existing.name });
      }

      case "search_contacts": {
        const contacts = searchContacts(
          input.query as string | undefined,
          input.type as ContactType | undefined,
        );
        return JSON.stringify({ count: contacts.length, contacts });
      }

      case "create_todoist_task": {
        const api = getTodoist();
        const taskParams: { content: string; dueString?: string; description?: string } = {
          content: input.content as string,
        };
        if (input.due_string) taskParams.dueString = input.due_string as string;
        if (input.description) taskParams.description = input.description as string;
        const task = await api.addTask(taskParams);
        return JSON.stringify({ success: true, taskId: task.id, content: task.content });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}

export async function runAgent(message: string): Promise<string> {
  const client = getAnthropic();

  const system = `You are a contacts management assistant for Mark Heij, a cycling content creator.
Mark's contacts include sponsors (GOBIK, ROSE Bikes, Wahoo, Lake, etc.), Betterview video clients, collaborator creators, and press/media.

When asked to add, update, search, or log interactions with contacts — use the appropriate tools immediately.
Be concise in your responses. Confirm actions briefly.
If Mark mentions a person or brand without specifying an action, search for them first.`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: message }];

  let finalReply = "";

  for (let i = 0; i < 10; i++) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system,
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === "end_turn") {
      for (const block of response.content) {
        if (block.type === "text") {
          finalReply = block.text;
          break;
        }
      }
      break;
    }

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          console.log(`[contacts-agent] Tool: ${block.name}`);
          const result = await executeTool(block.name, block.input as Record<string, unknown>);
          console.log(`[contacts-agent] Result: ${result.slice(0, 120)}`);
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
        }
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    break;
  }

  return finalReply || "Done!";
}
