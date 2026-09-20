const selected = 'live';
await import(`./${selected}.mjs`);
await import(new URL('./live.mjs', import.meta.url));
await import(import.meta.resolve('./live.mjs'));
