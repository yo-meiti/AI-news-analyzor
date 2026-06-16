/**
 * Image Prompt Generator Frontend
 *
 * Sends user input to the API, receives an English image prompt,
 * and shows saved prompt history from the database.
 */

const userInput = document.getElementById("user-input");
const generateButton = document.getElementById("generate-button");
const statusText = document.getElementById("status-text");
const resultPrompt = document.getElementById("result-prompt");
const historyList = document.getElementById("history-list");

let isProcessing = false;

generateButton.addEventListener("click", generatePrompt);
userInput.addEventListener("keydown", (event) => {
	if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
		event.preventDefault();
		generatePrompt();
	}
});

loadPromptHistory();

async function generatePrompt() {
	const input = userInput.value.trim();
	if (!input || isProcessing) {
		return;
	}

	setBusyState(true, "Generating prompt...");

	try {
		const response = await fetch("/api/prompts", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ input }),
		});

		const data = await response.json();
		if (!response.ok) {
			throw new Error(data.error || "Failed to generate prompt.");
		}

		resultPrompt.textContent = data.prompt;
		prependHistoryItem({
			id: data.id,
			user_input: data.input,
			prompt_text: data.prompt,
			created_at: new Date().toISOString(),
		});
		statusText.textContent = "Prompt generated and saved.";
	} catch (error) {
		console.error("Error generating prompt:", error);
		statusText.textContent =
			error instanceof Error ? error.message : "Unexpected error.";
	} finally {
		setBusyState(false, statusText.textContent);
	}
}

async function loadPromptHistory() {
	statusText.textContent = "Loading saved prompts...";
	try {
		const response = await fetch("/api/prompts");
		const data = await response.json();
		if (!response.ok) {
			throw new Error(data.error || "Failed to load prompt history.");
		}

		historyList.innerHTML = "";
		for (const item of data.prompts || []) {
			appendHistoryItem(item);
		}

		if (!data.prompts || data.prompts.length === 0) {
			statusText.textContent = "No prompts saved yet.";
		} else {
			statusText.textContent = "Prompt history loaded.";
		}
	} catch (error) {
		console.error("Error loading prompt history:", error);
		statusText.textContent =
			error instanceof Error ? error.message : "Failed to load history.";
	}
}

function setBusyState(isBusy, message) {
	isProcessing = isBusy;
	userInput.disabled = isBusy;
	generateButton.disabled = isBusy;
	if (message) {
		statusText.textContent = message;
	}
}

function prependHistoryItem(item) {
	const historyItem = createHistoryItemElement(item);
	historyList.prepend(historyItem);
}

function appendHistoryItem(item) {
	const historyItem = createHistoryItemElement(item);
	historyList.appendChild(historyItem);
}

function createHistoryItemElement(item) {
	const wrapper = document.createElement("article");
	wrapper.className = "history-item";

	const timeEl = document.createElement("p");
	timeEl.className = "history-time";
	timeEl.textContent = formatTimestamp(item.created_at);

	const inputEl = document.createElement("p");
	inputEl.className = "history-input";
	inputEl.textContent = `Input: ${item.user_input}`;

	const promptEl = document.createElement("p");
	promptEl.className = "history-prompt";
	promptEl.textContent = item.prompt_text;

	wrapper.appendChild(timeEl);
	wrapper.appendChild(inputEl);
	wrapper.appendChild(promptEl);
	return wrapper;
}

function formatTimestamp(value) {
	if (!value || typeof value !== "string") {
		return "Unknown time";
	}

	const normalizedValue = value.includes("T")
		? value
		: `${value.replace(" ", "T")}Z`;
	const date = new Date(normalizedValue);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	return date.toLocaleString();
}
