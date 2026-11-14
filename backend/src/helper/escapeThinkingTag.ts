export function escapeThinking(input: string) {
    if (!input) return ""

    return input
        .replace(/<\/?think>/gi, "")
        .replace(/__TRANSFER__/gi, "")
        .replace(/^\s*\+\s*/, "")
        .trim()
}