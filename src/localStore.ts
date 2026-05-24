import { useSyncExternalStore } from "react";

const STORAGE_KEY = "anki-anywhere.collection.v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export type Rating = "again" | "hard" | "good" | "easy";
export type Phase = "new" | "learning" | "review" | "relearning";

export type DeckConfig = {
  learnSteps: number[];
  relearnSteps: number[];
  graduatingIntervalGood: number;
  graduatingIntervalEasy: number;
  initialEaseFactor: number;
  minimumEaseFactor: number;
  hardMultiplier: number;
  easyMultiplier: number;
  lapseMultiplier: number;
  minimumLapseInterval: number;
  maximumReviewInterval: number;
  newCardsPerDay: number;
  reviewsPerDay: number;
  buryNew: boolean;
  buryReviews: boolean;
  rolloverHour: number;
  timezone: string;
};

export type Deck = {
  _id: string;
  userId: string;
  title: string;
  description?: string;
  config: DeckConfig;
  createdAt: number;
  updatedAt: number;
};

export type Card = {
  _id: string;
  userId: string;
  deckId: string;
  noteId: string;
  templateOrdinal: number;
  front: string;
  back: string;
  hint?: string;
  tags: string[];
  source?: string;
  createdAt: number;
  updatedAt: number;
};

export type StudyState = {
  _id: string;
  userId: string;
  deckId: string;
  cardId: string;
  phase: Phase;
  dueAt: number;
  dueDay?: number;
  interval: number;
  easeFactor: number;
  reps: number;
  lapses: number;
  stepIndex?: number;
  lastReviewedAt?: number;
  lastReviewedDay?: number;
  lastRating?: string;
  buriedUntilDay?: number;
  buriedReason?: string;
  createdAt: number;
  updatedAt: number;
};

export type StudySession = {
  _id: string;
  userId: string;
  deckId: string;
  currentCardId?: string;
  revealed: boolean;
  revealedAt?: number;
  reviewedToday: number;
  lastStudiedDay: string;
  lastStudiedDayNumber?: number;
  startedAt: number;
  updatedAt: number;
};

export type ReviewLog = {
  _id: string;
  userId: string;
  deckId: string;
  cardId: string;
  rating: Rating;
  reviewKind: "learning" | "review" | "relearning" | "filtered";
  interval: number;
  lastInterval: number;
  easeFactor: number;
  takenMillis: number;
  schedulerDay?: number;
  createdAt: number;
};

export type CardImport = {
  front: string;
  back: string;
  hint?: string;
  tags?: string[];
  source?: string;
  noteId?: string;
  templateOrdinal?: number;
};

export type NoteType = "basic" | "basic_reversed";

type Collection = {
  version: 1;
  viewer: { name: string; email: string };
  decks: Deck[];
  cards: Card[];
  studyStates: StudyState[];
  studySessions: StudySession[];
  reviewLogs: ReviewLog[];
};

const DEFAULT_DECK_CONFIG: DeckConfig = {
  learnSteps: [1, 10],
  relearnSteps: [10],
  graduatingIntervalGood: 1,
  graduatingIntervalEasy: 4,
  initialEaseFactor: 2.5,
  minimumEaseFactor: 1.3,
  hardMultiplier: 1.2,
  easyMultiplier: 1.3,
  lapseMultiplier: 0.0,
  minimumLapseInterval: 1,
  maximumReviewInterval: 36500,
  newCardsPerDay: 20,
  reviewsPerDay: 200,
  buryNew: false,
  buryReviews: false,
  rolloverHour: 4,
  timezone: "America/New_York",
};

const DEFAULT_COLLECTION: Collection = {
  version: 1,
  viewer: { name: "Local learner", email: "single-user mode" },
  decks: [],
  cards: [],
  studyStates: [],
  studySessions: [],
  reviewLogs: [],
};

