import { codeFrameColumns } from "@babel/code-frame";
import { messages } from "./messages";
import type { Problem, Span } from "./problem";

/**
 * Since we run as an action, we only get access to the github-actions[bot] account.
 * Therefore, another competing action could confuse us about which comments are made by us, and which were made by
 * the other bot. Simple but dumb solution is to add this invisible Markdown comment to all messages we send.
 */
export const MARKER = "<!-- blog-validator -->";

/** One inline comment on a line of the PR's diff. */
export interface ReviewComment {
	path: string;
	line: number;
	start_line?: number;
	side: "RIGHT";
	body: string;
}

export interface Feedback {
	inline: ReviewComment[];
	/** Everything that can't sit on a specific part of the diff, posted as a general comment */
	general?: string;
}

// Babel counts columns from 0, we count from 1.
const frame = (source: string, { start, end }: Span): string =>
	codeFrameColumns(source, {
		start: { line: start.line, column: start.column - 1 },
		end: { line: end.line, column: end.column - 1 },
	});

/** Render a {@link Problem} to a string suitable for printing in a terminal or the Actions log. */
export function renderProblemTerminalText(
	{ file, message, span }: Problem,
	source?: string,
): string {
	if (!file) return `✗ ${message}`;
	const at = span ? `:${span.start.line}:${span.start.column}` : "";
	const code = source && span ? `\n\n${indent(frame(source, span))}` : "";
	return `✗ ${file}${at}\n  ${message}${code}\n`;
}

/** A problem that can sit on a line of the PR's diff. */
type LocatedProblem = Problem & { readonly file: string; readonly span: Span };

const inlineComment = ({
	file,
	span,
	message,
}: LocatedProblem): ReviewComment => ({
	path: file,
	line: span.end.line,
	...(span.start.line < span.end.line && { start_line: span.start.line }),
	side: "RIGHT",
	body: `${message}\n\n${MARKER}`,
});

/** One problem as a section of the general comment, with its code frame when it points at one. */
function generalItem(
	{ file, message, span }: Problem,
	sourceOf: (file: string) => string,
): string {
	if (!file) return message;
	const line = span ? `, line ${span.start.line}` : "";
	const code = span
		? `\n\n\`\`\`text\n${frame(sourceOf(file), span)}\n\`\`\``
		: "";
	return `**\`${file}\`**${line}: ${message}${code}`;
}

/**
 * Splits problems into inline comments and one general comment.
 * We can only make inline comments on files that the PR _adds_ (i.e. not modifies), since
 * it's the only situation when  every line of a new file is in the diff,
 * and GitHub rejects comments on lines that aren't in the diff (annoying...)
 */
export function feedback(
	problems: readonly Problem[],
	addedFiles: ReadonlySet<string>,
	sourceOf: (file: string) => string,
): Feedback {
	const isInline = (p: Problem): p is LocatedProblem =>
		p.file !== undefined && p.span !== undefined && addedFiles.has(p.file);
	const rest = problems.filter((p) => !isInline(p));
	return {
		inline: problems.filter(isInline).map(inlineComment),
		...(rest.length > 0 && {
			general: [
				messages.feedbackIntro,
				...rest.map((p) => generalItem(p, sourceOf)),
				MARKER,
			].join("\n\n"),
		}),
	};
}

const indent = (text: string): string =>
	text
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");
