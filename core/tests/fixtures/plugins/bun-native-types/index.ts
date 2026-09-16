import type { Serve } from "bun";
import "bun:test";
export const handler: Serve = (() => new Response("ok")) as Serve;
