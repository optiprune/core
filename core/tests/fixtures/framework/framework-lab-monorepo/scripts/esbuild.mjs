import * as esbuild from "esbuild"; await esbuild.build({ entryPoints: ["scripts/esbuild-entry.ts"], bundle: true, outfile: "dist/esbuild-fixture.js" });
