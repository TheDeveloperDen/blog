import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const roots: string[] = [];

/** Builds a throwaway repository structure from `files`. Call `removeRepos` when done. */
export function makeFakeRepo(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "blog-"));
	roots.push(root);
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
	return root;
}

export function removeRepos(): void {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true });
}
