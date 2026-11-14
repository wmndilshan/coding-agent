import path from "node:path"
import { createAgent, HumanMessage, toolCallLimitMiddleware } from "langchain"
import { MemoryStore } from "./memo/memoryStore"
import { ContextBuilder } from "./memo/contextBuilder"
import { retrieveRelevantLTMTool } from "./tools/hybridSearchTool"
import { transferTool } from "./tools/transferTool"
import { writeToMemoryTool } from "./tools/writeLTMTool"
import { toolMonitoringMiddleware } from "@/app/middleware/toolMonitoringMiddleware"
import { MEMORY_AGENT_SYSTEM_PROMPT } from "./prompt/memory-prompt"
import { LLM } from "@/llm/LLM"


export async function createMemoryAgent({
    memoryRoot = path.resolve(process.cwd(), "public", "memory"),
    model = LLM.getInstance("deepseek-chat"),
    modelContextLimit = 8000,
    userId = "",
    projectId = ""
} = {}) {
    const memo = new MemoryStore(memoryRoot, { userId, projectId })

    await memo.init()

    const contextBuilder = new ContextBuilder(memo, modelContextLimit, { userId, projectId })

    const { writeLTMTool } = writeToMemoryTool(memoryRoot, { userId, projectId })

    const agent = createAgent({
        model,
        tools: [writeLTMTool, retrieveRelevantLTMTool, transferTool],
        systemPrompt: MEMORY_AGENT_SYSTEM_PROMPT,
        middleware: [
            toolCallLimitMiddleware({
                toolName: "transfer_to_assistant",
                runLimit: 1,
                exitBehavior: "end"
            }),
            toolCallLimitMiddleware({
                toolName: "retrieve_relevant_ltm",
                runLimit: 2,
                exitBehavior: "end"
            }),
            toolMonitoringMiddleware
        ]
    })

    async function invokeMemoryAgent(userInput: string) {
        const [contextRetriever, _] = await Promise.all([
            contextBuilder.assemble(userInput, {}),
            memo.logInteraction("User", userInput, new Date())
        ])

        const agentOutput = await agent.invoke(
            {
                messages: [new HumanMessage(contextRetriever.prompt)]
            },
            { configurable: { userId, projectId } }
        )
    
        const aiResponse = agentOutput.messages[agentOutput.messages.length - 1].content as string
    
        await memo.logInteraction("Assistant", aiResponse, new Date())
    
        return aiResponse
    }

    async function streamAgentResult(userInput: string, config: any) {
        const [contextRetriever, _] = await Promise.all([
            contextBuilder.assemble(userInput, {}),
            memo.logInteraction("User", userInput, new Date())
        ])

        let fullContent = ""

        for await (const chunk of await agent.stream(
            { messages: [{ role: "user", content: contextRetriever?.prompt }]},
            { streamMode: "updates" }
        )) {
            const updates = chunk?.tools?.messages
            const req = chunk?.model_request?.messages

            if (updates && updates.length > 0) {
                if (updates[0].name === "retrieve_relevant_ltm" || updates[0].name === "transfer_to_assistant") {
                    fullContent += "<think>" + updates[0].content + "</think>"
                    config?.writer?.({
                        manager_name: "memoryManger",
                        content: "<think>" + updates[0].content + "</think>"
                    })
                }
            }

            if (req && req.length > 0) {
                const aiMsg = req[0]
                const content = aiMsg?.content ?? ""

                const hasToolCalls = (aiMsg as any).tool_calls && (aiMsg as any).tool_calls.length > 0

                if (hasToolCalls) {
                    fullContent += content
                    config?.writer?.({
                        manager_name: "memoryAgent",
                        content: content
                    })
                } else {
                    fullContent += content
                    config?.writer?.({
                        manager_name: "memoryAgent",
                        content: content
                    })
                }
            }
        }

        await memo.logInteraction("Coder-Agent", fullContent, new Date())

        return {
            fullContent,
            coderAgentContext: contextRetriever?.coderAgentContextLayers
        }
    }


    return {
        invokeMemoryAgent,
        streamAgentResult
    }
}
