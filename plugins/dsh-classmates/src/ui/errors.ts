/** User-facing text of a thrown value, without the `Error: ` prefix String() adds. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
