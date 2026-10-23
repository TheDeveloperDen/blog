import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import type { Nodes, Root } from "mdast";
import { visit } from "unist-util-visit";
import {
	AuthorSchema,
	GITHUB_LOGIN_PATTERN,
	PostSchema,
	parseMarkdown,
	readFrontmatter,
	SLUG_PATTERN,
} from "./frontmatter";
import { messages } from "./messages";
import {
	equalsIgnoreCase,
	type Problem,
	problem,
	type Span,
	when,
} from "./problem";

export interface PrContext {
	/** GitHub login of whoever opened the PR. */
	readonly author: string;
	/** Whether the PR touches any file under `prefix.`  */
	readonly touches: (prefix: string) => boolean;
}

/**
 * Allowed image types (bit of a naive check)
 */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
	".png",
	".jpg",
	".webp",
]);

/**
 * Validate the entire repository and a PR's changes, if applicable
 * @param root the root directory of the blog repo (i.e. where `posts/` and `authors/` are)
 * @param pr the Pull Request's changes. if this is absent, we will validate the entire directory, skipping N/A checks like "you have to put yourself as an author".
 * 				If present, we still validate everything, but also check that the changes are actually valid within the context of a PR.
 * @returns any problems if present
 */
export function validate(root: string, pr?: PrContext): Problem[] {
	// Check this early _just_ in case we don't somehow get injected into reading something bad
	const symlinkProblems = findSymlinks(root);
	if (symlinkProblems.length > 0) return symlinkProblems;

	return [
		...listEntries(join(root, "posts")).flatMap((slug) =>
			validatePost(
				root,
				slug,
				pr?.touches(`posts/${slug}/`) ? pr.author : undefined,
			),
		),
		...listEntries(join(root, "authors")).flatMap((name) =>
			validateAuthorFile(
				root,
				name,
				pr?.touches(`authors/${name}`) ? pr.author : undefined,
			),
		),
	];
}

/**
 * Validate a post's content
 * @param root the root directory path
 * @param slug the slug/directory name that contains the post
 * @param prAuthor the name of the PR author, if present
 * @returns a (hopefully empty) list of problems
 */
function validatePost(
	root: string,
	slug: string,
	prAuthor?: string,
): Problem[] {
	const folder = join(root, "posts", slug);
	const folderPath = `posts/${slug}`;

	if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory())
		return [problem(folderPath, messages.postNotInFolder)];

	const names = readdirSync(folder);
	return [
		...checkSlug(folderPath, slug),
		...checkFolderFiles(folderPath, names),
		...checkIndex(folder, folderPath, new Set(names), prAuthor),
	];
}

/**
 * Check that a slug is valid (i.e. lower alpha separated with `-`)
 */
function checkSlug(folderPath: string, slug: string): Problem[] {
	return when(!SLUG_PATTERN.test(slug), () =>
		problem(folderPath, messages.badSlug),
	);
}

/** Check that the post folder only contains `index.md` and images. */
function checkFolderFiles(
	folderPath: string,
	names: readonly string[],
): Problem[] {
	return names
		.filter(
			(name) =>
				name !== "index.md" &&
				!IMAGE_EXTENSIONS.has(extname(name).toLowerCase()),
		)
		.map((name) => problem(`${folderPath}/${name}`, messages.extraFileInPost));
}

/** Check the index.md contents */
function checkIndex(
	folder: string,
	folderPath: string,
	filesInFolder: ReadonlySet<string>,
	prAuthor?: string,
): Problem[] {
	const filePath = `${folderPath}/index.md`;
	const text = readTextFile(join(folder, "index.md"));
	if (text === undefined) return [problem(folderPath, messages.postNeedsIndex)];

	const { frontmatter: details, tree } = parseMarkdown(text);
	if (details === undefined)
		return [problem(filePath, messages.needsFrontmatter("post"))];

	return [
		...checkPostFrontmatter(filePath, details, prAuthor),
		...checkImageLinksAndHTML(filePath, filesInFolder, tree),
	];
}

function checkPostFrontmatter(
	file: string,
	details: string,
	prAuthor?: string,
): Problem[] {
	const result = readFrontmatter(file, PostSchema, details);
	return result.ok
		? checkAuthorListed(file, result.data.authors, prAuthor)
		: [...result.problems];
}

function checkAuthorListed(
	file: string,
	authors: readonly string[],
	prAuthor?: string,
): Problem[] {
	if (prAuthor === undefined) return [];
	return when(
		!authors.some((author) => equalsIgnoreCase(author, prAuthor)),
		() => problem(file, messages.notAuthoringOwnPost(prAuthor)),
	);
}

/** An image in a post */
interface ImageUse {
	/// Alt text, if present
	readonly alt: string | undefined;
	/// Source path of the image
	readonly source: string;
	/// Where the image is declared
	readonly at: Span | undefined;
}

