/**
 * Type definitions for the LLM chat application.
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
	 * D1 database used for model persona memory.
	 */
	DB: D1Database;

	/**
	 * Tavily API key used for mandatory web search grounding.
	 */
	TAVILY_API_KEY: string;
}

/**
 * Represents a chat message.
 */
export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface PersonaState {
	baseInstruction: string;
	language: "fa" | "en";
	tone: "friendly" | "formal";
	style: "concise" | "detailed";
	updatedAt: string;
}
