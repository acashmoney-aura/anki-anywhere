import { useMemo, useState } from "react";
import Papa from "papaparse";
import { AnimatePresence, motion } from "framer-motion";
import { Authenticated, Unauthenticated, useMutation, useQuery } from "convex/react";
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import {
  BookOpen,
  Brain,
  ChevronRight,
  Cloud,
  Import,
  Layers,
  LoaderCircle,
  LogOut,
  Plus,
  Sparkles,
} from "lucide-react";
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
    <main className="landing">
      <section className="hero-panel glass">
        <div className="eyebrow"><Sparkles size={16} /> Anki-style spaced repetition, rebuilt for web + mobile</div>
        <h1>Anki Anywhere</h1>
        <p>
          Beautiful study sessions, per-user cloud sync, persistent progress, and a Convex backend so you can pick up exactly where you left off.
        </p>
        <div className="hero-grid">
          <Feature icon={<Brain size={18} />} title="Real review flow" text="Again, Hard, Good, Easy with persistent scheduling and resumable sessions." />
          <Feature icon={<Cloud size={18} />} title="Cloud synced" text="Your decks, cards, and study state live in Convex and follow you across devices." />
          <Feature icon={<Layers size={18} />} title="Import fast" text="Paste TSV / CSV / JSON flashcards or upload exported rows from anywhere." />
        </div>
      </section>
      <section className="auth-panel glass">
        <div>
          <h2>{mode === "signIn" ? "Welcome back" : "Create your study account"}</h2>
          <p className="muted">Password auth via Convex Auth. Simple and boring — exactly how auth should feel.</p>
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
            <div className="eyebrow">Signed in as</div>
            <strong>{viewer?.name ?? viewer?.email ?? "Learner"}</strong>
          </div>
          <button className="icon-button" onClick={() => void signOut()} aria-label="Sign out">
            <LogOut size={16} />
          </button>
        </div>

        <div className="create-deck-card">
          <h3>New deck</h3>
          <input value={newDeckTitle} onChange={(e) => setNewDeckTitle(e.target.value)} placeholder="Algorithms" />
          <textarea value={newDeckDescription} onChange={(e) => setNewDeckDescription(e.target.value)} placeholder="Interview prep, OS, DP, graphs..." rows={3} />
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
              <ChevronRight size={16} />
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
          <div className="eyebrow">Deck workspace</div>
          <h2>{summary.title}</h2>
          <p className="muted">{summary.description || "No description yet. Import some cards and start drilling."}</p>
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
              <div className="eyebrow">Study now</div>
              <strong>{study.dueCounts.due ? `${study.dueCounts.due} card${study.dueCounts.due === 1 ? "" : "s"} ready` : "All caught up"}</strong>
            </div>
            <span className="progress-chip">Reviewed today: {study.streak}</span>
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
                    ["again", "Again", "1m"],
                    ["hard", "Hard", currentCard.state?.phase === "review" ? "~harder" : "5m"],
                    ["good", "Good", currentCard.state?.phase === "review" ? "~next interval" : "10m/1d"],
                    ["easy", "Easy", currentCard.state?.phase === "review" ? "~longer" : "4d"],
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
              <h3>No cards due 🎉</h3>
              <p>Your deck is synced and saved. Come back later and your schedule will still be here.</p>
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
              <Import size={18} /> Import cards
            </div>
            <p className="muted small">
              Paste CSV / TSV / JSON. Supported columns: <code>front</code>, <code>back</code>, optional <code>hint</code>, <code>tags</code>, <code>source</code>.
            </p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={9}
              placeholder={'front,back,tags\n"TCP handshake","SYN → SYN-ACK → ACK","networks"'}
            />
            <div className="inline-actions">
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
                Import into deck
              </button>
              <span className="muted small">One row per note. Works on mobile too.</span>
            </div>
            {importStatus ? <div className="info-banner">{importStatus}</div> : null}
          </div>

          <div className="glass library-panel">
            <div className="section-title">Deck library</div>
            <div className="library-meta">
              <span>{deckData.cards.length} cards saved</span>
              <span>{deckData.cards.filter((card: any) => card.state?.phase === "review").length} in review</span>
              <span>{deckData.cards.filter((card: any) => card.isDue).length} due now</span>
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

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="feature-card">
      <div className="feature-icon">{icon}</div>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state glass">
      <h2>No deck selected</h2>
      <p>Create a deck on the left, dump in a batch of flashcards, and start studying.</p>
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