const listeners = new Set<() => void>();
let currentCollection: Collection | null = null;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function loadCollection(): Collection {
  if (currentCollection) return currentCollection;
  if (typeof localStorage === "undefined") {
    currentCollection = clone(DEFAULT_COLLECTION);
    return currentCollection;
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    currentCollection = clone(DEFAULT_COLLECTION);
    return currentCollection;
  }
  try {
    const parsed = JSON.parse(raw) as Collection;
    currentCollection = {
      ...clone(DEFAULT_COLLECTION),
      ...parsed,
      viewer: parsed.viewer ?? clone(DEFAULT_COLLECTION.viewer),
      decks: parsed.decks ?? [],
      cards: parsed.cards ?? [],
      studyStates: parsed.studyStates ?? [],
      studySessions: parsed.studySessions ?? [],
      reviewLogs: parsed.reviewLogs ?? [],
    };
    return currentCollection;
  } catch {
    currentCollection = clone(DEFAULT_COLLECTION);
    return currentCollection;
  }
}

function saveCollection(collection: Collection) {
  currentCollection = clone(collection);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(currentCollection));
  listeners.forEach((listener) => listener());
}

function updateCollection(mutator: (collection: Collection) => void) {
  const collection = loadCollection();
  mutator(collection);
  saveCollection(collection);
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot() {
  return loadCollection();
}

export function useCollection() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function getZonedDateParts(ts: number, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(ts));
  const year = Number(parts.find((part) => part.type === "year")?.value ?? 1970);
  const month = Number(parts.find((part) => part.type === "month")?.value ?? 1);
  const day = Number(parts.find((part) => part.type === "day")?.value ?? 1);
  return { year, month, day };
}

