import { posix } from "node:path";
import { z } from "zod";
import { messages } from "./messages";
import { equalsIgnoreCase, reasonOf } from "./problem";

/** Whether a GitHub user may post */
export type Eligibility =
	| { readonly kind: "eligible" }
	| { readonly kind: "ineligible"; readonly message: string }
	| { readonly kind: "unknown"; readonly message: string };

const MIN_LEVEL = 30;
/** GitHub usernames of trusted people who can post without needing to link Discord / be at the min level */
const TRUSTED_LOGINS: readonly string[] = [];

/** What the bot knows about a GitHub user. */
const BotAnswerSchema = z.object({
	linked: z.boolean(),
	level: z.number(),
});

const TIMEOUT_MS = 5000;

/**
 * Asks the bot `GET <botUrl>/<login>` (with `token`) what it knows about the user and applies
 * the posting rules. The Promise should always resolve, possibly to `unknown` in case of an error
 */
export async function checkEligibility(
	login: string,
	botUrl: string,
	token: string,
): Promise<Eligibility> {
	if (TRUSTED_LOGINS.some((trusted) => equalsIgnoreCase(trusted, login)))
		return { kind: "eligible" };

	try {
		const url = new URL(botUrl);
		url.pathname = posix.join(url.pathname, login);

		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!response.ok)
			throw new Error(`the bot answered with HTTP ${response.status}`);

		const answer = BotAnswerSchema.parse(await response.json());
		if (!answer.linked) {
			return {
				kind: "ineligible",
				message: messages.notLinked(login),
			};
		}

		if (answer.level < MIN_LEVEL) {
			return {
				kind: "ineligible",
				message: messages.levelTooLow(login, MIN_LEVEL),
			};
		}
		return { kind: "eligible" };
	} catch (error) {
		return {
			kind: "unknown",
			message: messages.eligibilityUnknown(login, reasonOf(error)),
		};
	}
}
