#!/usr/bin/env node
// Runs the TypeScript entry in this process through tsx, so the engine ships as plain sources
// and signals (Ctrl-C) reach the command directly.
//
// tsx reads one tsconfig for every file it compiles. Point it at this package's own, not at
// whatever tsconfig.json sits in the user's current directory, so the engine (and the
// @animspark/* sources it loads from node_modules) always compiles the same way.
import { register } from 'tsx/esm/api';
process.env.TSX_TSCONFIG_PATH ||= new URL('../tsconfig.json', import.meta.url).pathname;
register();
// Registers this package's node_modules as the place films' bare imports resolve from.
await import(new URL('../src/package-root.ts', import.meta.url).href);
await import(new URL('../src/film/oss-bin.ts', import.meta.url).href);
