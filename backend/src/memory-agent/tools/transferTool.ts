import { tool } from "@langchain/core/tools"
import z from "zod"

export const transferTool = tool(
    async ({ context }, config) => {
        try {
            return `Transfer requested: <think>__TRANSFER__ + ${context}</think>`
        } catch (error) {
            return JSON.stringify({ error: "Transfer failed. Please try again." })
        }
    },
    {
        name: "transfer_to_assistant",
        description: "Request transfer of the current task to Assistant-2. Return the required transfer marker and context.",
        schema: z.object({ context: z.string().min(1).describe("The concise reason and context for the transfer.") })
    }
)

// Backward-compatible alias for existing imports.
export const transfertTool = transferTool
