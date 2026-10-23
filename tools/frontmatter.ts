import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { frontmatter } from "micromark-extension-frontmatter";
import {
	type Document,
	isMap,
	isNode,
	isScalar,
	LineCounter,
	parseDocument,
	type YAMLParseError,
} from "yaml";
import { z } from "zod";
import { type FieldHelp, fieldIssues, messages } from "./messages";
import { type Problem, problem, type Span } from "./problem";

/*
 * The frontmatter is the lines between the `---` markers at the top of a post or profile:
 *
 *   ---
 *   title: My first post
 *   ---
 *   The text of the post...
 *
 * This file describes what they may contain, and turns mistakes into nice error messages.
 */

/**
 * regex for valid tags, i.e. alphanumeric lowercase with hyphen separators
 */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * regex for valid (probably) github usernames
 */
export const GITHUB_LOGIN_PATTERN =
	/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/**
 * A Zod schema for a nonempty text, with nice error messages
 */
const text = z
	.string({ error: fieldIssues.notText })
	.trim()
	.min(1, fieldIssues.empty);

function list<Item extends z.ZodType>(item: Item) {
	return z.array(item, { error: fieldIssues.notAList });
}

/** Help for each frontmatter field */
const fieldHelpRegistry = z.registry<FieldHelp>();

/** Create a Zod field while adding it to `fieldHelpRegistry` */
function field<Schema extends z.ZodType>(help: FieldHelp, schema: Schema) {
	fieldHelpRegistry.add(schema, help);
	return schema;
}

export function helpFor(
	schema: z.ZodObject,
	name: string,
): FieldHelp | undefined {
	const fieldSchema = schema.shape[name];
	return fieldSchema && fieldHelpRegistry.get(fieldSchema);
}

export const PostSchema = z.strictObject({
	title: field(
		{
			description: "the title of your post",
			rules: "Plain text on one line.",
			example: "Your Title",
		},
		text,
	),
	authors: field(
		{
			description: "a list of GitHub usernames",
			rules:
				"Usernames go in square brackets, separated by commas. This must include at least your own username, and should include any co-authors too.",
			example: "[your-username]",
		},
		list(z.string().regex(GITHUB_LOGIN_PATTERN, fieldIssues.notGithubName)).min(
			1,
			fieldIssues.needsOne,
		),
	),
	tags: field(
		{
			description: "a list of lowercase words joined by `-`",
			rules:
				"Tags go in square brackets, separated by commas. Each tag is lowercase words joined by `-`.",
			example: "[web-dev, my-topic]",
		},
		list(z.string().regex(SLUG_PATTERN, fieldIssues.notSlug)).optional(),
	),
	summary: field(
		{
			description: "a short sentence saying what the post is about",
			rules: "One sentence of plain text.",
			example: "A short summary of your post",
		},
		text.optional(),
	),
});

export const AuthorSchema = z.strictObject({
	name: field(
		{
			description: "the name to show next to your posts",
			rules:
				"Plain text, keep it short. If this is absent, your GitHub username will be used",
			example: "Your Name",
		},
		text.optional(),
	),
});

interface MarkdownFile {
	/**
	 * The frontmatter if present
	 */
	readonly frontmatter: string | undefined;
	/**
	 * The actual markdown content
	 */
	readonly tree: Root;
}

export function parseMarkdown(fileText: string): MarkdownFile {
	const tree = fromMarkdown(fileText, {
		extensions: [frontmatter(["yaml"])],
		mdastExtensions: [frontmatterFromMarkdown(["yaml"])],
	});
	const first = tree.children[0];
	return {
		frontmatter: first?.type === "yaml" ? first.value : undefined,
		tree,
	};
}

type ReadResult<Data> =
	| { readonly ok: true; readonly data: Data }
	| { readonly ok: false; readonly problems: readonly Problem[] };

const fail = (problems: Problem[]): ReadResult<never> => ({
	ok: false,
	problems,
});

/**
 * The expected position of the opening `---`
 * We can safely hardcode this location since the markdown parser only accepts a frontmatter if it is _directly_ at the start
 */
const OPENING_FENCE: Span = {
	start: { line: 1, column: 1 },
	end: { line: 1, column: 4 },
};

/** Everything the problem finders below need to know about the frontmatter being read. */
interface Reading {
	/// current file path
	readonly file: string;
	/// the schema the frontmatter content should satisfy
	readonly schema: z.ZodObject;
	/// the markdown body content
	readonly doc: Document;
	/// the frontmatter content as a (hopefully yaml) string
	readonly frontmatter: string;
	/** Turns a range of character offsets in the frontmatter into a position in the file. */
	readonly span: (range: OffsetRange) => Span;
}

/**
 * Checks the (YAML) frontmatter string against `schema` and reports all errors or returns the parsed value
 */
