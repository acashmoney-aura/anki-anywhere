import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const LEARNING_STEPS = [1, 10];
const RELEARNING_STEPS = [10];
const INITIAL_EASE_FACTOR = 2.5;
const MINIMUM_EASE_FACTOR = 1.3;
const HARD_MULTIPLIER = 1.2;
const EASY_MULTIPLIER = 1.3;
const LAPSE_MULTIPLIER = 0.0;
const MINIMUM_LAPSE_INTERVAL = 1;
const GRADUATING_INTERVAL_GOOD = 1;
const GRADUATING_INTERVAL_EASY = 4;

async function requireUser(ctx: { auth: unknown; db: unknown }) {
  const userId = await getAuthUserId(ctx as never);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  return userId;
}

function startOfDayKey(ts: number) {
  return new Date(ts).toISOString().slice(0, 10);
}

function clampEase(easeFactor: number) {
  return Math.max(MINIMUM_EASE_FACTOR, easeFactor);
}

function roundDays(interval: number, minimum: number) {
  return Math.max(minimum, Math.round(interval));
}

function formatDelay(ms: number) {
  if (ms % DAY_MS === 0) {
    const days = ms / DAY_MS;
    return `${days}d`;
  }
  const minutes = Math.round(ms / MINUTE_MS);
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    return `${hours}h`;
  }
  return `${minutes}m`;
}

function getCurrentStepIndex(state: any, steps: number[]) {
  const raw = typeof state?.stepIndex === "number" ? state.stepIndex : 0;
  return Math.max(0, Math.min(raw, Math.max(steps.length - 1, 0)));
}

function learningState(phase: "learning" | "relearning", intervalMinutes: number, stepIndex: number, now: number, overrides: Record<string, unknown> = {}) {
  return {
    phase,
    interval: 0,
    stepIndex,
    dueAt: now + intervalMinutes * MINUTE_MS,
    ...overrides,
  };
}

function reviewState(intervalDays: number, now: number, overrides: Record<string, unknown> = {}) {
  return {
    phase: "review",
    interval: intervalDays,
    stepIndex: undefined,
    dueAt: now + intervalDays * DAY_MS,
    ...overrides,
  };
}

function nextSchedule(state: any, rating: "again" | "hard" | "good" | "easy", now: number) {
  const current = state ?? {
    phase: "new",
    interval: 0,
    easeFactor: INITIAL_EASE_FACTOR,
    reps: 0,
    lapses: 0,
    stepIndex: 0,
  };

  const base = {
    easeFactor: clampEase(current.easeFactor ?? INITIAL_EASE_FACTOR),
    reps: (current.reps ?? 0) + 1,
    lapses: current.lapses ?? 0,
    lastReviewedAt: now,
    lastRating: rating,
  };

  if (current.phase === "review") {
    const scheduledDays = Math.max(1, current.interval ?? 1);
    const elapsedDays = current.lastReviewedAt
      ? Math.max(0, Math.floor((now - current.lastReviewedAt) / DAY_MS))
      : scheduledDays;
    const daysLate = Math.max(0, elapsedDays - scheduledDays);

    if (rating === "again") {
      const lapses = base.lapses + 1;
      const lapseInterval = roundDays(Math.max(1, scheduledDays) * LAPSE_MULTIPLIER, MINIMUM_LAPSE_INTERVAL);
      return {
        ...base,
        ...learningState("relearning", RELEARNING_STEPS[0], 0, now, {
          easeFactor: clampEase(base.easeFactor - 0.2),
          lapses,
          interval: lapseInterval,
        }),
      };
    }

    if (rating === "hard") {
      const hardInterval = roundDays(scheduledDays * HARD_MULTIPLIER, scheduledDays + 1);
      return {
        ...base,
        ...reviewState(hardInterval, now, {
          easeFactor: clampEase(base.easeFactor - 0.15),
        }),
      };
    }

    if (rating === "good") {
      const goodInterval = roundDays((scheduledDays + daysLate / 2) * base.easeFactor, scheduledDays + 1);
      return {
        ...base,
        ...reviewState(goodInterval, now),
      };
    }

    const hardInterval = roundDays(scheduledDays * HARD_MULTIPLIER, scheduledDays + 1);
    const goodInterval = roundDays((scheduledDays + daysLate / 2) * base.easeFactor, hardInterval + 1);
    const easyInterval = roundDays((scheduledDays + daysLate) * base.easeFactor * EASY_MULTIPLIER, goodInterval + 1);
    return {
      ...base,
      ...reviewState(easyInterval, now, {
        easeFactor: base.easeFactor + 0.15,
      }),
    };
  }

  const isRelearning = current.phase === "relearning";
  const steps = isRelearning ? RELEARNING_STEPS : LEARNING_STEPS;
  const phase: "learning" | "relearning" = isRelearning ? "relearning" : "learning";
  const stepIndex = getCurrentStepIndex(current, steps);
  const currentStep = steps[stepIndex] ?? steps[0] ?? 1;
  const nextStep = steps[stepIndex + 1];

  if (rating === "again") {
    return {
      ...base,
      ...learningState(phase, steps[0] ?? 1, 0, now),
    };
  }

  if (rating === "hard") {
    const hardMinutes = stepIndex === 0 && nextStep
      ? Math.round(((steps[0] ?? 1) + nextStep) / 2)
      : currentStep;
    return {
      ...base,
      ...learningState(phase, hardMinutes, stepIndex, now),
    };
  }

  if (rating === "good") {
    if (typeof nextStep === "number") {
      return {
        ...base,
        ...learningState(phase, nextStep, stepIndex + 1, now),
      };
    }

    if (isRelearning) {
      const intervalDays = Math.max(1, current.interval ?? 1);
      return {
        ...base,
        ...reviewState(intervalDays, now),
      };
    }

    return {
      ...base,
      ...reviewState(GRADUATING_INTERVAL_GOOD, now),
    };
  }

  if (isRelearning) {
    const intervalDays = Math.max(1, (current.interval ?? 1) + 1);
    return {
      ...base,
      ...reviewState(intervalDays, now),
    };
  }

  return {
    ...base,
    ...reviewState(GRADUATING_INTERVAL_EASY, now),
  };
}

