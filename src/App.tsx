import { useMemo, useState } from "react";
import Papa from "papaparse";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, Download, Import, LoaderCircle, Plus, RotateCcw, Upload } from "lucide-react";
import {
  answerCard,
  createDeck,
  exportCollection,
  getDeck,
  getStudySession,
  getViewer,
  importCards,
  importCollection,
  listDecks,
  revealCurrentCard,
  resetCollection,
  useCollection,
} from "./localStore";
import type { Rating } from "./localStore";

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
  const [importText, setImportText] = useState("");
  const [importStatus, setImportStatus] = useState<string | null>(null);

  if (!deckData || !study) {
    return <div className="centered"><LoaderCircle className="spin" /></div>;
  }

  const currentCard = study.currentCard;
  const revealed = study.session?.revealed ?? false;

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
                    <span>{currentCard.state?.phase ?? "new"}</span>
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
              <span><Import size={18} /> Import cards</span>
            </div>
            <p className="muted small">CSV, TSV, JSON, or front::back::tags.</p>
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
              <span className="muted small">One row per note.</span>
            </div>
            {importStatus ? <div className="info-banner">{importStatus}</div> : null}
          </div>

          <div className="glass library-panel">
            <div className="section-title">Cards</div>
            <div className="library-meta">
              <span>{deckData.cards.length} saved</span>
              <span>{deckData.cards.filter((card: any) => card.state?.phase === "review").length} review</span>
              <span>{deckData.cards.filter((card: any) => card.isDue).length} due</span>
            </div>
            <div className="card-list">
              {deckData.cards.slice(0, 100).map((card: any) => (
                <div className="card-row" key={card._id}>
                  <div>
                    <strong>{card.front}</strong>
                    <p>{card.back}</p>
                  </div>
                  <span className={`phase-tag ${card.state?.phase ?? "new"}`}>{card.state?.phase ?? "new"}</span>
                </div>
              ))}
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
