import { Database } from "bun:sqlite";
export const database = new Database(":memory:");
