import Anthropic from "@anthropic-ai/sdk";
import { getContact, updateContact } from "./contacts.js";

function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

interface EnrichResult {
  linkedin?: string | null;
  instagram?: string | null;
  twitter?: string | null;
  youtube?: string | null;
  tiktok?: string | null;
  website?: string | null;
  notes?: string | null;
}

export async function enrichContact(id: number): Promise<void> {
  const contact = getContact(id);
  if (!contact) return;

  const client = getClient();

  const who = [contact.name, contact.company ? `(${contact.company})` : ""].filter(Boolean).join(" ");
  const prompt = `Search for social media profiles and public info about ${who}.
Find their exact:
- LinkedIn profile URL
- Instagram handle (without @)
- Twitter/X handle (without @)
- YouTube channel URL or handle
- TikTok handle (without @)
- Website URL
- A 1–2 sentence description of who they are / what they do

Return ONLY a JSON object. Use null for anything not found. No extra text.
{
  "linkedin": "...",
  "instagram": "...",
  "twitter": "...",
  "youtube": "...",
  "tiktok": "...",
  "website": "...",
  "notes": "..."
}`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  let finalText = "";

  for (let i = 0; i < 6; i++) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      // web_search_20250305 is a server-side tool supported by the API but not
      // yet typed in SDK 0.39.0 — cast to bypass the type check.
      tools: [{ type: "web_search_20250305", name: "web_search" }] as unknown as Anthropic.Tool[],
      messages,
    });

    if (response.stop_reason === "end_turn") {
      for (const block of response.content) {
        if (block.type === "text") {
          finalText = block.text;
          break;
        }
      }
      break;
    }

    if (response.stop_reason === "tool_use") {
      // Server-side web_search: Anthropic executes it — just add the assistant
      // message and continue; the next response will include search results.
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    break;
  }

  if (!finalText) return;

  // Extract JSON from the response
  const match = finalText.match(/\{[\s\S]*\}/);
  if (!match) return;

  let data: EnrichResult;
  try {
    data = JSON.parse(match[0]) as EnrichResult;
  } catch {
    return;
  }

  // Only fill in fields that are currently empty
  const updates: Parameters<typeof updateContact>[1] = {};
  if (data.linkedin && !contact.linkedin) updates.linkedin = data.linkedin;
  if (data.instagram && !contact.instagram) updates.instagram = data.instagram;
  if (data.twitter && !contact.twitter) updates.twitter = data.twitter;
  if (data.youtube && !contact.youtube) updates.youtube = data.youtube;
  if (data.tiktok && !contact.tiktok) updates.tiktok = data.tiktok;
  if (data.website && !contact.website) updates.website = data.website;
  if (data.notes && !contact.notes) updates.notes = data.notes;

  if (Object.keys(updates).length > 0) {
    updateContact(id, updates);
    console.log(`[contacts] Enriched contact id=${id} (${contact.name}): ${Object.keys(updates).join(", ")}`);
  }
}
