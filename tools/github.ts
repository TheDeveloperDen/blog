import { Octokit } from "@octokit/rest";
import { type Feedback, MARKER } from "./render";

export interface ChangedFile {
	path: string;
	/** Whether the PR creates the file */
	added: boolean;
}

/** One pull request, as seen through the GitHub API. */
export class PullRequest {
	private readonly repo: { owner: string; repo: string };

	constructor(
		private readonly octokit: Octokit,
		repository: string,
		private readonly number: number,
	) {
		const [owner = "", repo = ""] = repository.split("/");
		this.repo = { owner, repo };
	}

	/** Files the PR adds or changes, ignoring deleted files */
	async listFiles(): Promise<ChangedFile[]> {
		const files = await this.octokit.paginate(
			this.octokit.rest.pulls.listFiles,
			{
				...this.repo,
				pull_number: this.number,
				per_page: 100,
			},
		);
		return files
			.filter((file) => file.status !== "removed")
			.map((file) => ({ path: file.filename, added: file.status === "added" }));
	}

	/** Replaces whatever an earlier run said with `feedback`. If the feedback is empty, we remove all feedback */
	async replaceFeedback({ inline, general }: Feedback): Promise<void> {
		const { rest, paginate } = this.octokit;
		const issue = { ...this.repo, issue_number: this.number };
		const ours = (comment: { body?: string; user: { type: string } | null }) =>
			comment.user?.type === "Bot" && comment.body?.includes(MARKER);

		const [oldInline, oldGeneral] = await Promise.all([
			paginate(rest.pulls.listReviewComments, {
				...this.repo,
				pull_number: this.number,
			}),
			paginate(rest.issues.listComments, issue),
		]);

		// Post the new feedback before removing the old
		if (inline.length > 0) {
			await rest.pulls.createReview({
				...this.repo,
				pull_number: this.number,
				event: "COMMENT",
				comments: inline,
			});
		}
		if (general) await rest.issues.createComment({ ...issue, body: general });

		// then remove any old reviews
		await Promise.all([
			...oldInline
				.filter(ours)
				.map(({ id }) =>
					rest.pulls.deleteReviewComment({ ...this.repo, comment_id: id }),
				),
			...oldGeneral
				.filter(ours)
				.map(({ id }) =>
					rest.issues.deleteComment({ ...this.repo, comment_id: id }),
				),
		]);
	}
}

/** The PR this run is about, determined from Github Actions env vars, or `undefined` when running locally. */
export function pullRequestFromEnv(
	env: Record<string, string | undefined> = process.env,
): PullRequest | undefined {
	const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, PR_NUMBER } = env;
	if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !PR_NUMBER) return undefined;
	return new PullRequest(
		new Octokit({
			auth: GITHUB_TOKEN,
			...(GITHUB_API_URL && { baseUrl: GITHUB_API_URL }),
		}),
		GITHUB_REPOSITORY,
		Number(PR_NUMBER),
	);
}
