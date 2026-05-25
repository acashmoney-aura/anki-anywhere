import JSZip from "jszip";
import initSqlJs from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";

export type ImportedCard = {
  front: string;
  back: string;
  tags?: string[];
  source?: string;
  noteId?: string;
  templateOrdinal?: number;
};

type AnkiModel = {
  id?: number | string;
  name?: string;
  type?: number;
  flds?: Array<{ name?: string }>;
  tmpls?: Array<{ ord?: number; name?: string; qfmt?: string; afmt?: string }>;
};

type ParsedPackage = {
  cards: ImportedCard[];
  source: string;
};

let sqlPromise: Promise<Awaited<ReturnType<typeof initSqlJs>>> | null = null;

function getSql() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: () => sqlWasmUrl });
  }
  return sqlPromise;
}

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderTemplate(template: string, fields: Record<string, string>, renderedFront?: string) {
  let output = template.replace(/\{\{FrontSide\}\}/g, renderedFront ?? "");
  output = output.replace(/\{\{[#^][^}]+\}\}[\s\S]*?\{\{\/[^}]+\}\}/g, "");
  output = output.replace(/\{\{([^}]+)\}\}/g, (_match, rawKey) => {
    const key = String(rawKey).trim();
    if (key.includes(":")) {
      const [, actual] = key.split(":").slice(-2);
      return fields[actual?.trim() ?? ""] ?? "";
    }
    return fields[key] ?? "";
  });
  return htmlToText(output);
}

function renderClozeText(text: string, clozeNumber: number, reveal: boolean) {
  return text.replace(/\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g, (_match, rawNumber, answer, hint) => {
    const number = Number(rawNumber);
    if (number === clozeNumber) {
      return reveal ? answer : `[${hint?.trim() || "..."}]`;
    }
    return answer;
  });
}

function parseModels(raw: string | null | undefined) {
  if (!raw) return new Map<string, AnkiModel>();
  try {
    const parsed = JSON.parse(raw) as Record<string, AnkiModel>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map<string, AnkiModel>();
  }
}

function getFieldMap(model: AnkiModel | undefined, fldsRaw: string) {
  const values = fldsRaw.split("\u001f");
  const names = model?.flds?.map((field) => field.name?.trim() || "") ?? [];
  const mapped = Object.fromEntries(values.map((value, index) => [names[index] || `Field${index + 1}`, value]));
  if (values[0] && !mapped.Front) mapped.Front = values[0];
  if (values[1] && !mapped.Back) mapped.Back = values[1];
  if (values[0] && !mapped.Text) mapped.Text = values[0];
  if (values[1] && !mapped.Extra) mapped.Extra = values[1];
  return mapped;
}

export async function parseAnkiPackage(file: File): Promise<ParsedPackage> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const dbEntry = Object.values(zip.files).find((entry) => /collection\.anki2(1)?$|collection\.anki21$|collection\.anki21b$/i.test(entry.name));
  if (!dbEntry) throw new Error("Could not find Anki collection database in this package.");

  const SQL = await getSql();
  const db = new SQL.Database(new Uint8Array(await dbEntry.async("arraybuffer")));

  try {
    const colResult = db.exec("SELECT models FROM col LIMIT 1");
    const models = parseModels(colResult[0]?.values?.[0]?.[0] as string | undefined);

    const cardRows = db.exec("SELECT nid, ord FROM cards");
    const cardOrdsByNote = new Map<string, number[]>();
    for (const row of cardRows[0]?.values ?? []) {
      const nid = String(row[0]);
      const ord = Number(row[1]);
      const existing = cardOrdsByNote.get(nid) ?? [];
      existing.push(ord);
      cardOrdsByNote.set(nid, existing);
    }

    const noteRows = db.exec("SELECT id, mid, tags, flds FROM notes");
    const cards: ImportedCard[] = [];

    for (const row of noteRows[0]?.values ?? []) {
      const noteId = String(row[0]);
      const mid = String(row[1]);
      const tags = String(row[2] ?? "").split(" ").map((tag) => tag.trim()).filter(Boolean);
      const fldsRaw = String(row[3] ?? "");
      const model = models.get(mid);
      const fieldMap = getFieldMap(model, fldsRaw);
      const ords = [...new Set(cardOrdsByNote.get(noteId) ?? [0])].sort((a, b) => a - b);

      if (model?.type === 1) {
        const text = fieldMap.Text ?? Object.values(fieldMap)[0] ?? "";
        const extra = fieldMap.Extra ?? Object.values(fieldMap)[1] ?? "";
        for (const ord of ords) {
          const clozeNumber = ord + 1;
          if (!text.includes(`{{c${clozeNumber}::`)) continue;
          cards.push({
            front: renderClozeText(text, clozeNumber, false),
            back: `${renderClozeText(text, clozeNumber, true)}${extra ? `\n\n${htmlToText(extra)}` : ""}`.trim(),
            tags: [...tags, `cloze:${clozeNumber}`],
            source: `${file.name} · ${model?.name ?? "Cloze"}`,
            noteId,
            templateOrdinal: ord,
          });
        }
        continue;
      }

      const templates = (model?.tmpls ?? []).sort((a, b) => Number(a.ord ?? 0) - Number(b.ord ?? 0));
      for (const ord of ords) {
        const template = templates.find((item) => Number(item.ord ?? 0) === ord) ?? templates[ord] ?? templates[0];
        const qfmt = template?.qfmt ?? "{{Front}}";
        const afmt = template?.afmt ?? "{{Back}}";
        const front = renderTemplate(qfmt, fieldMap);
        const back = renderTemplate(afmt, fieldMap, front);
        if (!front && !back) continue;
        cards.push({
          front,
          back,
          tags,
          source: `${file.name} · ${model?.name ?? template?.name ?? "Anki import"}`,
          noteId,
          templateOrdinal: ord,
        });
      }
    }

    if (!cards.length) throw new Error("No importable cards were found in this deck yet.");
    return { cards, source: file.name };
  } finally {
    db.close();
  }
}
