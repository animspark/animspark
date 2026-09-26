/** Error shared by the CLI and write-back. Lives in its own file so doc-edit can throw it without pulling in `node:fs`. */
export class FilmCliError extends Error {}
