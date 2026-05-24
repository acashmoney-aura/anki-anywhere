import { useMemo, useState } from "react";
import Papa from "papaparse";
import { AnimatePresence, motion } from "framer-motion";
import { Authenticated, Unauthenticated, useMutation, useQuery } from "convex/react";
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { BookOpen, Import, LoaderCircle, LogOut, Plus } from "lucide-react";
import { api } from "../convex/_generated/api";

type Deck = {
  _id: string;
  title: string;
  description?: string;
  cardCount: number;
  dueCount: number;
  reviewCount: number;
  learningCount: number;
  newCount: number;
};

type CardImport = {
  front: string;
  back: string;
  hint?: string;
  tags?: string[];
  source?: string;
};

const typedApi = api as any;

export default function App() {
  return (
    <div className="app-shell">
      <Unauthenticated>
        <Landing />
      </Unauthenticated>
      <Authenticated>
        <Dashboard />
      </Authenticated>
    </div>
  );
}

function Landing() {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <main className="landing compact-landing">
      <section className="hero-panel glass">
        <div className="eyebrow">Anki-style review</div>
        <h1>Anki Anywhere</h1>
        <p>Study on web or mobile. Import cards. Pick up where you left off.</p>
        <div className="hero-grid simple-grid">
          <Feature title="Real intervals" text="Again, Hard, Good, Easy with Anki-style defaults." />
          <Feature title="Synced" text="Decks and progress stay with your account." />
          <Feature title="Import" text="CSV, TSV, JSON, or front::back::tags." />
        </div>
      </section>

      <section className="auth-panel glass">
        <div>
          <h2>{mode === "signIn" ? "Sign in" : "Create account"}</h2>
          <p className="muted">Use email and password.</p>
        </div>

        <form
          className="auth-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            const formData = new FormData(event.currentTarget);
            formData.set("flow", mode);
            try {
              await signIn("password", formData);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not authenticate.");
              setBusy(false);
            }
          }}
        >
          <label>
            Email
            <input name="email" type="email" autoComplete="email" placeholder="akash@example.com" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete={mode === "signIn" ? "current-password" : "new-password"} placeholder="At least 8 characters" required />
          </label>
          <button className="primary-button" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={18} /> : null}
            {mode === "signIn" ? "Sign in" : "Create account"}
          </button>
        </form>

        {error ? <div className="error-banner">{error}</div> : null}
        <button className="text-button" onClick={() => setMode(mode === "signIn" ? "signUp" : "signIn")}>
          {mode === "signIn" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </section>
    </main>
  );
}

function Dashboard() {
  const decks = (useQuery(typedApi.myFunctions.listDecks) as Deck[] | undefined) ?? [];
  const viewer = useQuery(typedApi.users.viewer) as { email?: string; name?: string } | null | undefined;
  const createDeck = useMutation(typedApi.myFunctions.createDeck);
  const signOut = useAuthActions().signOut;
  const { isLoading } = useConvexAuth();
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [newDeckTitle, setNewDeckTitle] = useState("");
  const [newDeckDescription, setNewDeckDescription] = useState("");

  const selectedDeck = useMemo(
    () => decks.find((deck) => String(deck._id) === String(selectedDeckId)) ?? decks[0] ?? null,
    [decks, selectedDeckId],
  );

  if (isLoading) {
    return <div className="centered"><LoaderCircle className="spin" /></div>;
  }

  return (
    <main className="dashboard">
      <aside className="sidebar glass">
        <div className="sidebar-header">
          <div>
            <div className="eyebrow">Signed in</div>
            <strong>{viewer?.name ?? viewer?.email ?? "Learner"}</strong>
          </div>
          <button className="icon-button" onClick={() => void signOut()} aria-label="Sign out">
            <LogOut size={16} />
          </button>
        </div>

        <div className="create-deck-card">
          <h3>New deck</h3>
          <input value={newDeckTitle} onChange={(e) => setNewDeckTitle(e.target.value)} placeholder="Algorithms" />
          <textarea value={newDeckDescription} onChange={(e) => setNewDeckDescription(e.target.value)} placeholder="Optional note" rows={3} />
          <button
            className="primary-button"
            onClick={async () => {
              if (!newDeckTitle.trim()) return;
              const id = await createDeck({ title: newDeckTitle.trim(), description: newDeckDescription.trim() || undefined });
              setNewDeckTitle("");
              setNewDeckDescription("");
              setSelectedDeckId(String(id));
            }}
          >
            <Plus size={16} /> Create deck
          </button>
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
  const deckData = useQuery(typedApi.myFunctions.getDeck, { deckId }) as any;
  const study = useQuery(typedApi.myFunctions.getStudySession, { deckId }) as any;
  const revealCurrentCard = useMutation(typedApi.myFunctions.revealCurrentCard);
  const answerCard = useMutation(typedApi.myFunctions.answerCard);
  const importCards = useMutation(typedApi.myFunctions.importCards);
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
                  onClick={() => void revealCurrentCard({ deckId, currentCardId: currentCard._id, revealed: true })}
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
                      onClick={() => void answerCard({ deckId, cardId: currentCard._id, rating: value })}
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
              <p>You can close the app. Your progress is saved.</p>
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
                onClick={async () => {
                  try {
                    const parsed = parseImport(importText);
                    await importCards({ deckId, cards: parsed });
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
        </section>
      </div>
    </div>
  );
}

function Feature({ title, text }: { title: string; text: string }) {
  return (
    <div className="feature-card">
      <strong>{title}</strong>
      <p>{text}</p>
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
    tags,
  };
}
