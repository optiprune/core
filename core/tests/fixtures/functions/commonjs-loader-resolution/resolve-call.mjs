await import(path.resolve('./not-a-loader.cjs'));
await import(Promise.resolve('./not-a-loader.cjs'));
