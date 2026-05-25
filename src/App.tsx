import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, Download, Import, LoaderCircle, Pencil, Plus, RotateCcw, Trash2, Upload } from "lucide-react";
import {
  addNote,
  answerCard,
  buryCard,
  createDeck,
  deleteCard,
  exportCollection,
  getDeck,
  getStudySession,
  getViewer,
  importCards,
  importCollection,
  listDecks,
  revealCurrentCard,
  resetCollection,
  setCardFlag,
  setCardSuspended,
  updateCard,
  updateDeckConfig,
  useCollection,
} from "./localStore";
import type { NoteType, Rating } from "./localStore";

type Deck = ReturnType<typeof listDecks>[number];

type CardImport = {
  front: string;
  back: string;
  hint?: string;
  tags?: string[];
  source?: string;
  noteId?: string;
  templateOrdinal?: number;
};

export default function App() {
  useCollection();
  return (
    <div className="app-shell">
      <Dashboard />
    </div>
  );
}

function Dashboard() {
  const collection = useCollection();
  const decks = useMemo(() => listDecks(), [collection]);
  const viewer = useMemo(() => getViewer(), [collection]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [newDeckTitle, setNewDeckTitle] = useState("");
  const [newDeckDescription, setNewDeckDescription] = useState("");
  const [collectionText, setCollectionText] = useState("");
  const [collectionStatus, setCollectionStatus] = useState<string | null>(null);

  const selectedDeck = useMemo(
    () => decks.find((deck) => String(deck._id) === String(selectedDeckId)) ?? decks[0] ?? null,
    [decks, selectedDeckId],
  );

  return (
    <main className="dashboard">
      <aside className="sidebar glass">
        <div className="sidebar-header">
          <div>
            <div className="eyebrow">Single-user local collection</div>
            <strong>{viewer?.name ?? viewer?.email ?? "Local learner"}</strong>
          </div>
        </div>

        <div className="create-deck-card">
          <h3>New deck</h3>
          <input value={newDeckTitle} onChange={(e) => setNewDeckTitle(e.target.value)} placeholder="Algorithms" />
          <textarea value={newDeckDescription} onChange={(e) => setNewDeckDescription(e.target.value)} placeholder="Optional note" rows={3} />
          <button
            className="primary-button"
            onClick={() => {
              if (!newDeckTitle.trim()) return;
              const id = createDeck({ title: newDeckTitle.trim(), description: newDeckDescription.trim() || undefined });
              setNewDeckTitle("");
              setNewDeckDescription("");
              setSelectedDeckId(String(id));
            }}
          >
            <Plus size={16} /> Create deck
          </button>
        </div>

        <div className="glass import-panel" style={{ marginBottom: 16 }}>
          <div className="section-title"><span>Collection tools</span></div>
          <div className="inline-actions mobile-stack">
            <button
              className="primary-button"
              onClick={() => {
                setCollectionText(exportCollection());
                setCollectionStatus("Collection exported into the text box below.");
              }}
            >
              <Download size={16} /> Export
            </button>
            <button
              className="primary-button"
              onClick={() => {
                try {
                  importCollection(collectionText);
                  setCollectionStatus("Collection imported.");
                } catch {
                  setCollectionStatus("Import failed. Paste a valid exported collection JSON.");
                }
              }}
            >
              <Upload size={16} /> Import
            </button>
            <button
              className="primary-button"
              onClick={() => {
                if (!confirm("Reset local collection? This clears decks, cards, and review history in this browser.")) return;
                resetCollection();
                setSelectedDeckId(null);
                setCollectionStatus("Collection reset.");
              }}
            >
              <RotateCcw size={16} /> Reset
            </button>
          </div>
          <textarea value={collectionText} onChange={(e) => setCollectionText(e.target.value)} rows={6} placeholder="Collection export/import JSON" />
          {collectionStatus ? <div className="info-banner">{collectionStatus}</div> : null}
        </div>

        <div className="deck-list">
          {decks.map((deck) => (
            <button
              key={String(deck._id)}
              className={`deck-row ${String(selectedDeck?._id) === String(deck._id) ? "active" : ""}`}
              onClick={() => setSelectedDeckId(String(deck._id))}
            >
              <div>
                <strong>{deck.title}</strong>
                <span>{deck.cardCount} cards · {deck.dueCount} due</span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="workspace">
        {selectedDeck ? <DeckWorkspace deckId={String(selectedDeck._id)} summary={selectedDeck} /> : <EmptyState />}
      </section>
    </main>
  );
}

function DeckWorkspace({ deckId, summary }: { deckId: string; summary: Deck }) {
  const collection = useCollection();
  const deckData = useMemo(() => getDeck(deckId), [collection, deckId]);
  const study = useMemo(() => getStudySession(deckId), [collection, deckId]);
  const [noteFront, setNoteFront] = useState("");
  const [noteBack, setNoteBack] = useState("");
  const [noteHint, setNoteHint] = useState("");
  const [noteTags, setNoteTags] = useState("");
  const [noteType, setNoteType] = useState<NoteType>("basic");
  const [noteStatus, setNoteStatus] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importingFile, setImportingFile] = useState(false);
  const [browserQuery, setBrowserQuery] = useState("");
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [editHint, setEditHint] = useState("");
  const [editTags, setEditTags] = useState("");

  const currentCard = study?.currentCard;
  const revealed = study?.session?.revealed ?? false;

  const filteredCards = useMemo(() => {
    const cards = deckData?.cards ?? [];
    const raw = browserQuery.trim().toLowerCase();
    if (!raw) return cards;
    const tokens = raw.split(/\s+/).filter(Boolean);
    return cards.filter((card: any) => {
      const haystack = [card.front, card.back, card.hint ?? "", ...(card.tags ?? [])].join(" ").toLowerCase();
      return tokens.every((token) => {
        if (token === "is:suspended") return Boolean(card.state?.suspended);
        if (token === "is:buried") return typeof card.state?.buriedUntilDay === "number";
        if (token.startsWith("flag:")) return Number(token.slice(5)) === (card.state?.flag ?? 0);
        if (token.startsWith("tag:")) return (card.tags ?? []).some((tag: string) => tag.toLowerCase() === token.slice(4));
        return haystack.includes(token);
      });
    });
  }, [browserQuery, deckData?.cards]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (!currentCard) return;
      if (!revealed && (event.key === " " || event.key.toLowerCase() === "enter")) {
        event.preventDefault();
        revealCurrentCard(deckId, currentCard._id, true);
        return;
      }
      if (revealed) {
        const ratingMap: Record<string, Rating> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
        const rating = ratingMap[event.key];
        if (rating) {
          event.preventDefault();
          answerCard(deckId, currentCard._id, rating);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentCard, revealed, deckId]);

  if (!deckData || !study) {
    return <div className="centered"><LoaderCircle className="spin" /></div>;
  }

  return (
    <div className="workspace-stack">
      <header className="workspace-header glass">
        <div>
          <div className="eyebrow">Deck</div>
          <h2>{summary.title}</h2>
          <p className="muted">{summary.description || "No description."}</p>
        </div>
        <div className="stat-pills">
          <span>{study.dueCounts.new} new</span>
          <span>{study.dueCounts.learning} learning</span>
          <span>{study.dueCounts.review} review</span>
          <span>{study.stats.totalCards} total</span>
          <span>{study.deckConfig?.learnSteps?.join(" → ")}m steps</span>
        </div>
      </header>

      <div className="workspace-grid">
        <section className="study-panel glass">
          <div className="study-topbar">
            <div>
              <div className="eyebrow">Study</div>
              <strong>{study.dueCounts.due ? `${study.dueCounts.due} due` : "Done for now"}</strong>
            </div>
            <span className="progress-chip">Today: {study.streak}</span>
          </div>

          {currentCard ? (
            <>
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${currentCard._id}-${revealed ? "back" : "front"}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flashcard"
                >
                  <div className="flashcard-face-label">{revealed ? "Back" : "Front"}</div>
                  <div className="flashcard-content">{revealed ? currentCard.back : currentCard.front}</div>
                  {currentCard.hint && !revealed ? <div className="hint">Hint: {currentCard.hint}</div> : null}
                  <div className="card-meta">
                    <span>{currentCard.tags?.length ? currentCard.tags.join(" • ") : "No tags"}</span>
                    <span>{currentCard.state?.phase ?? "new"}{currentCard.state?.suspended ? ' · suspended' : ''}{currentCard.state?.flag ? ` · flag ${currentCard.state.flag}` : ''}</span>
                  </div>
                </motion.div>
              </AnimatePresence>

              {!revealed ? (
                <button
                  className="primary-button big"
                  onClick={() => revealCurrentCard(deckId, currentCard._id, true)}
                >
                  <BookOpen size={18} /> Show answer
                </button>
              ) : (
                <div className="review-grid">
                  {[
                    ["again", "Again", currentCard.answerPreview?.again],
                    ["hard", "Hard", currentCard.answerPreview?.hard],
                    ["good", "Good", currentCard.answerPreview?.good],
                    ["easy", "Easy", currentCard.answerPreview?.easy],
                  ].map(([value, label, hint]) => (
                    <button
                      key={value}
                      className={`rating-button ${value}`}
                      onClick={() => answerCard(deckId, currentCard._id, value as Rating)}
                    >
                      <strong>{label}</strong>
                      <span>{hint}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="empty-study glass-inner">
              <h3>No cards due</h3>
              <p>You can close the app. Your progress is saved in this browser.</p>
            </div>
          )}

          {study.upcoming?.length ? (
            <div className="upcoming-list">
              <div className="eyebrow">Up next</div>
              {study.upcoming.map((card: { _id: string; front: string }) => (
                <div className="upcoming-row" key={card._id}>{card.front}</div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="manage-panel">
          <div className="glass import-panel">
            <div className="section-title">
              <span>Deck options</span>
            </div>
            <p className="muted small">Lightweight scheduler controls, closer to Anki deck options.</p>
            <div className="inline-actions mobile-stack">
              <label>
                New/day
                <input
                  type="number"
                  value={study.deckConfig.newCardsPerDay}
                  onChange={(e) => updateDeckConfig(deckId, { newCardsPerDay: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
              <label>
                Reviews/day
                <input
                  type="number"
                  value={study.deckConfig.reviewsPerDay}
                  onChange={(e) => updateDeckConfig(deckId, { reviewsPerDay: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
            </div>
            <div className="inline-actions mobile-stack">
              <label>
                Learn steps (min)
                <input
                  value={study.deckConfig.learnSteps.join(",")}
                  onChange={(e) => {
                    const steps = e.target.value.split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0);
                    if (steps.length) updateDeckConfig(deckId, { learnSteps: steps });
                  }}
                />
              </label>
              <label>
                Relearn steps (min)
                <input
                  value={study.deckConfig.relearnSteps.join(",")}
                  onChange={(e) => {
                    const steps = e.target.value.split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0);
                    if (steps.length) updateDeckConfig(deckId, { relearnSteps: steps });
                  }}
                />
              </label>
            </div>
            <div className="inline-actions mobile-stack">
              <label>
                <input
                  type="checkbox"
                  checked={study.deckConfig.buryNew}
                  onChange={(e) => updateDeckConfig(deckId, { buryNew: e.target.checked })}
                />
                Bury new siblings
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={study.deckConfig.buryReviews}
                  onChange={(e) => updateDeckConfig(deckId, { buryReviews: e.target.checked })}
                />
                Bury review siblings
              </label>
            </div>
            <div className="muted small">Shortcuts: Space/Enter = show answer, 1/2/3/4 = Again/Hard/Good/Easy.</div>
          </div>

          <div className="glass import-panel">
            <div className="section-title">
              <span><Plus size={18} /> Add note</span>
            </div>
            <p className="muted small">Basic, reversed, and now a lightweight cloze note type.</p>
            <select value={noteType} onChange={(e) => setNoteType(e.target.value as NoteType)}>
              <option value="basic">Basic</option>
              <option value="basic_reversed">Basic (and reversed card)</option>
              <option value="cloze">Cloze</option>
            </select>
            <textarea value={noteFront} onChange={(e) => setNoteFront(e.target.value)} rows={4} placeholder={noteType === "cloze" ? "Text with {{c1::deletions}}" : "Front"} />
            <textarea value={noteBack} onChange={(e) => setNoteBack(e.target.value)} rows={4} placeholder={noteType === "cloze" ? "Extra / back" : "Back"} />
            <input value={noteHint} onChange={(e) => setNoteHint(e.target.value)} placeholder="Optional hint" />
            <input value={noteTags} onChange={(e) => setNoteTags(e.target.value)} placeholder="Comma-separated tags" />
            <div className="inline-actions mobile-stack">
              <button
                className="primary-button"
                onClick={() => {
                  try {
                    if (!noteFront.trim()) throw new Error(noteType === "cloze" ? "Cloze text is required." : "Front is required.");
                    if (noteType !== "cloze" && !noteBack.trim()) throw new Error("Back is required.");
                    addNote(deckId, {
                      front: noteFront,
                      back: noteBack,
                      hint: noteHint || undefined,
                      tags: noteTags.split(",").map((tag) => tag.trim()).filter(Boolean),
                      noteType,
                    });
                    setNoteStatus(
                      noteType === "basic_reversed"
                        ? "Added note with 2 cards."
                        : noteType === "cloze"
                          ? "Added cloze note."
                          : "Added note.",
                    );
                    setNoteFront("");
                    setNoteBack("");
                    setNoteHint("");
                    setNoteTags("");
                  } catch (error) {
                    setNoteStatus(error instanceof Error ? error.message : "Could not add note.");
                  }
                }}
              >
                Add note
              </button>
            </div>
            {noteStatus ? <div className="info-banner">{noteStatus}</div> : null}
          </div>

          <div className="glass import-panel">
            <div className="section-title">
              <span><Import size={18} /> Import cards</span>
            </div>
            <p className="muted small">Paste CSV/TSV/JSON, or upload an Anki deck file like <code>.apkg</code> / <code>.colpkg</code>.</p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={9}
              placeholder={'front,back,tags\n"TCP handshake","SYN → SYN-ACK → ACK","networks"'}
            />
            <div className="inline-actions mobile-stack">
              <button
                className="primary-button"
                onClick={() => {
                  try {
                    const parsed = parseImport(importText);
                    importCards(deckId, parsed);
                    setImportStatus(`Imported ${parsed.length} cards.`);
                    setImportText("");
                  } catch (error) {
                    setImportStatus(error instanceof Error ? error.message : "Import failed.");
                  }
                }}
              >
                Import
              </button>
              <label className="primary-button" style={{ display: "inline-flex", cursor: importingFile ? "wait" : "pointer", opacity: importingFile ? 0.7 : 1 }}>
                <Upload size={16} /> {importingFile ? "Importing…" : "Upload deck file"}
                <input
                  aria-label="Upload deck file"
                  type="file"
                  accept=".apkg,.colpkg,.txt,.csv,.tsv,.json"
                  style={{ display: "none" }}
                  disabled={importingFile}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = "";
                    if (!file) return;
                    setImportingFile(true);
                    try {
                      if (/\.(apkg|colpkg)$/i.test(file.name)) {
                        const { parseAnkiPackage } = await import("./ankiPackage");
                        const parsed = await parseAnkiPackage(file);
                        importCards(deckId, parsed.cards);
                        setImportStatus(`Imported ${parsed.cards.length} cards from ${file.name}.`);
                      } else {
                        const text = await file.text();
                        const parsed = parseImport(text);
                        importCards(deckId, parsed);
                        setImportStatus(`Imported ${parsed.length} cards from ${file.name}.`);
                      }
                    } catch (error) {
                      setImportStatus(error instanceof Error ? error.message : "File import failed.");
                    } finally {
                      setImportingFile(false);
                    }
                  }}
                />
              </label>
              <span className="muted small">Anki package import currently targets the selected deck.</span>
            </div>
            {importStatus ? <div className="info-banner">{importStatus}</div> : null}
          </div>

          <div className="glass library-panel">
            <div className="section-title">Browser</div>
            <div className="library-meta">
              <span>{deckData.cards.length} saved</span>
              <span>{deckData.cards.filter((card: any) => card.state?.phase === "review").length} review</span>
              <span>{deckData.cards.filter((card: any) => card.isDue).length} due</span>
            </div>
            <input value={browserQuery} onChange={(e) => setBrowserQuery(e.target.value)} placeholder="Search cards, tags, hints, is:suspended, flag:2" />
            <div className="card-list">
              {filteredCards.slice(0, 100).map((card: any) => (
                <div className="card-row" key={card._id}>
                  <div style={{ flex: 1 }}>
                    {editingCardId === card._id ? (
                      <>
                        <textarea value={editFront} onChange={(e) => setEditFront(e.target.value)} rows={2} placeholder="Front" />
                        <textarea value={editBack} onChange={(e) => setEditBack(e.target.value)} rows={2} placeholder="Back" />
                        <input value={editHint} onChange={(e) => setEditHint(e.target.value)} placeholder="Hint" />
                        <input value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="Comma-separated tags" />
                        <div className="inline-actions mobile-stack">
                          <button className="primary-button" onClick={() => {
                            updateCard(card._id, { front: editFront, back: editBack, hint: editHint, tags: editTags.split(',').map((tag) => tag.trim()).filter(Boolean) });
                            setEditingCardId(null);
                          }}>Save</button>
                          <button className="primary-button" onClick={() => setEditingCardId(null)}>Cancel</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <strong>{card.front}</strong>
                        <p>{card.back}</p>
                        <p className="muted small">{card.tags?.join(' • ') || 'No tags'}</p>
                      </>
                    )}
                  </div>
                  <div className="inline-actions mobile-stack">
                    <span className={`phase-tag ${card.state?.phase ?? "new"}`}>{card.templateOrdinal ? `card ${card.templateOrdinal + 1} · ` : ""}{card.state?.phase ?? "new"}{card.state?.flag ? ` · F${card.state.flag}` : ''}{card.state?.suspended ? ' · suspended' : ''}</span>
                    {editingCardId !== card._id ? (
                      <>
                        <button className="icon-button" aria-label="Edit card" onClick={() => {
                          setEditingCardId(card._id);
                          setEditFront(card.front);
                          setEditBack(card.back);
                          setEditHint(card.hint ?? '');
                          setEditTags((card.tags ?? []).join(', '));
                        }}><Pencil size={14} /></button>
                        <button className="icon-button" aria-label="Suspend card" onClick={() => setCardSuspended(card._id, !card.state?.suspended)}>{card.state?.suspended ? '▶' : '⏸'}</button>
                        <button className="icon-button" aria-label="Bury card" onClick={() => buryCard(card._id)}>B</button>
                        <select aria-label="Set flag" value={card.state?.flag ?? 0} onChange={(e) => setCardFlag(card._id, Number(e.target.value) as 0|1|2|3|4)}>
                          <option value={0}>No flag</option>
                          <option value={1}>Flag 1</option>
                          <option value={2}>Flag 2</option>
                          <option value={3}>Flag 3</option>
                          <option value={4}>Flag 4</option>
                        </select>
                        <button className="icon-button" aria-label="Delete card" onClick={() => {
                          if (!confirm('Delete this card?')) return;
                          deleteCard(card._id);
                          if (editingCardId === card._id) setEditingCardId(null);
                        }}><Trash2 size={14} /></button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass library-panel">
            <div className="section-title">Stats</div>
            <div className="card-list">
              <div className="upcoming-row">Mature: {study.stats.matureCards}</div>
              <div className="upcoming-row">Reviewed: {study.stats.reviewedCards}</div>
              <div className="upcoming-row">Suspended: {study.stats.suspendedCards}</div>
              <div className="upcoming-row">Buried: {study.stats.buriedCards}</div>
            </div>
          </div>

          <div className="glass library-panel">
            <div className="section-title">Recent reviews</div>
            <div className="card-list">
              {study.recentReviews?.length ? study.recentReviews.map((review: any) => (
                <div className="card-row" key={review._id}>
                  <div>
                    <strong>{String(review.rating).toUpperCase()}</strong>
                    <p>{review.reviewKind} · {review.lastInterval || 0}d → {review.interval || 0}d · {Math.round(review.takenMillis / 1000)}s</p>
                  </div>
                  <span className="phase-tag review">{Math.round(review.easeFactor * 100)}%</span>
                </div>
              )) : <div className="upcoming-row">No review history yet.</div>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state glass">
      <h2>No deck selected</h2>
      <p>Create a deck and start importing cards.</p>
    </div>
  );
}

function parseImport(raw: string): CardImport[] {
  const text = raw.trim();
  if (!text) throw new Error("Paste some cards first.");

  if (text.startsWith("[")) {
    const json = JSON.parse(text) as Array<Record<string, unknown>>;
    return json.map(normalizeCard).filter(Boolean) as CardImport[];
  }

  const delimiter = text.includes("\t") ? "\t" : undefined;
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    delimiter,
  });

  if (result.data.length) {
    return result.data.map(normalizeCard).filter(Boolean) as CardImport[];
  }

  return text.split("\n").map((line) => {
    const [front, back, tags] = line.split("::").map((part) => part.trim());
    if (!front || !back) throw new Error("Each plain-text line must look like front::back::optional,tags");
    return { front, back, tags: tags ? tags.split(",").map((tag) => tag.trim()).filter(Boolean) : [] };
  });
}

function normalizeCard(value: Record<string, unknown>): CardImport | null {
  const front = String(value.front ?? value.question ?? value.prompt ?? "").trim();
  const back = String(value.back ?? value.answer ?? "").trim();
  if (!front || !back) return null;
  const tagsValue = value.tags;
  const tags = Array.isArray(tagsValue)
    ? tagsValue.map(String)
    : typeof tagsValue === "string"
      ? tagsValue.split(/[;,|]/).map((tag) => tag.trim()).filter(Boolean)
      : [];
  return {
    front,
    back,
    hint: typeof value.hint === "string" ? value.hint : undefined,
    source: typeof value.source === "string" ? value.source : undefined,
    noteId: typeof value.noteId === "string" ? value.noteId : undefined,
    templateOrdinal: typeof value.templateOrdinal === "number" ? value.templateOrdinal : undefined,
    tags,
  };
}
