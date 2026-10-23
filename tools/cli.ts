import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkEligibility, type Eligibility } from "./eligibility";
import {
	type ChangedFile,
	type PullRequest,
	pullRequestFromEnv,
} from "./github";
import { type Problem, problem, reasonOf } from "./problem";
import { feedback, renderProblemTerminalText } from "./render";
import { validate } from "./validate";

/*
 * The main entrypoint to the validator.
 * Requires the following environment variables to be present:
 *
 *   ROOT                 the repository to check (default: the one this file is in)
 *   PR_AUTHOR            GitHub login of the person who opened the PR
 *   ELIGIBILITY_URL      the DevDenBot's API endpoint (needs PR_AUTHOR too)
 *   ELIGIBILITY_TOKEN    secret the bot expects in the `Authorization` header
 *   GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER
 *                        together: provided by GitHub Actions, so we can look up the files the PR touches, and post problems on the PR
 *
 * When ran locally, we review _every_ file.
 */

const root = resolve(process.env.ROOT || resolve(import.meta.dir, ".."));

/** Simple file reading cache  */
const sourceOf = memoize((file: string) =>
	readFileSync(join(root, file), "utf8"),
);

function memoize<Key, Value>(
	compute: (key: Key) => Value,
): (key: Key) => Value {
	const cache = new Map<Key, Value>();
	return (key) => {
		if (!cache.has(key)) cache.set(key, compute(key));
		return cache.get(key) as Value;
	};
}

const requestedChecksMessage = (
	prAuthor: string | undefined,
	botUrl: string | undefined,
	pullRequest: PullRequest | undefined,
) =>
	pullRequest
		? `Pull request by ${prAuthor}, looking up its files${botUrl ? ` and asking ${botUrl} whether they can post` : ""}...`
		: "Not on a pull request, checking every file, and not posting anything.";

/** What the bot says about the PR's author, as a problem if they may not post. */
function eligibilityProblems(eligibility: Eligibility | undefined): Problem[] {
	if (eligibility) {
		console.log(`Eligibility: ${eligibility.kind}.`);
	}

	if (eligibility?.kind === "unknown") {
		console.log(`! ${eligibility.message}`);
	}

	return eligibility?.kind === "ineligible"
		? [problem(undefined, eligibility.message)]
		: [];
}

function printProblems(problems: readonly Problem[]): void {
	for (const p of problems)
		console.log(
			renderProblemTerminalText(
				p,
				p.file && p.span ? sourceOf(p.file) : undefined,
			),
		);
	console.log(
		problems.length === 0
			? "All checks passed."
			: `${problems.length} problem(s) found.`,
	);
}

async function postFeedback(
	pullRequest: PullRequest,
	problems: readonly Problem[],
	files: readonly ChangedFile[],
): Promise<void> {
	const added = new Set(files.filter((f) => f.added).map((f) => f.path));
	const comments = feedback(problems, added, sourceOf);
	console.log(
		`Updating the comments on the pull request: ${comments.inline.length} inline, ${comments.general ? "1 general" : "no general"}.`,
	);
	try {
		await pullRequest.replaceFeedback(comments);
		console.log("Comments updated.");
	} catch (error) {
		console.log(`! Couldn't post the problems on the PR (${reasonOf(error)}).`);
	}
}

async function main(): Promise<number> {
	const prAuthor = process.env.PR_AUTHOR;
	const botUrl = process.env.ELIGIBILITY_URL;
	const pullRequest = pullRequestFromEnv();
	console.log(`Checking ${root}`);
	console.log(requestedChecksMessage(prAuthor, botUrl, pullRequest));

	const [files, eligibility] = await Promise.all([
		pullRequest?.listFiles().catch(() => undefined),
		prAuthor && botUrl
			? checkEligibility(prAuthor, botUrl, process.env.ELIGIBILITY_TOKEN ?? "")
			: undefined,
	]);
	if (files) {
		console.log(`The pull request changes ${files.length} file(s).`);
	} else {
		console.log("Validating every file");
	}

	// Without the file list, treat every file as changed.
	const changedFiles = files && new Set(files.map((file) => file.path));
	const touches = (prefix: string) =>
		!changedFiles || [...changedFiles].some((file) => file.startsWith(prefix));
	const problems = [
		...validate(root, prAuthor ? { author: prAuthor, touches } : undefined),
		...eligibilityProblems(eligibility),
	];

	printProblems(problems);
	if (pullRequest) await postFeedback(pullRequest, problems, files ?? []);
	return problems.length > 0 ? 1 : 0;
}

process.exitCode = await main();
