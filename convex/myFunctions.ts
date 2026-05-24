import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const learningSteps = [1 * MINUTE_MS, 10 * MINUTE_MS];

async function requireUser(ctx: { auth: any; db: any }) {
  const userId = await getAuthUserId(ctx as any);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  return userId;
}

function startOfDayKey(ts: number) {
  return new Date(ts).toISOString().slice(0, 10);
}

function nextSchedule(state: any, rating: "again" | "hard" | "good" | "easy", now: number) {
  const current = state ?? {
    phase: "new",
    interval: 0,
    easeFactor: 2.5,
    reps: 0,
    lapses: 0,
    stepIndex: 0,
  };
  let phase = current.phase;
  let interval = current.interval ?? 0;
  let easeFactor = Math.max(1.3, Math.min(3.0, current.easeFactor ?? 2.5));
  const reps = current.reps ?? 0;
  let lapses = current.lapses ?? 0;
  let stepIndex = current.stepIndex ?? 0;
  let dueAt = now;

  const graduate = (days: number, nextEase = easeFactor) => {
    phase = "review";
    interval = Math.max(1, Math.round(days));
    easeFactor = Math.max(1.3, Math.min(3.0, nextEase));
    stepIndex = undefined as unknown as number;
    dueAt = now + interval * DAY_MS;
  };

  if (phase === "new" || phase === "learning" || phase === "relearning") {
    if (rating === "again") {
      phase = phase === "relearning" ? "relearning" : "learning";
      stepIndex = 0;
      dueAt = now + learningSteps[0];
      interval = 0;
      easeFactor = Math.max(1.3, easeFactor - 0.2);
      if (current.phase === "review") lapses += 1;
    } else if (rating === "hard") {
      phase = phase === "relearning" ? "relearning" : "learning";
      stepIndex = Math.min(stepIndex, learningSteps.length - 1);
      dueAt = now + 5 * MINUTE_MS;
      easeFactor = Math.max(1.3, easeFactor - 0.15);
    } else if (rating === "good") {
      if (stepIndex >= learningSteps.length - 1) {
        graduate(1);
      } else {
        phase = phase === "relearning" ? "relearning" : "learning";
        stepIndex += 1;
        dueAt = now + learningSteps[stepIndex];
      }
    } else {
      graduate(4, easeFactor + 0.15);
    }
  }

  if (current.phase === "review") {
    if (rating === "again") {
      phase = "relearning";
      stepIndex = 0;
      lapses += 1;
      interval = Math.max(1, Math.round(interval * 0.5));
      easeFactor = Math.max(1.3, easeFactor - 0.2);
      dueAt = now + 10 * MINUTE_MS;
    } else if (rating === "hard") {
      easeFactor = Math.max(1.3, easeFactor - 0.15);
      interval = Math.max(interval + 1, Math.round(interval * 1.2));
      dueAt = now + interval * DAY_MS;
    } else if (rating === "good") {
      interval = Math.max(interval + 1, Math.round(interval * easeFactor));
      dueAt = now + interval * DAY_MS;
    } else {
      easeFactor = Math.min(3, easeFactor + 0.15);
      interval = Math.max(interval + 2, Math.round(interval * easeFactor * 1.3));
      dueAt = now + interval * DAY_MS;
    }
  }

  return {
    phase,
    interval,
    easeFactor,
    reps: reps + 1,
    lapses,
    stepIndex: Number.isFinite(stepIndex) ? stepIndex : undefined,
    dueAt,
    lastReviewedAt: now,
    lastRating: rating,
  };
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
        const aState = a.state;
        const bState = b.state;
        const aBucket = aState ? (aState.phase === "review" ? 1 : 0) : -1;
        const bBucket = bState ? (bState.phase === "review" ? 1 : 0) : -1;
        if (aBucket !== bBucket) return aBucket - bBucket;
        return (aState?.dueAt ?? 0) - (bState?.dueAt ?? 0);
      });

    const currentCard =
      dueCards.find((card: any) => String(card._id) === String(session?.currentCardId ?? "")) ?? dueCards[0] ?? null;

    return {
      deck,
      session,
      dueCounts: {
        due: dueCards.length,
        new: enriched.filter((card: any) => !card.state).length,
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
        easeFactor: 2.5,
        reps: 0,
        lapses: 0,
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
      ...schedule,
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