function getAnswerPreview(state: any, now: number) {
  return {
    again: formatDelay(nextSchedule(state, "again", now).dueAt - now),
    hard: formatDelay(nextSchedule(state, "hard", now).dueAt - now),
    good: formatDelay(nextSchedule(state, "good", now).dueAt - now),
    easy: formatDelay(nextSchedule(state, "easy", now).dueAt - now),
  };
}

function queuePriority(card: any) {
  const phase = card.state?.phase;
  if (phase === "learning" || phase === "relearning") return 0;
  if (phase === "review") return 1;
  return 2;
}

export const listDecks = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const decks = await ctx.db
      .query("decks")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();
    const cardStates = await ctx.db.query("studyStates").collect();
    const cards = await ctx.db.query("cards").collect();
    const now = Date.now();

    return decks
      .map((deck: any) => {
        const deckCards = cards.filter((card: any) => String(card.deckId) === String(deck._id));
        const deckStates = cardStates.filter((state: any) => String(state.deckId) === String(deck._id));
        const due = deckStates.filter((state: any) => state.dueAt <= now).length;
        const reviewing = deckStates.filter((state: any) => state.phase === "review").length;
        const learning = deckStates.filter((state: any) => state.phase === "learning" || state.phase === "relearning").length;
        return {
          ...deck,
          cardCount: deckCards.length,
          dueCount: due,
          reviewCount: reviewing,
          learningCount: learning,
          newCount: Math.max(0, deckCards.length - deckStates.length),
        };
      })
      .sort((a: any, b: any) => b.updatedAt - a.updatedAt);
  },
});

export const getDeck = query({
  args: { deckId: v.id("decks") },
  handler: async (ctx, { deckId }) => {
    const userId = await requireUser(ctx);
    const deck = await ctx.db.get(deckId);
    if (!deck || String(deck.userId) !== String(userId)) return null;

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user_deck", (q: any) => q.eq("userId", userId).eq("deckId", deckId))
      .collect();
    const states = await ctx.db
      .query("studyStates")
      .withIndex("by_user_deck", (q: any) => q.eq("userId", userId).eq("deckId", deckId))
      .collect();
    const stateByCard = new Map(states.map((state: any) => [String(state.cardId), state]));
    const now = Date.now();

    return {
      deck,
      cards: cards
        .map((card: any) => ({
          ...card,
          state: stateByCard.get(String(card._id)) ?? null,
          isDue: (stateByCard.get(String(card._id))?.dueAt ?? 0) <= now,
        }))
        .sort((a: any, b: any) => a.front.localeCompare(b.front)),
    };
  },
});

