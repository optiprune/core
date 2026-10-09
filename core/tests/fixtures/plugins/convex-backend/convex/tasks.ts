import { query, mutation } from "convex/server";

export const list = query({
  handler: async () => [],
});

export const create = mutation({
  handler: async () => ({ created: true }),
});
