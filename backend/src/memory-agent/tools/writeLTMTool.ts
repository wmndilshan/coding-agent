import { tool } from "@langchain/core/tools"
import z from "zod"
import { appendAFile } from "../helper/fsHelper"

export function writeToMemoryTool(memoryRoot: string, userData: { userId: string; projectId?: string }) {
    const writeLTMTool = tool(
        async ({ content }) => {
            const now = new Date()
            const formattedDate = now.toTimeString().slice(0, 8)
            const memoryContent = `## [Time: ${formattedDate}] \n${content}\n\n`
    
            try {
                return appendAFile(memoryRoot, `MEMORY-${userData.userId}.md`, memoryContent)
            } catch (error) {
                return JSON.stringify({ message: "Unable to write long-term memory." })
            }
        },
        {
            name: "writeLTM",
            description: "Append a concise, non-sensitive fact or preference to the user's long-term memory.",
            schema: z.object({
                content: z.string()
            })
        }
    )

    return {
        writeLTMTool
    }
}
