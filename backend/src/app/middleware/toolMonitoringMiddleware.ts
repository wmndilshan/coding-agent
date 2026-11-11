import { createMiddleware } from "langchain"

/** Log every tool call while preserving the original call and result. */
export const toolMonitoringMiddleware = createMiddleware({
    name: "ToolMonitoringMiddleware",
    wrapToolCall: async (request: any, handler: any) => {
        const toolName = request.toolCall?.name ?? request.tool?.name ?? "unknown"
        const args = request.toolCall?.args ?? {}
        console.log(`[tool] ${toolName}`, JSON.stringify(args))

        try {
            const result = await handler(request)
            console.log(`[tool] ${toolName} completed`)
            return result
        } catch (error) {
            console.error(`[tool] ${toolName} failed`, error)
            throw error
        }
    }
})