function schedulerDayNumber(ts: number, config: DeckConfig) {
  const shifted = ts - config.rolloverHour * 60 * 60 * 1000;
  const { year, month, day } = getZonedDateParts(shifted, config.timezone);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function schedulerDayKey(ts: number, config: DeckConfig) {
  const shifted = ts - config.rolloverHour * 60 * 60 * 1000;
  const { year, month, day } = getZonedDateParts(shifted, config.timezone);
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function clampEase(easeFactor: number, config: DeckConfig) {
  return Math.max(config.minimumEaseFactor, easeFactor);
}

function roundDays(interval: number, minimum = 1, maximum = DEFAULT_DECK_CONFIG.maximumReviewInterval) {
  return Math.round(interval || 0).toString() === "NaN"
    ? minimum
    : Math.max(minimum, Math.min(maximum, Math.round(interval)));
}

function formatDelay(ms: number) {
  if (ms >= DAY_MS && ms % DAY_MS === 0) return `${ms / DAY_MS}d`;
  const minutes = Math.max(1, Math.round(ms / MINUTE_MS));
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function fuzzFactorForCard(cardId: string) {
  return (hashString(cardId) % 10_000) / 10_000;
}

function fuzzDelta(interval: number) {
  if (interval < 2.5) return 0;
  let delta = 1;
  delta += 0.15 * Math.max(0, Math.min(interval, 7) - 2.5);
  delta += 0.1 * Math.max(0, Math.min(interval, 20) - 7);
  delta += 0.05 * Math.max(0, interval - 20);
  return delta;
}

function constrainedFuzzBounds(interval: number, minimum: number, maximum: number) {
  const clampedMinimum = Math.min(minimum, maximum);
  const clampedInterval = Math.min(Math.max(interval, clampedMinimum), maximum);
  let lower = Math.round(clampedInterval - fuzzDelta(clampedInterval));
  let upper = Math.round(clampedInterval + fuzzDelta(clampedInterval));
  lower = Math.max(clampedMinimum, Math.min(lower, maximum));
  upper = Math.max(clampedMinimum, Math.min(upper, maximum));
  if (upper === lower && upper > 2 && upper < maximum) upper = lower + 1;
  return { lower, upper };
}

function applyReviewFuzz(interval: number, minimum: number, cardId: string, config: DeckConfig, fuzz = true) {
  const maximum = Math.max(1, config.maximumReviewInterval);
  const boundedMinimum = Math.max(1, Math.min(minimum, maximum));
  if (!fuzz) return roundDays(interval, boundedMinimum, maximum);
  const { lower, upper } = constrainedFuzzBounds(interval, boundedMinimum, maximum);
  const spread = upper - lower + 1;
  return Math.floor(lower + fuzzFactorForCard(cardId) * spread);
}

function getCurrentStepIndex(state: Partial<StudyState> | null | undefined, steps: number[]) {
  const raw = typeof state?.stepIndex === "number" ? state.stepIndex : 0;
  return Math.max(0, Math.min(raw, Math.max(steps.length - 1, 0)));
}

function getCurrentLearningStepMinutes(steps: number[], stepIndex: number) {
  return steps[stepIndex] ?? steps[0] ?? 1;
}

function getHardLearningDelayMinutes(steps: number[], stepIndex: number) {
  const current = getCurrentLearningStepMinutes(steps, stepIndex);
  const next = steps[stepIndex + 1];
  if (stepIndex === 0 && typeof next === "number") return (current + next) / 2;
  if (stepIndex === 0) return Math.min(current * 1.5, current + 24 * 60);
  return current;
}

function elapsedDays(state: Partial<StudyState> | null | undefined, now: number, config: DeckConfig) {
  if (typeof state?.lastReviewedDay === "number") {
    return Math.max(0, schedulerDayNumber(now, config) - state.lastReviewedDay);
  }
  if (!state?.lastReviewedAt) return Math.max(1, state?.interval ?? 1);
  return Math.max(0, Math.floor((now - state.lastReviewedAt) / DAY_MS));
}

function reviewState(intervalDays: number, now: number, config: DeckConfig, overrides: Record<string, unknown> = {}) {
  const currentDay = schedulerDayNumber(now, config);
  const dueDay = currentDay + intervalDays;
  return {
    phase: "review" as Phase,
    interval: intervalDays,
    dueDay,
    stepIndex: undefined,
    dueAt: now + intervalDays * DAY_MS,
    ...overrides,
  };
}

function learningState(phase: "learning" | "relearning", delayMinutes: number, stepIndex: number, now: number, overrides: Record<string, unknown> = {}) {
  return {
    phase,
    stepIndex,
    dueAt: now + delayMinutes * MINUTE_MS,
    ...overrides,
  };
}

function nextSchedule(state: StudyState | null | undefined, rating: Rating, now: number, cardId: string, config: DeckConfig) {
  const current = state ?? {
    phase: "new" as Phase,
    interval: 0,
    easeFactor: config.initialEaseFactor,
    reps: 0,
    lapses: 0,
    stepIndex: 0,
  };

  const phase = (current.phase ?? "new") as Phase;
  const base = {
    easeFactor: clampEase(current.easeFactor ?? config.initialEaseFactor, config),
    reps: (current.reps ?? 0) + 1,
    lapses: current.lapses ?? 0,
    lastReviewedAt: now,
    lastReviewedDay: schedulerDayNumber(now, config),
    lastRating: rating,
  };

  if (phase === "review") {
    const scheduledDays = Math.max(1, current.interval ?? 1);
    const elapsed = elapsedDays(current, now, config);
    const daysLate = elapsed - scheduledDays;

    if (rating === "again") {
      const lapses = base.lapses + 1;
      const lapseInterval = applyReviewFuzz(
        Math.max(1, scheduledDays) * config.lapseMultiplier,
        config.minimumLapseInterval,
        cardId,
        config,
        true,
      );
      return {
        ...base,
        ...learningState("relearning", config.relearnSteps[0] ?? 10, 0, now, {
          easeFactor: clampEase(base.easeFactor - 0.2, config),
          lapses,
          interval: lapseInterval,
        }),
      };
    }

    if (daysLate < 0) {
      const scheduled = Math.max(1, scheduledDays);
      const elapsedPositive = Math.max(0, elapsed);
      const hardInterval = roundDays(Math.max(elapsedPositive * config.hardMultiplier, scheduled * (config.hardMultiplier / 2)), 1, config.maximumReviewInterval);
      const goodInterval = roundDays(Math.max(elapsedPositive * base.easeFactor, scheduled), 1, config.maximumReviewInterval);
      const reducedEasyBonus = config.easyMultiplier - (config.easyMultiplier - 1) / 2;
      const easyInterval = roundDays(Math.max(elapsedPositive * base.easeFactor, scheduled) * reducedEasyBonus, 1, config.maximumReviewInterval);
      if (rating === "hard") return { ...base, ...reviewState(hardInterval, now, config, { easeFactor: clampEase(base.easeFactor - 0.15, config) }) };
      if (rating === "good") return { ...base, ...reviewState(goodInterval, now, config) };
      return { ...base, ...reviewState(Math.max(goodInterval + 1, easyInterval), now, config, { easeFactor: base.easeFactor + 0.15 }) };
    }

    const hardMinimum = config.hardMultiplier <= 1 ? 0 : scheduledDays + 1;
    const hardInterval = applyReviewFuzz(scheduledDays * config.hardMultiplier, hardMinimum, cardId, config, true);
    const goodMinimum = config.hardMultiplier <= 1 ? scheduledDays + 1 : hardInterval + 1;
    const goodInterval = applyReviewFuzz((scheduledDays + Math.max(daysLate, 0) / 2) * base.easeFactor, goodMinimum, cardId, config, true);
    const easyInterval = applyReviewFuzz((scheduledDays + Math.max(daysLate, 0)) * base.easeFactor * config.easyMultiplier, goodInterval + 1, cardId, config, true);
    if (rating === "hard") return { ...base, ...reviewState(hardInterval, now, config, { easeFactor: clampEase(base.easeFactor - 0.15, config) }) };
    if (rating === "good") return { ...base, ...reviewState(goodInterval, now, config) };
    return { ...base, ...reviewState(easyInterval, now, config, { easeFactor: base.easeFactor + 0.15 }) };
  }

  const isRelearning = phase === "relearning";
  const steps = isRelearning ? config.relearnSteps : config.learnSteps;
  const stepIndex = phase === "new" ? 0 : getCurrentStepIndex(state, steps);
  const nextStep = steps[stepIndex + 1];

  if (rating === "again") return { ...base, ...learningState(isRelearning ? "relearning" : "learning", steps[0] ?? 1, 0, now, { interval: isRelearning ? Math.max(1, current.interval ?? 1) : 0 }) };
  if (rating === "hard") return { ...base, ...learningState(isRelearning ? "relearning" : "learning", getHardLearningDelayMinutes(steps, stepIndex), stepIndex, now, { interval: isRelearning ? Math.max(1, current.interval ?? 1) : 0 }) };
  if (rating === "good") {
    if (typeof nextStep === "number") {
      return { ...base, ...learningState(isRelearning ? "relearning" : "learning", nextStep, stepIndex + 1, now, { interval: isRelearning ? Math.max(1, current.interval ?? 1) : 0 }) };
    }
    return { ...base, ...reviewState(isRelearning ? Math.max(1, current.interval ?? 1) : applyReviewFuzz(config.graduatingIntervalGood, 1, cardId, config, true), now, config) };
  }
  return { ...base, ...reviewState(isRelearning ? Math.max(Math.max(1, current.interval ?? 1) + 1, 2) : applyReviewFuzz(config.graduatingIntervalEasy, config.graduatingIntervalGood + 1, cardId, config, true), now, config, { easeFactor: base.easeFactor }) };
}

function getAnswerPreview(state: StudyState | null | undefined, now: number, cardId: string, config: DeckConfig) {
  return {
    again: formatDelay((nextSchedule(state, "again", now, cardId, config) as any).dueAt - now),
    hard: formatDelay((nextSchedule(state, "hard", now, cardId, config) as any).dueAt - now),
    good: formatDelay((nextSchedule(state, "good", now, cardId, config) as any).dueAt - now),
    easy: formatDelay((nextSchedule(state, "easy", now, cardId, config) as any).dueAt - now),
  };
}

function isBuried(state: StudyState | null | undefined, currentDay: number) {
  return typeof state?.buriedUntilDay === "number" && state.buriedUntilDay >= currentDay;
}

function isCardDue(state: StudyState | null | undefined, now: number, config: DeckConfig) {
  const currentDay = schedulerDayNumber(now, config);
  if (isBuried(state, currentDay)) return false;
  if (!state || state.phase === "new") return true;
  if (state.phase === "review" && typeof state.dueDay === "number") return state.dueDay <= currentDay;
  return state.dueAt <= now;
}

function queuePriority(card: { state?: StudyState | null }) {
  const phase = card.state?.phase;
  if (phase === "learning" || phase === "relearning") return 0;
  if (phase === "review") return 1;
  return 2;
}

export function getViewer() {
  return loadCollection().viewer;
}

export function listDecks() {
  const collection = loadCollection();
  const now = Date.now();
  return collection.decks.map((deck) => {
    const deckCards = collection.cards.filter((card) => card.deckId === deck._id);
    const deckStates = collection.studyStates.filter((state) => state.deckId === deck._id);
    const due = deckStates.filter((state) => isCardDue(state, now, deck.config)).length;
    const reviewing = deckStates.filter((state) => state.phase === "review").length;
    const learning = deckStates.filter((state) => state.phase === "learning" || state.phase === "relearning").length;
    const newCards = deckStates.filter((state) => state.phase === "new").length;
    return { ...deck, cardCount: deckCards.length, dueCount: due, reviewCount: reviewing, learningCount: learning, newCount: newCards };
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createDeck({ title, description }: { title: string; description?: string }) {
  const now = Date.now();
  const deck: Deck = { _id: makeId("deck"), userId: "local-user", title: title.trim(), description: description?.trim() || undefined, config: clone(DEFAULT_DECK_CONFIG), createdAt: now, updatedAt: now };
  updateCollection((collection) => { collection.decks.unshift(deck); });
  return deck._id;
}

export function getDeck(deckId: string) {
  const collection = loadCollection();
  const deck = collection.decks.find((item) => item._id === deckId);
  if (!deck) return null;
  const cards = collection.cards.filter((card) => card.deckId === deckId);
  const now = Date.now();
  return {
    deck,
    cards: cards.map((card) => {
      const state = collection.studyStates.find((item) => item.cardId === card._id) ?? null;
      return { ...card, state, isDue: isCardDue(state, now, deck.config) };
    }).sort((a, b) => a.front.localeCompare(b.front)),
  };
}

export function getStudySession(deckId: string) {
  const collection = loadCollection();
  const deck = collection.decks.find((item) => item._id === deckId);
  if (!deck) return null;
  const now = Date.now();
  const cards = collection.cards.filter((card) => card.deckId === deckId);
  const session = collection.studySessions.find((item) => item.deckId === deckId) ?? null;
  const enriched = cards.map((card) => ({ ...card, state: collection.studyStates.find((state) => state.cardId === card._id) ?? null }));
  const dueCards = enriched.filter((card) => isCardDue(card.state, now, deck.config)).sort((a, b) => {
    const queueDelta = queuePriority(a) - queuePriority(b);
    if (queueDelta !== 0) return queueDelta;
    return (a.state?.dueAt ?? 0) - (b.state?.dueAt ?? 0);
  });
  const recentReviews = collection.reviewLogs.filter((log) => log.deckId === deckId);
  const todayDayNumber = schedulerDayNumber(now, deck.config);
  const todayKey = schedulerDayKey(now, deck.config);
  const todayReviews = recentReviews.filter((review) => review.schedulerDay === todayDayNumber || schedulerDayKey(review.createdAt, deck.config) === todayKey);
  const introducedToday = new Set(todayReviews.filter((review) => review.reviewKind === "learning" && review.lastInterval === 0).map((review) => review.cardId));
  const reviewDoneToday = todayReviews.filter((review) => ["review", "filtered"].includes(review.reviewKind)).length;
  const dueLearning = dueCards.filter((card) => ["learning", "relearning"].includes(card.state?.phase ?? ""));
  const dueReview = dueCards.filter((card) => card.state?.phase === "review").slice(0, Math.max(0, deck.config.reviewsPerDay - reviewDoneToday));
  const dueNew = dueCards.filter((card) => !card.state || card.state.phase === "new").slice(0, Math.max(0, deck.config.newCardsPerDay - introducedToday.size));
  const sessionCards = [...dueLearning, ...dueReview, ...dueNew].length ? [...dueLearning, ...dueReview, ...dueNew] : dueCards;
  const rawCurrentCard = sessionCards.find((card) => card._id === session?.currentCardId) ?? sessionCards[0] ?? null;
  const currentCard = rawCurrentCard ? { ...rawCurrentCard, answerPreview: getAnswerPreview(rawCurrentCard.state, now, rawCurrentCard._id, deck.config) } : null;
  return {
    deck,
    session,
    deckConfig: deck.config,
    dueCounts: {
      due: sessionCards.length,
      new: enriched.filter((card) => card.state?.phase === "new").length,
      learning: enriched.filter((card) => ["learning", "relearning"].includes(card.state?.phase ?? "")).length,
      review: enriched.filter((card) => card.state?.phase === "review" && isCardDue(card.state, now, deck.config)).length,
    },
    streak: session && (session.lastStudiedDayNumber === todayDayNumber || session.lastStudiedDay === todayKey) ? session.reviewedToday : 0,
    currentCard,
    upcoming: sessionCards.slice(1, 6).map((card) => ({ _id: card._id, front: card.front })),
    stats: {
      totalCards: cards.length,
      reviewedCards: collection.studyStates.filter((state) => state.deckId === deckId && state.reps > 0).length,
      matureCards: collection.studyStates.filter((state) => state.deckId === deckId && state.phase === "review" && state.interval >= 21).length,
    },
    recentReviews: recentReviews.sort((a, b) => b.createdAt - a.createdAt).slice(0, 12),
  };
}

function insertCard(collection: Collection, deck: Deck, now: number, deckId: string, card: CardImport, noteId: string, templateOrdinal: number) {
  const cardId = makeId("card");
  collection.cards.push({
    _id: cardId,
    userId: "local-user",
    deckId,
    noteId,
    templateOrdinal,
    front: card.front.trim(),
    back: card.back.trim(),
    hint: card.hint?.trim() || undefined,
    tags: card.tags?.filter(Boolean).map((tag) => tag.trim()) ?? [],
    source: card.source?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  });
  collection.studyStates.push({
    _id: makeId("state"),
    userId: "local-user",
    deckId,
    cardId,
    phase: "new",
    dueAt: 0,
    dueDay: undefined,
    interval: 0,
    easeFactor: deck.config.initialEaseFactor,
    reps: 0,
    lapses: 0,
    stepIndex: 0,
    buriedUntilDay: undefined,
    buriedReason: undefined,
    createdAt: now,
    updatedAt: now,
  });
}

export function addNote(deckId: string, note: { front: string; back: string; hint?: string; tags?: string[]; source?: string; noteType?: NoteType }) {
  const now = Date.now();
  const noteType = note.noteType ?? "basic";
  updateCollection((collection) => {
    const deck = collection.decks.find((item) => item._id === deckId);
    if (!deck) throw new Error("Deck not found");
    const noteId = `note:${now}:${Math.random().toString(36).slice(2, 8)}`;
    insertCard(collection, deck, now, deckId, { ...note, noteId, templateOrdinal: 0 }, noteId, 0);
    if (noteType === "basic_reversed") {
      insertCard(
        collection,
        deck,
        now,
        deckId,
        {
          front: note.back,
          back: note.front,
          hint: note.hint,
          tags: note.tags,
          source: note.source,
          noteId,
          templateOrdinal: 1,
        },
        noteId,
        1,
      );
    }
    deck.updatedAt = now;
  });
}

export function importCards(deckId: string, cards: CardImport[]) {
  const now = Date.now();
  updateCollection((collection) => {
    const deck = collection.decks.find((item) => item._id === deckId);
    if (!deck) throw new Error("Deck not found");
    for (const [index, card] of cards.entries()) {
      const noteId = card.noteId?.trim() || `note:${now}:${index}:${Math.random().toString(36).slice(2, 8)}`;
      insertCard(collection, deck, now, deckId, card, noteId, card.templateOrdinal ?? 0);
    }
    deck.updatedAt = now;
  });
  return { imported: cards.length };
}

export function revealCurrentCard(deckId: string, currentCardId: string | undefined, revealed: boolean) {
  const now = Date.now();
  updateCollection((collection) => {
    const deck = collection.decks.find((item) => item._id === deckId);
    if (!deck) throw new Error("Deck not found");
    const patch = { currentCardId, revealed, revealedAt: revealed ? now : undefined, updatedAt: now, lastStudiedDay: schedulerDayKey(now, deck.config), lastStudiedDayNumber: schedulerDayNumber(now, deck.config) };
    const existing = collection.studySessions.find((item) => item.deckId === deckId);
    if (existing) Object.assign(existing, patch);
    else collection.studySessions.push({ _id: makeId("session"), userId: "local-user", deckId, currentCardId, revealed, revealedAt: revealed ? now : undefined, reviewedToday: 0, lastStudiedDay: schedulerDayKey(now, deck.config), lastStudiedDayNumber: schedulerDayNumber(now, deck.config), startedAt: now, updatedAt: now });
  });
}

export function answerCard(deckId: string, cardId: string, rating: Rating) {
  const now = Date.now();
  let schedule: any = null;
  updateCollection((collection) => {
    const deck = collection.decks.find((item) => item._id === deckId);
    const card = collection.cards.find((item) => item._id === cardId);
    if (!deck || !card) throw new Error("Deck/card not found");
    const current = collection.studyStates.find((item) => item.cardId === cardId);
    if (!current) throw new Error("Study state missing");
    schedule = nextSchedule(current, rating, now, cardId, deck.config);
    Object.assign(current, schedule, { buriedUntilDay: undefined, buriedReason: undefined, updatedAt: now });

    const session = collection.studySessions.find((item) => item.deckId === deckId) ?? null;
    const day = schedulerDayKey(now, deck.config);
    const dayNumber = schedulerDayNumber(now, deck.config);
    const takenMillis = Math.min(60_000, Math.max(0, now - (session?.revealedAt ?? now)));
    const reviewKind = current.phase === "review"
      ? elapsedDays(current, now, deck.config) < current.interval ? "filtered" : "review"
      : current.phase === "relearning" ? "relearning" : "learning";

    const shouldBurySiblings = (current.phase === "review" && deck.config.buryReviews) || (current.phase !== "review" && deck.config.buryNew);
    if (shouldBurySiblings) {
      const siblingCards = collection.cards.filter((item) => item.deckId === deckId && item.noteId === card.noteId && item._id !== cardId);
      for (const sibling of siblingCards) {
        const siblingState = collection.studyStates.find((item) => item.cardId === sibling._id);
        if (!siblingState || !isCardDue(siblingState, now, deck.config)) continue;
        siblingState.buriedUntilDay = dayNumber;
        siblingState.buriedReason = current.phase === "review" ? "sibling-review" : "sibling-new";
        siblingState.updatedAt = now;
      }
    }

    collection.reviewLogs.push({ _id: makeId("review"), userId: "local-user", deckId, cardId, rating, reviewKind, interval: schedule.interval ?? 0, lastInterval: current.interval ?? 0, easeFactor: schedule.easeFactor ?? current.easeFactor, takenMillis, schedulerDay: dayNumber, createdAt: now });

    if (session) {
      Object.assign(session, { currentCardId: undefined, revealed: false, revealedAt: undefined, reviewedToday: session.lastStudiedDayNumber === dayNumber || session.lastStudiedDay === day ? session.reviewedToday + 1 : 1, lastStudiedDay: day, lastStudiedDayNumber: dayNumber, updatedAt: now });
    } else {
      collection.studySessions.push({ _id: makeId("session"), userId: "local-user", deckId, currentCardId: undefined, revealed: false, revealedAt: undefined, reviewedToday: 1, lastStudiedDay: day, lastStudiedDayNumber: dayNumber, startedAt: now, updatedAt: now });
    }
    deck.updatedAt = now;
  });
  return schedule;
}

export function exportCollection() {
  return JSON.stringify(loadCollection(), null, 2);
}

export function importCollection(raw: string) {
  const parsed = JSON.parse(raw) as Collection;
  saveCollection({ ...clone(DEFAULT_COLLECTION), ...parsed, version: 1 });
}

export function resetCollection() {
  saveCollection(clone(DEFAULT_COLLECTION));
}
