/**
 * All the public error messages / warnings / other messages the validator outputs
 */

import type * as yaml from "yaml";

/** What a field in the frontmatter is for, and an example of it. */
export interface FieldHelp {
	/** A description of the field's purpose */
	readonly description: string;
	/** How to write the field's value, i.e. how it should be formatted */
	readonly rules: string;
	/** An example field value */
	readonly example: string;
}

const exampleOf = (name: string, { example }: FieldHelp) =>
	`It should look like \`${name}: ${example}\`.`;

const FENCE_HELP = "starting and ending with a line of `---`";

export const messages = {
	postNotInFolder:
		"Posts should be in their own folder, e.g. `posts/my-post/index.md`.",
	postNeedsIndex:
		"This folder needs a file called `index.md` with your post's content in it.",
	badSlug:
		"Folder names should be lowercase words joined by `-`, e.g. `my-first-post`.",
	extraFileInPost:
		"Only images (png, jpg or webp) can go in a post folder besides `index.md`.",

	notAuthoringOwnPost: (login: string) =>
		`You (\`${login}\`) need to be one of the \`authors\` of a post you submit.`,

	htmlNotAllowed:
		"Posts are plain Markdown, HTML tags aren't allowed. You can add images with `![description](file.png)`.",
	imageNeedsAlt: (image: string) =>
		`The image \`${image}\` needs alt text: put a short description in the square brackets, e.g. \`![description](file.png)\``,
	imageInSubfolder: (image: string) =>
		`The image \`${image}\` isn't in your post's folder. Subfolders are not allowed. You can only include images in your own post's folder.`,
	imageMissing: (image: string) =>
		`The image \`${image}\` isn't present in your post's folder. Check the file name.`,

	badProfileName:
		"Author profiles should be `.md` files named after your GitHub username.",

	profileNotYours: (login: string) =>
		`You can only add a profile named after yourself (\`${login}.md\`).`,

	needsFrontmatter: (what: "post" | "profile") =>
		`Your ${what} needs a block of details at the very top, ${FENCE_HELP}.` +
		(what === "post"
			? " See `posts/_template/index.md` for an example."
			: "See `authors/_template.md` for an example"),

	frontmatterUnreadable: (
		code: yaml.ErrorCode,
		reason: string,
		fix?: string,
	) => {
		const help = yamlHelp[code];
		return help
			? `The details at the top couldn't be read. ${help}${fix ? ` Try \`${fix}\`.` : ""}`
			: `The details at the top couldn't be read (${reason}).`;
	},

	frontmatterNotValidType:
		"The details at the top should be a list of `name: value` lines.",

	unknownLine: (name: string, allowed: readonly string[]) =>
		`Unknown line \`${name}\`. The allowed ones are: ${allowed.join(", ")}.`,

	missingLine: (name: string, help?: FieldHelp) =>
		`Your details are missing the \`${name}\` line` +
		(help ? ` (${help.description}). ${exampleOf(name, help)}` : "."),

	malformedEntry: (
		name: string,
		entryNumber: string,
		issue: string,
		help?: FieldHelp,
	) =>
		`\`${name}\`${entryNumber} ${issue}.` +
		(help ? ` ${exampleOf(name, help)} ${help.rules}` : ""),

	symlink: "Links to other files (symlinks) aren't allowed.",

	notLinked: (login: string) =>
		`${login} hasn't linked their GitHub account to Discord yet, so we can't check if they're eligible to post.`,

	levelTooLow: (login: string, needed: number) =>
		`${login} hasn't reached level ${needed} yet. See "Who can post" in RULES.md.`,

	eligibilityUnknown: (login: string, reason: string) =>
		`Couldn't check whether ${login} can post (${reason}). A reviewer will check instead.`,

	feedbackIntro:
		"Thanks for your post! A few things need fixing before it can be merged:",
};

/** Plain-language fixes for the mistakes in the details that the YAML library reports. */
const yamlHelp: Partial<Record<yaml.ErrorCode, string>> = {
	// The usual cause is a value like `movie: a review`, where the second `:` confuses the parser.
	BLOCK_AS_IMPLICIT_KEY:
		"This line has a second `:` in it. If a value contains a `:`, wrap the whole value in quotes.",
	DUPLICATE_KEY: "This line appears twice. Each line can only be used once.",
	BAD_INDENT:
		"Something here is indented wrongly, or a `[` is missing its closing `]`. Lines should start at the very left edge, and lists look like `[one, two]`.",
	TAB_AS_INDENT:
		"Lines can't start with a tab character. Remove the tab at the start of the line.",
	MISSING_CHAR:
		"A quote or bracket is never closed. Add the matching closing character.",
	UNEXPECTED_TOKEN:
		"There's a stray character here. Check for doubled commas or extra symbols.",
	BAD_SCALAR_START:
		"A value can't start with this character. Wrap the whole value in quotes.",
};

export const fieldIssues = {
	notText: "should be text",
	empty: "can't be empty",
	notAList: "should be a list, like `[one, two]`",
	needsOne: "needs at least one entry",
	notGithubName: "should be a GitHub username",
	notSlug: "should be lowercase words joined by `-`",
} as const;
