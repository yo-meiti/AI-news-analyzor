/**
 * Type definitions for the image prompt generator.
 */

export interface Env {
	/**
	 * Binding for the Workers AI API.
	 */
	AI: Ai;

	/**
	 * Binding for static assets.
	 */
	ASSETS: { fetch: (request: Request) => Promise<Response> };

	/**
	 * Binding for D1 database.
	 */
	DB: D1Database;
}

/**
 * Request payload for prompt generation.
 */
export interface GeneratePromptRequest {
	input: string;
}

/**
 * Represents a saved prompt row.
 */
export interface PromptRecord {
	id: number;
	user_input: string;
	prompt_text: string;
	created_at: string;
}
