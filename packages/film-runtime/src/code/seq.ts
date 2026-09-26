import type { ReactNode } from 'react';

/** The MG host reads these children in order, then mounts each scene on its own clock. */
export function Seq(_props: { children?: ReactNode }): ReactNode {
  throw new Error('Seq is the return value of an MG index.tsx entry; it is collected by the MG host, not mounted inside a scene.');
}
