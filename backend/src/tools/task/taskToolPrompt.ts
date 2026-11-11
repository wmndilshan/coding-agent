export function getTaskToolDescription() {
    return `Launch an ephemeral subagent for a complex, multi-step task in an isolated context.

Use this for substantial analysis, research, or implementation work. Do the work directly for a simple single-tool call.

The subagent receives the tools configured by the caller and has no conversation history, so include all required context,
constraints, and an exact expected return format. The parent agent remains responsible for reviewing and summarizing the result.

Prompt template:
Task: <objective>
Context: <relevant files, findings, and assumptions>
Constraints: <scope and limits>
Return: <exact result to provide>`
}

export const DEFAULT_SUBAGENT_PROMPT = `You are a focused coding subagent. Complete the assigned objective using only the provided tools and project context. Keep the work within scope, verify important results, and return a concise summary of actions, findings, and any remaining blockers.`
