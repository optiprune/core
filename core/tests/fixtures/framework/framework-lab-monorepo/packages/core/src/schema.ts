import { z } from 'zod';

export const ConfigSchema = z.object({ name: z.string(), port: z.number().default(3000) });
export type Config = z.infer<typeof ConfigSchema>;
export function parseConfig(input: unknown): Config { return ConfigSchema.parse(input); }
export const neverReadSchema = z.object({ hidden: z.boolean() });