/**
 * Check that every image has an alt text and points to a valid image in the post's folder,
 * and for any HTML tags which could circumvent the checks (or do even more evil!)
 */
function checkImageLinksAndHTML(
	file: string,
	namesInFolder: ReadonlySet<string>,
	tree: Root,
): Problem[] {
	const nodes = allNodes(tree);
	const html = nodes.find((node) => node.type === "html");
	return [
		...when(html !== undefined, () =>
			problem(file, messages.htmlNotAllowed, html?.position),
		),
		...imageUses(nodes).flatMap((use) => checkImage(file, namesInFolder, use)),
	];
}

/**
 * Flatten the AST to a flat list of ndoes
 */
function allNodes(tree: Root): Nodes[] {
	const nodes: Nodes[] = [];
	visit(tree, (node) => {
		nodes.push(node);
	});
	return nodes;
}

function imageUses(nodes: readonly Nodes[]): ImageUse[] {
	const definitions = new Map(
		nodes.flatMap((node) =>
			node.type === "definition" ? [[node.identifier, node.url] as const] : [],
		),
	);
	return nodes.flatMap((node) => imageUse(node, definitions));
}

function imageUse(
	node: Nodes,
	definitions: ReadonlyMap<string, string>,
): ImageUse[] {
	switch (node.type) {
		case "image":
			return [
				{ alt: node.alt ?? undefined, source: node.url, at: node.position },
			];
		case "imageReference": {
			const source = definitions.get(node.identifier);
			return source === undefined
				? []
				: [{ alt: node.alt ?? undefined, source, at: node.position }];
		}
		default:
			return [];
	}
}

/**
 * Check that a single image has a valid alt text and points to a valid path
 */
function checkImage(
	file: string,
	namesInFolder: ReadonlySet<string>,
	{ alt, source, at }: ImageUse,
): Problem[] {
	return [
		...when(!alt?.trim(), () =>
			problem(file, messages.imageNeedsAlt(source), at),
		),
		...(source.includes("/")
			? [problem(file, messages.imageInSubfolder(source), at)]
			: when(!namesInFolder.has(source), () =>
					problem(file, messages.imageMissing(source), at),
				)),
	];
}

/**
 * Check that an author `.md` file is valid
 */
function validateAuthorFile(
	root: string,
	name: string,
	prAuthor?: string,
): Problem[] {
	const filePath = `authors/${name}`;
	const login = basename(name, ".md");

	if (extname(name) !== ".md" || !GITHUB_LOGIN_PATTERN.test(login))
		return [problem(filePath, messages.badProfileName)];

	return [
		...checkProfileOwner(filePath, login, prAuthor),
		...checkProfileFrontmatter(
			filePath,
			readTextFile(join(root, "authors", name)) ?? "",
		),
	];
}

/**
 * PR-Only: Check that a PR editing an author file is actually made by that person
 */
function checkProfileOwner(
	file: string,
	login: string,
	prAuthor?: string,
): Problem[] {
	if (prAuthor === undefined) return [];
	return when(!equalsIgnoreCase(login, prAuthor), () =>
		problem(file, messages.profileNotYours(prAuthor)),
	);
}

function checkProfileFrontmatter(file: string, text: string): Problem[] {
	const { frontmatter: details } = parseMarkdown(text);
	if (details === undefined)
		return [problem(file, messages.needsFrontmatter("profile"))];
	const result = readFrontmatter(file, AuthorSchema, details);
	return result.ok ? [] : [...result.problems];
}

/** Returns the result of `read()`, or `fallback` if it throws */
function tryWithFallback<Value>(fallback: Value, read: () => Value): Value {
	try {
		return read();
	} catch {
		return fallback;
	}
}

/** All the file in `folder`, except templates (which start with `_`), in a stable order. */
function listEntries(folder: string): string[] {
	return tryWithFallback([], () =>
		readdirSync(folder)
			.filter((name) => !name.startsWith("_"))
			.sort(),
	);
}

/** Find any symlinks and DESTROY (reject and report) them, since at best they do nothing helpful
 * and at worse could do something bad
 */
function findSymlinks(root: string): Problem[] {
	return ["posts", "authors"].flatMap((folder) =>
		lstatSync(join(root, folder), { throwIfNoEntry: false })?.isSymbolicLink()
			? [problem(folder, messages.symlink)]
			: tryWithFallback([], () =>
					readdirSync(join(root, folder), {
						recursive: true,
						withFileTypes: true,
					})
						.filter((entry) => entry.isSymbolicLink())
						.map((entry) =>
							problem(
								relative(root, join(entry.parentPath, entry.name)),
								messages.symlink,
							),
						),
				),
	);
}

function readTextFile(path: string): string | undefined {
	return tryWithFallback(undefined, () => readFileSync(path, "utf8"));
}
