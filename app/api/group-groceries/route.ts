import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const GROUP_MODEL = "gpt-5.4-nano";
const MAX_ITEMS = 100;

type RequestItem = { id: string; name: string };

type GroupedSection = { name: string; itemIds: string[] };

function isRequestItem(value: unknown): value is RequestItem {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RequestItem).id === "string" &&
    (value as RequestItem).id.length > 0 &&
    typeof (value as RequestItem).name === "string" &&
    (value as RequestItem).name.length > 0
  );
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "Server is misconfigured." }, { status: 500 });
  }

  // Verify the caller's token against Supabase Auth using only the public
  // anon key — no service-role secret is needed or used here.
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);

  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const items = (body as { items?: unknown } | null)?.items;

  if (!Array.isArray(items) || items.length === 0 || !items.every(isRequestItem)) {
    return NextResponse.json({ error: "Invalid grocery items." }, { status: 400 });
  }

  if (items.length > MAX_ITEMS) {
    return NextResponse.json({ error: "Too many items to group." }, { status: 400 });
  }

  const requestItems = items;
  const sentIds = requestItems.map((item) => item.id);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let sections: GroupedSection[];

  try {
    const response = await openai.responses.create({
      model: GROUP_MODEL,
      input: [
        {
          role: "system",
          content:
            "You organize grocery items into sensible grocery-store shopping sections " +
            "(for example: Produce, Meat/Seafood, Dairy/Refrigerated, Bakery, Pantry, " +
            "Frozen, Beverages, Household, Other). Choose sections that fit the actual " +
            "items given — you are not limited to that example list. Refer to each item " +
            "only by its id; do not invent or restate item names.",
        },
        {
          role: "user",
          content: JSON.stringify({
            items: requestItems.map((item) => ({ id: item.id, name: item.name })),
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "grocery_sections",
          strict: true,
          schema: {
            type: "object",
            properties: {
              sections: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    itemIds: {
                      type: "array",
                      items: { type: "string", enum: sentIds },
                    },
                  },
                  required: ["name", "itemIds"],
                  additionalProperties: false,
                },
              },
            },
            required: ["sections"],
            additionalProperties: false,
          },
        },
      },
    });

    const parsed = JSON.parse(response.output_text) as { sections: GroupedSection[] };
    sections = parsed.sections;
  } catch (err) {
    console.error("OpenAI grouping request failed:", err);
    return NextResponse.json(
      { error: "Could not group items right now." },
      { status: 502 }
    );
  }

  // Reconcile: never trust the model's output blindly. Discard any id that
  // wasn't submitted, keep only the first occurrence of each id across
  // sections, drop sections that end up empty, and place any submitted id
  // the model omitted into a server-added "Unsorted" section — so every
  // submitted id ends up appearing exactly once.
  const sentIdSet = new Set(sentIds);
  const seen = new Set<string>();
  const cleanedSections: GroupedSection[] = [];

  for (const section of sections) {
    const validIds = (section.itemIds ?? []).filter(
      (id) => sentIdSet.has(id) && !seen.has(id)
    );
    validIds.forEach((id) => seen.add(id));
    if (validIds.length > 0) {
      cleanedSections.push({ name: section.name, itemIds: validIds });
    }
  }

  const leftoverIds = sentIds.filter((id) => !seen.has(id));
  if (leftoverIds.length > 0) {
    cleanedSections.push({ name: "Unsorted", itemIds: leftoverIds });
  }

  return NextResponse.json({ sections: cleanedSections });
}