export const getStudySession = query({
  args: { deckId: v.id("decks") },
  handler: async (ctx, { deckId }) => {
    const userId = await requireUser(ctx);
    const deck = await ctx.db.get(deckId);
    if (!deck || String(deck.userId) !== String(userId)) return null;
    const now = Date.now();
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user_deck", (q: any) => q.eq("userId", userId).eq("deckId", deckId))
      .collect();
    const states = await ctx.db
      .query("studyStates")
      .withIndex("by_user_deck", (q: any) => q.eq("userId", userId).eq("deckId", deckId))
      .collect();
    const stateByCard = new Map(states.map((state: any) => [String(state.cardId), state]));
    const sessions = await ctx.db
      .query("studySessions")
      .withIndex("by_user_deck", (q: any) => q.eq("userId", userId).eq("deckId", deckId))
      .collect();
    const session = sessions[0] ?? null;

    const enriched = cards.map((card: any) => ({
      ...card,
      state: stateByCard.get(String(card._id)) ?? null,
    }));
    const dueCards = enriched
      .filter((card: any) => {
        const dueAt = card.state?.dueAt ?? 0;
        return card.state ? dueAt <= now : true;
      })
      .sort((a: any, b: any) => {
        const queueDelta = queuePriority(a) - queuePriority(b);
        if (queueDelta !== 0) return queueDelta;
        return (a.state?.dueAt ?? 0) - (b.state?.dueAt ?? 0);
      });

    const rawCurrentCard =
      dueCards.find((card: any) => String(card._id) === String(session?.currentCardId ?? "")) ?? dueCards[0] ?? null;
    const currentCard = rawCurrentCard
      ? {
          ...rawCurrentCard,
          answerPreview: getAnswerPreview(rawCurrentCard.state, now),
        }
      : null;

    return {
      deck,
      session,
      dueCounts: {
        due: dueCards.length,
        new: enriched.filter((card: any) => card.state?.phase === "new").length,
        learning: enriched.filter((card: any) => ["learning", "relearning"].includes(card.state?.phase)).length,
        review: enriched.filter((card: any) => card.state?.phase === "review" && card.state?.dueAt <= now).length,
      },
      streak: session && session.lastStudiedDay === startOfDayKey(now) ? session.reviewedToday : 0,
      currentCard,
      upcoming: dueCards.slice(1, 6).map((card: any) => ({ _id: card._id, front: card.front })),
      stats: {
        totalCards: cards.length,
        reviewedCards: states.filter((state: any) => state.reps > 0).length,
        matureCards: states.filter((state: any) => state.phase === "review" && state.interval >= 21).length,
      },
    };
  },
});

export const createDeck = mutation({
  args: { title: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    return await ctx.db.insert("decks", {
      userId,
      title: args.title.trim(),
      description: args.description?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const importCards = mutation({
  args: {
    deckId: v.id("decks"),
    cards: v.array(
      v.object({
        front: v.string(),
        back: v.string(),
        hint: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        source: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { deckId, cards }) => {
    const userId = await requireUser(ctx);
    const deck = await ctx.db.get(deckId);
    if (!deck || String(deck.userId) !== String(userId)) throw new Error("Deck not found");
    const now = Date.now();
    for (const card of cards) {
      const cardId = await ctx.db.insert("cards", {
        userId,
        deckId,
        front: card.front.trim(),
        back: card.back.trim(),
        hint: card.hint?.trim() || undefined,
        tags: card.tags?.filter(Boolean).map((tag) => tag.trim()) ?? [],
        source: card.source?.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("studyStates", {
        userId,
        deckId,
        cardId,
        phase: "new",
        dueAt: 0,
        interval: 0,
        easeFactor: INITIAL_EASE_FACTOR,
        reps: 0,
        lapses: 0,
        stepIndex: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(deckId, { updatedAt: now });
    return { imported: cards.length };
  },
});

export const revealCurrentCard = mutation({
  args: { deckId: v.id("decks"), revealed: v.boolean(), currentCardId: v.optional(v.id("cards")) },
  handler: async (ctx, { deckId, revealed, currentCardId }) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const sessions = await ctx.db
      .query("studySessions")
      .withIndex("by_user_deck", (q: any) => q.eq("userId", userId).eq("deckId", deckId))
      .collect();
    const existing = sessions[0];
    const patch = {
      currentCardId,
      revealed,
      updatedAt: now,
      lastStudiedDay: startOfDayKey(now),
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("studySessions", {
      userId,
      deckId,
      currentCardId,
      revealed,
      reviewedToday: 0,
      lastStudiedDay: startOfDayKey(now),
      startedAt: now,
      updatedAt: now,
    });
  },
});

export const answerCard = mutation({
  args: {
    deckId: v.id("decks"),
    cardId: v.id("cards"),
    rating: v.union(v.literal("again"), v.literal("hard"), v.literal("good"), v.literal("easy")),
  },
  handler: async (ctx, { deckId, cardId, rating }) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const states = await ctx.db
      .query("studyStates")
      .withIndex("by_user_card", (q: any) => q.eq("userId", userId).eq("cardId", cardId))
      .collect();
    const current = states[0];
    if (!current) throw new Error("Study state missing");
    const schedule = nextSchedule(current, rating, now);
    await ctx.db.patch(current._id, {
      ...(schedule as any),
      updatedAt: now,
    });

    const sessions = await ctx.db
      .query("studySessions")
      .withIndex("by_user_deck", (q: any) => q.eq("userId", userId).eq("deckId", deckId))
      .collect();
    const session = sessions[0];
    const day = startOfDayKey(now);
    if (session) {
      await ctx.db.patch(session._id, {
        currentCardId: undefined,
        revealed: false,
        reviewedToday: session.lastStudiedDay === day ? session.reviewedToday + 1 : 1,
        lastStudiedDay: day,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("studySessions", {
        userId,
        deckId,
        currentCardId: undefined,
        revealed: false,
        reviewedToday: 1,
        lastStudiedDay: day,
        startedAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(deckId, { updatedAt: now });
    return schedule;
  },
});
