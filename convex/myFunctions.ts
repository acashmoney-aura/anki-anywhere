import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DEFAULT_DECK_CONFIG = {
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

type Rating = "again" | "hard" | "good" | "easy";
type Phase = "new" | "learning" | "review" | "relearning";

type DeckConfig = typeof DEFAULT_DECK_CONFIG;

async function requireUser(ctx: { auth: unknown; db: unknown }) {
  const userId = await getAuthUserId(ctx as never);
  if (!userId) throw new Error("Not authenticated");
  return userId;
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

function getDeckConfig(deck: any): DeckConfig {
  return {
    ...DEFAULT_DECK_CONFIG,
    ...(deck?.config ?? {}),
  };
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

function getCurrentStepIndex(state: any, steps: number[]) {
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

function elapsedDays(state: any, now: number, config: DeckConfig) {
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

function learningState(
  phase: "learning" | "relearning",
  delayMinutes: number,
  stepIndex: number,
  now: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    phase,
    stepIndex,
    dueAt: now + delayMinutes * MINUTE_MS,
    ...overrides,
  };
}

function nextSchedule(state: any, rating: Rating, now: number, cardId: string, config: DeckConfig) {
  const current = state ?? {
    phase: "new",
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
      const hardInterval = roundDays(
        Math.max(elapsedPositive * config.hardMultiplier, scheduled * (config.hardMultiplier / 2)),
        1,
        config.maximumReviewInterval,
      );
      const goodInterval = roundDays(Math.max(elapsedPositive * base.easeFactor, scheduled), 1, config.maximumReviewInterval);
      const reducedEasyBonus = config.easyMultiplier - (config.easyMultiplier - 1) / 2;
      const easyInterval = roundDays(Math.max(elapsedPositive * base.easeFactor, scheduled) * reducedEasyBonus, 1, config.maximumReviewInterval);

      if (rating === "hard") {
        return {
          ...base,
          ...reviewState(hardInterval, now, config, {
            easeFactor: clampEase(base.easeFactor - 0.15, config),
          }),
        };
      }
      if (rating === "good") {
        return { ...base, ...reviewState(goodInterval, now, config) };
      }
      return {
        ...base,
        ...reviewState(Math.max(goodInterval + 1, easyInterval), now, config, {
          easeFactor: base.easeFactor + 0.15,
        }),
      };
    }

    const hardMinimum = config.hardMultiplier <= 1 ? 0 : scheduledDays + 1;
    const hardInterval = applyReviewFuzz(scheduledDays * config.hardMultiplier, hardMinimum, cardId, config, true);
    const goodMinimum = config.hardMultiplier <= 1 ? scheduledDays + 1 : hardInterval + 1;
    const goodInterval = applyReviewFuzz((scheduledDays + Math.max(daysLate, 0) / 2) * base.easeFactor, goodMinimum, cardId, config, true);
    const easyInterval = applyReviewFuzz((scheduledDays + Math.max(daysLate, 0)) * base.easeFactor * config.easyMultiplier, goodInterval + 1, cardId, config, true);

    if (rating === "hard") {
      return {
        ...base,
        ...reviewState(hardInterval, now, config, {
          easeFactor: clampEase(base.easeFactor - 0.15, config),
        }),
      };
    }
    if (rating === "good") {
      return { ...base, ...reviewState(goodInterval, now, config) };
    }
    return {
      ...base,
      ...reviewState(easyInterval, now, config, {
        easeFactor: base.easeFactor + 0.15,
      }),
    };
  }

  const isRelearning = phase === "relearning";
  const steps = isRelearning ? config.relearnSteps : config.learnSteps;
  const stepIndex = phase === "new" ? 0 : getCurrentStepIndex(current, steps);
  const nextStep = steps[stepIndex + 1];

  if (rating === "again") {
    return {
      ...base,
      ...learningState(isRelearning ? "relearning" : "learning", steps[0] ?? 1, 0, now, {
        interval: isRelearning ? Math.max(1, current.interval ?? 1) : 0,
      }),
    };
  }

  if (rating === "hard") {
    const hardDelay = getHardLearningDelayMinutes(steps, stepIndex);
    return {
      ...base,
      ...learningState(isRelearning ? "relearning" : "learning", hardDelay, stepIndex, now, {
        interval: isRelearning ? Math.max(1, current.interval ?? 1) : 0,
      }),
    };
  }

  if (rating === "good") {
    if (typeof nextStep === "number") {
      return {
        ...base,
        ...learningState(isRelearning ? "relearning" : "learning", nextStep, stepIndex + 1, now, {
          interval: isRelearning ? Math.max(1, current.interval ?? 1) : 0,
        }),
      };
    }

    return {
      ...base,
      ...reviewState(
        isRelearning
          ? Math.max(1, current.interval ?? 1)
          : applyReviewFuzz(config.graduatingIntervalGood, 1, cardId, config, true),
        now,
        config,
      ),
    };
  }

  return {
    ...base,
    ...reviewState(
      isRelearning
        ? Math.max(Math.max(1, current.interval ?? 1) + 1, 2)
        : applyReviewFuzz(config.graduatingIntervalEasy, config.graduatingIntervalGood + 1, cardId, config, true),
      now,
      config,
      { easeFactor: base.easeFactor },
    ),
  };
}

function getAnswerPreview(state: any, now: number, cardId: string, config: DeckConfig) {
  return {
    again: formatDelay(nextSchedule(state, "again", now, cardId, config).dueAt - now),
    hard: formatDelay(nextSchedule(state, "hard", now, cardId, config).dueAt - now),
    good: formatDelay(nextSchedule(state, "good", now, cardId, config).dueAt - now),
    easy: formatDelay(nextSchedule(state, "easy", now, cardId, config).dueAt - now),
  };
}

function isBuried(state: any, currentDay: number) {
  return typeof state?.buriedUntilDay === "number" && state.buriedUntilDay >= currentDay;
}

function isCardDue(state: any, now: number, config: DeckConfig) {
  const currentDay = schedulerDayNumber(now, config);
  if (isBuried(state, currentDay)) return false;
  if (!state || state.phase === "new") return true;
  if (state.phase === "review") {
    if (typeof state.dueDay === "number") return state.dueDay <= currentDay;
  }
  return state.dueAt <= now;
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
    const decks = await ctx.db.query("decks").withIndex("by_user", (q: any) => q.eq("userId", userId)).collect();
    const cardStates = await ctx.db.query("studyStates").collect();
    const cards = await ctx.db.query("cards").collect();
    const now = Date.now();

    return decks
      .map((deck: any) => {
        const deckConfig = getDeckConfig(deck);
        const deckCards = cards.filter((card: any) => String(card.deckId) === String(deck._id));
        const deckStates = cardStates.filter((state: any) => String(state.deckId) === String(deck._id));
        const due = deckStates.filter((state: any) => isCardDue(state, now, deckConfig)).length;
        const reviewing = deckStates.filter((state: any) => state.phase === "review").length;
        const learning = deckStates.filter((state: any) => state.phase === "learning" || state.phase === "relearning").length;
        const newCards = deckStates.filter((state: any) => state.phase === "new").length;
        return {
          ...deck,
          cardCount: deckCards.length,
          dueCount: due,
          reviewCount: reviewing,
          learningCount: learning,
          newCount: newCards,
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

    const cards = await ctx.db.query("cards").withIndex("by_user_deck", (q: any) => q.eq("userId", userId).eq("deckId", deckId)).collect();
    const states = await ctx.db.query("studyStates").withIndex("by_user_deck", (q: any) => q.eq("userId", userId).eq("deckId", deckId)).collect();
    const stateByCard = new Map(states.map((state: any) => [String(state.cardId), state]));
    const now = Date.now();

    const deckConfig = getDeckConfig(deck);
    return {
      deck,
      cards: cards
        .map((card: any) => {
          const state = stateByCard.get(String(card._id)) ?? null;
          return {
            ...card,
            state,
            isDue: isCardDue(state, now, deckConfig),
          };
        })
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
    const cards = await ctx.db.query("cards").withIndex("by_user_deck", (q: any) => q.eq("userId", userId).eq("deckId", deckId)).collect();
    const states = await ctx.db.query("studyStates").withIndex("by_user_deck", (q: any) => q.eq("userId", userId).eq("deckId", deckId)).collect();
    const stateByCard = new Map(states.map((state: any) => [String(state.cardId), state]));
    const sessions = await ctx.db.query("studySessions").withIndex("by_user_deck", (q: any) => q.eq("userId", userId).eq("deckId", deckId)).collect();
    const session = sessions[0] ?? null;

    const enriched = cards.map((card: any) => ({
      ...card,
      state: stateByCard.get(String(card._id)) ?? null,
    }));
    const deckConfig = getDeckConfig(deck);
    const dueCards = enriched
      .filter((card: any) => isCardDue(card.state, now, deckConfig))
      .sort((a: any, b: any) => {
        const queueDelta = queuePriority(a) - queuePriority(b);
        if (queueDelta !== 0) return queueDelta;
        return (a.state?.dueAt ?? 0) - (b.state?.dueAt ?? 0);
      });

    const recentReviews = await ctx.db
      .query("reviewLogs")
      .withIndex("by_user_deck", (q: any) => q.eq("userId", userId).eq("deckId", deckId))
      .collect();
    const todayDayNumber = schedulerDayNumber(now, deckConfig);
    const todayKey = schedulerDayKey(now, deckConfig);
    const todayReviews = recentReviews.filter((review: any) => review.schedulerDay === todayDayNumber || schedulerDayKey(review.createdAt, deckConfig) === todayKey);
    const introducedToday = new Set(
      todayReviews
        .filter((review: any) => review.reviewKind === "learning" && review.lastInterval === 0)
        .map((review: any) => String(review.cardId)),
    );
    const reviewDoneToday = todayReviews.filter((review: any) => ["review", "filtered"].includes(review.reviewKind)).length;
    const dueLearning = dueCards.filter((card: any) => ["learning", "relearning"].includes(card.state?.phase));
    const dueReview = dueCards.filter((card: any) => card.state?.phase === "review").slice(0, Math.max(0, deckConfig.reviewsPerDay - reviewDoneToday));
    const dueNew = dueCards.filter((card: any) => !card.state || card.state?.phase === "new").slice(0, Math.max(0, deckConfig.newCardsPerDay - introducedToday.size));
    const limitedDueCards = [...dueLearning, ...dueReview, ...dueNew];
    const sessionCards = limitedDueCards.length ? limitedDueCards : dueCards;
    const rawCurrentCard = sessionCards.find((card: any) => String(card._id) === String(session?.currentCardId ?? "")) ?? sessionCards[0] ?? null;
    const currentCard = rawCurrentCard
      ? {
          ...rawCurrentCard,
          answerPreview: getAnswerPreview(rawCurrentCard.state, now, String(rawCurrentCard._id), deckConfig),
        }
      : null;

    return {
      deck,
      session,
      deckConfig,
      dueCounts: {
        due: sessionCards.length,
        new: enriched.filter((card: any) => card.state?.phase === "new").length,
        learning: enriched.filter((card: any) => ["learning", "relearning"].includes(card.state?.phase)).length,
        review: enriched.filter((card: any) => card.state?.phase === "review" && isCardDue(card.state, now, deckConfig)).length,
      },
      streak: session && (session.lastStudiedDayNumber === todayDayNumber || session.lastStudiedDay === todayKey) ? session.reviewedToday : 0,
      currentCard,
      upcoming: sessionCards.slice(1, 6).map((card: any) => ({ _id: card._id, front: card.front })),
      stats: {
        totalCards: cards.length,
        reviewedCards: states.filter((state: any) => state.reps > 0).length,
        matureCards: states.filter((state: any) => state.phase === "review" && state.interval >= 21).length,
      },
      recentReviews: recentReviews
        .sort((a: any, b: any) => b.createdAt - a.createdAt)
        .slice(0, 12),
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
      config: DEFAULT_DECK_CONFIG,
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
        noteId: v.optional(v.string()),
        templateOrdinal: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { deckId, cards }) => {
    const userId = await requireUser(ctx);
    const deck = await ctx.db.get(deckId);
    if (!deck || String(deck.userId) !== String(userId)) throw new Error("Deck not found");
    const now = Date.now();
    for (const [index, card] of cards.entries()) {
      const noteId = card.noteId?.trim() || `note:${now}:${index}:${Math.random().toString(36).slice(2, 8)}`;
      const cardId = await ctx.db.insert("cards", {
        userId,
        deckId,
        noteId,
        templateOrdinal: card.templateOrdinal ?? 0,
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
        dueDay: undefined,
        interval: 0,
        easeFactor: getDeckConfig(deck).initialEaseFactor,
        reps: 0,
        lapses: 0,
        stepIndex: 0,
        buriedUntilDay: undefined,
        buriedReason: undefined,
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
    const sessions = await ctx.db.query("studySessions").withIndex("by_user_deck", (q: any) => q.eq("userId", userId).eq("deckId", deckId)).collect();
    const existing = sessions[0];
    const deck = await ctx.db.get(deckId);
    if (!deck || String(deck.userId) !== String(userId)) throw new Error("Deck not found");
    const deckConfig = getDeckConfig(deck);
    const patch = {
      currentCardId,
      revealed,
      revealedAt: revealed ? now : undefined,
      updatedAt: now,
      lastStudiedDay: schedulerDayKey(now, deckConfig),
      lastStudiedDayNumber: schedulerDayNumber(now, deckConfig),
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
      revealedAt: revealed ? now : undefined,
      reviewedToday: 0,
      lastStudiedDay: schedulerDayKey(now, deckConfig),
      lastStudiedDayNumber: schedulerDayNumber(now, deckConfig),
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
    const deck = await ctx.db.get(deckId);
    if (!deck || String(deck.userId) !== String(userId)) throw new Error("Deck not found");
    const deckConfig = getDeckConfig(deck);
    const card = await ctx.db.get(cardId);
    if (!card || String(card.userId) !== String(userId)) throw new Error("Card not found");
    const states = await ctx.db.query("studyStates").withIndex("by_user_card", (q: any) => q.eq("userId", userId).eq("cardId", cardId)).collect();
    const current = states[0];
    if (!current) throw new Error("Study state missing");
    const schedule = nextSchedule(current, rating, now, String(cardId), deckConfig);
    await ctx.db.patch(current._id, {
      ...(schedule as any),
      buriedUntilDay: undefined,
      buriedReason: undefined,
      updatedAt: now,
    });

    const sessions = await ctx.db.query("studySessions").withIndex("by_user_deck", (q: any) => q.eq("userId", userId).eq("deckId", deckId)).collect();
    const session = sessions[0];
    const day = schedulerDayKey(now, deckConfig);
    const dayNumber = schedulerDayNumber(now, deckConfig);
    const takenMillis = Math.min(60_000, Math.max(0, now - (session?.revealedAt ?? now)));
    const reviewKind = current.phase === "review"
      ? elapsedDays(current, now, deckConfig) < current.interval
        ? "filtered"
        : "review"
      : current.phase === "relearning"
        ? "relearning"
        : "learning";

    const scheduleAny = schedule as any;
    const shouldBurySiblings = (current.phase === "review" && deckConfig.buryReviews)
      || (current.phase !== "review" && deckConfig.buryNew);
    if (shouldBurySiblings) {
      const siblingCards = await ctx.db
        .query("cards")
        .withIndex("by_user_deck_note", (q: any) => q.eq("userId", userId).eq("deckId", deckId).eq("noteId", card.noteId))
        .collect();
      for (const sibling of siblingCards) {
        if (String(sibling._id) === String(cardId)) continue;
        const siblingStates = await ctx.db
          .query("studyStates")
          .withIndex("by_user_card", (q: any) => q.eq("userId", userId).eq("cardId", sibling._id))
          .collect();
        const siblingState = siblingStates[0];
        if (!siblingState || !isCardDue(siblingState, now, deckConfig)) continue;
        await ctx.db.patch(siblingState._id, {
          buriedUntilDay: dayNumber,
          buriedReason: current.phase === "review" ? "sibling-review" : "sibling-new",
          updatedAt: now,
        });
      }
    }

    await ctx.db.insert("reviewLogs", {
      userId,
      deckId,
      cardId,
      rating,
      reviewKind,
      interval: scheduleAny.interval ?? 0,
      lastInterval: current.interval ?? 0,
      easeFactor: scheduleAny.easeFactor ?? current.easeFactor,
      takenMillis,
      schedulerDay: dayNumber,
      createdAt: now,
    });

    if (session) {
      await ctx.db.patch(session._id, {
        currentCardId: undefined,
        revealed: false,
        revealedAt: undefined,
        reviewedToday: session.lastStudiedDayNumber === dayNumber || session.lastStudiedDay === day ? session.reviewedToday + 1 : 1,
        lastStudiedDay: day,
        lastStudiedDayNumber: dayNumber,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("studySessions", {
        userId,
        deckId,
        currentCardId: undefined,
        revealed: false,
        revealedAt: undefined,
        reviewedToday: 1,
        lastStudiedDay: day,
        lastStudiedDayNumber: dayNumber,
        startedAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(deckId, { updatedAt: now });
    return schedule;
  },
});
