import type { CSSProperties } from 'react';

/**
 * Prop types shared by the set pieces. Types are for the reader: `anim check` transpiles
 * without type-checking, so children are typed loosely here, and pieces that render in
 * lists list `key` themselves.
 */
export type Children = unknown;
export type Key = string | number;
export type { CSSProperties };
