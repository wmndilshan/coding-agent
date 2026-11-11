import { tool, createAgent } from "langchain"
import { z } from "zod"
import {
    HumanMessage
} from "@langchain/core/messages"
import { DEFAULT_SUBAGENT_PROMPT, getTaskToolDescription } from "./taskToolPrompt"

const taskToolDescription = getTaskToolDescription()

export const createTaskTool = (model: any, config: any={}) => {
    return tool(
        async ({ sub_agent, task }, toolConfig: any) => {
            if (!task || !sub_agent) {
                return "Please provide subName and with Task taht will be executed"
            }

            const subagent = createAgent({
                model,
                tools: [...(config.tools ?? [])],
                middleware: config.middleware ?? [],
                systemPrompt: `${DEFAULT_SUBAGENT_PROMPT}\n\n
                
                Once you finish the research you should only return the name of the file where the data is stored
                
                \n\nTask: ${task}`,
                // middleware: [toolMonitoringMiddleware]
            })

            const subagentStream = await subagent.stream(
                { messages: [new HumanMessage(task)] },
                { streamMode: "messages", ...toolConfig }
            )

            let finalContent = ""

            for await (const [chunk] of subagentStream as any) {
                if (chunk?.type !== "ai") continue
                if (chunk.content) {
                    toolConfig?.writer?.({
                        subagent_name: sub_agent,
                        content: chunk.content
                    })

                    finalContent += chunk.content
                }
            }

            return finalContent
        },
        {
            name: "task",
            description: taskToolDescription,
            schema: z.object({
                sub_agent: z.string().describe("The name must be unique for each spawn sub-agent eg: webscraper"),
                task: z.string().describe("Highly detailed instructions for the subagent")
            })
        }
    )
}
