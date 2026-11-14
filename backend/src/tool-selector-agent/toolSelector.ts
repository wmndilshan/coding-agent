import {
    SystemMessage
} from "@langchain/core/messages"
import { HumanMessage } from "@langchain/core/messages"
import { z } from "zod"
import { readToolMap } from "@/tools/readToolMap"

export async function toolSelector(llm: any, input: string) {
    const toolMapContent = await readToolMap.invoke({ filename: "toolMap.md" })

    // const toolNames = z.object({
    //     tools: z.array(z.string()).describe("List of usable tools")
    // }).describe("return a list of tools")

    const toolNames = z.object({
        tools: z.array(
            z.object({
                category: z.string().describe("The tool group name (e.g. 'filesystem', 'git')"),
                tools: z.array(z.string()).describe("The specific tool names within the category")
            })
        ).describe("List of tools grouped by category")
    }).describe("Returns a grouped list of tools")

    const structuredLlm = llm.withStructuredOutput(toolNames)

    const result = await structuredLlm.invoke([
        new SystemMessage(`
            <system_message>
                You are a Tool Discovery and Provisioning Agent.
                
                ## Objective
                    Select only the tools required to complete the user's request.
                
                ## Tool Registry
                The following skills are available for on-demand loading:
            </system_message>

            Here's the toolRegistry content:\n\n
            <tool_registry>
                ${toolMapContent}
            </tool_registry>

            ## Output Format

            Return grouped tool names using the schema. Use an empty tools array when no tool is needed.

            ## Restriction

            Do not return tools that are absent from the registry.
        `),
        new HumanMessage(input)
    ])

    return {
        result,
        toolMapContent
    }
}
