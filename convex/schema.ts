import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    image: v.optional(v.string()),
  }).index("email", ["email"]),
  decks: defineTable({
    userId: v.id("users"),
    title: v.string(),
    description: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .searchIndex("search_title", { searchField: "title", filterFields: ["userId"] }),
  cards: defineTable({
    userId: v.id("users"),
    deckId: v.id("decks"),
    front: v.string(),
    back: v.string(),
    hint: v.optional(v.string()),
    tags: v.array(v.string()),
    source: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_deck", ["deckId"])
    .index("by_user_deck", ["userId", "deckId"]),
  studyStates: defineTable({
    userId: v.id("users"),
    deckId: v.id("decks"),
    cardId: v.id("cards"),
    phase: v.union(
      v.literal("new"),
      v.literal("learning"),
      v.literal("review"),
      v.literal("relearning"),
    ),
    dueAt: v.number(),
    interval: v.number(),
    easeFactor: v.number(),
    reps: v.number(),
    lapses: v.number(),
    stepIndex: v.optional(v.number()),
    lastReviewedAt: v.optional(v.number()),
    lastRating: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_deck", ["userId", "deckId"])
    .index("by_user_card", ["userId", "cardId"]),
  studySessions: defineTable({
    userId: v.id("users"),
    deckId: v.id("decks"),
    currentCardId: v.optional(v.id("cards")),
    revealed: v.boolean(),
    reviewedToday: v.number(),
    lastStudiedDay: v.string(),
    startedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_deck", ["userId", "deckId"]),
});
