export interface ComponentImport {
  boundName: string;
  /** component = JSX visual element; function = plain TSX helper that does not render directly. */
  kind?: 'component' | 'function';
  componentName: string;
  packageName: string;
}