export function readFrontmatter<Schema extends z.ZodObject>(
	file: string,
	schema: Schema,
	frontmatter: string,
): ReadResult<z.infer<Schema>> {
	const lines = new LineCounter();
	const doc = parseDocument(frontmatter, { lineCounter: lines });
	const reading: Reading = {
		file,
		schema,
		doc,
		frontmatter: frontmatter,
		span: spanIn(lines),
	};

	const syntaxError = doc.errors[0];
	if (syntaxError) return fail([syntaxProblem(reading, syntaxError)]);

	const parsed: unknown = doc.toJS() ?? {};
	if (!isRecord(parsed))
		return fail([
			problem(file, messages.frontmatterNotValidType, OPENING_FENCE),
		]);

	const result = schema.safeParse(parsed);
	return result.success
		? { ok: true, data: result.data }
		: fail(
				result.error.issues.flatMap((issue) =>
					issueProblems(reading, parsed, issue),
				),
			);
}

/** Start and end character offsets. The YAML library's ranges carry a third offset, which we usually ignore. */
type OffsetRange = readonly [start: number, end: number, ...rest: number[]];

/** Character offsets in the frontmatter to positions in the file. */
function spanIn(lines: LineCounter): (range: OffsetRange) => Span {
	const at = (offset: number) => {
		const { line, col } = lines.linePos(offset);
		return { line: line + 1, column: col };
	};
	return ([start, end]) => ({ start: at(start), end: at(end) });
}

/**
 * Report a YAML parse error as a {@link Problem}
 */
function syntaxProblem(
	{ file, frontmatter, span }: Reading,
	error: YAMLParseError,
): Problem {
	return problem(
		file,
		messages.frontmatterUnreadable(
			error.code,
			// The library appends its own (frontmatter-relative) line number, which would confuse.
			// not a big fan of having to do this :/
			error.message.split(" at line ")[0] ?? "",
			QUOTING_FIXES.has(error.code)
				? quotedLine(frontmatter, error.pos[0])
				: undefined,
		),
		span(error.pos),
	);
}

/**
 * Report a Zod validation issue as a {@link Problem}
 */
function issueProblems(
	reading: Reading,
	parsed: Record<string, unknown>,
	issue: z.core.$ZodIssue,
): Problem[] {
	if (issue.code === "unrecognized_keys")
		return issue.keys.map((key) => unknownKeyProblem(reading, key));

	const name = String(issue.path[0]);
	// missing key errors would have a [x] path and x not in parsed
	// kinda dumb theres no way of properly checking
	const isMissing = issue.path.length === 1 && !(name in parsed);
	return [
		isMissing
			? missingKeyProblem(reading, name)
			: malformedEntryProblem(reading, issue),
	];
}

/**
 * Report an unknown key `key` in the frontmatter
 */
function unknownKeyProblem(
	{ file, schema, doc, span }: Reading,
	key: string,
): Problem {
	const range = entryRange(doc, key);
	return problem(
		file,
		messages.unknownLine(key, Object.keys(schema.shape)),
		range && span(range),
	);
}

/**
 * Report a missing required key in the frontmatter as a {@link Problem}
 */
function missingKeyProblem({ file, schema }: Reading, name: string): Problem {
	return problem(
		file,
		messages.missingLine(name, helpFor(schema, name)),
		OPENING_FENCE,
	);
}

/**
 * Report a more generic badly formatted entry as a problem.
 * We try and include the description, examples, etc of the field to provide better help messages
 */
function malformedEntryProblem(
	{ file, schema, doc, span }: Reading,
	issue: z.core.$ZodIssue,
): Problem {
	const [line, entry] = issue.path;
	const entryNumber = typeof entry === "number" ? ` (entry ${entry + 1})` : "";
	const node = doc.getIn(issue.path, true);
	return problem(
		file,
		messages.malformedEntry(
			String(line),
			entryNumber,
			issue.message,
			helpFor(schema, String(line)),
		),
		isNode(node) && node.range ? span(node.range) : undefined,
	);
}

/** Offsets of a whole `key: value` entry, or undefined if there is no such key. */
function entryRange(doc: Document, key: string): OffsetRange | undefined {
	if (!isMap(doc.contents)) return undefined;
	const pair = doc.contents.items.find(
		(item) => isScalar(item.key) && item.key.value === key,
	);
	const keyRange = isNode(pair?.key) ? pair.key.range : undefined;
	const valueRange = isNode(pair?.value) ? pair.value.range : undefined;
	return keyRange ? [keyRange[0], valueRange?.[1] ?? keyRange[1]] : undefined;
}

/** YAML mistakes that quoting the whole value (e.g. `a: b: c` -> `a: "b: c"`) fixes. */
const QUOTING_FIXES: ReadonlySet<string> = new Set([
	"BLOCK_AS_IMPLICIT_KEY",
	"BAD_SCALAR_START",
]);

/** The line at `offset` with its value in quotes (`a: b: c` becomes `a: "b: c"`), or undefined if it isn't `name: value`. */
function quotedLine(frontmatter: string, offset: number): string | undefined {
	const start = frontmatter.slice(0, offset).lastIndexOf("\n") + 1;
	const end = frontmatter.indexOf("\n", offset);
	const line = frontmatter.slice(start, end === -1 ? undefined : end);
	const [, name, value] = /^([\w-]+):[ \t]+(.+?)\s*$/.exec(line) ?? [];
	return name && value
		? `${name}: "${value.replace(/[\\"]/g, "\\$&")}"`
		: undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
