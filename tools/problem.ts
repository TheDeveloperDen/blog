/** A file position, with 1-based indexes*/
export interface Position {
	readonly line: number;
	readonly column: number;
}

/** The entire span of text that a problem is about. */
export interface Span {
	readonly start: Position;
	readonly end: Position;
}

/** An issue with a submission. */
export interface Problem {
	/** Path relative to the repository root, e.g. `posts/my-post/index.md`.
	 *  Absent if it is about the PR itself (e.g. if you're ineligible to post) */
	readonly file?: string;
	/** Plain-language explanation about what the problem is, and how to fix it */
	readonly message: string;
	/** Where in the file, if it can be pointed at. */
	readonly span?: Span;
}

export function problem(
	file: string | undefined,
	message: string,
	span?: Span,
): Problem {
	return { file, message, span };
}

export function equalsIgnoreCase(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}

export function reasonOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Returns `[problem]` if `condition` holds, otherwise `[]`. */
export function when(condition: boolean, make: () => Problem): Problem[] {
	return condition ? [make()] : [];
}
