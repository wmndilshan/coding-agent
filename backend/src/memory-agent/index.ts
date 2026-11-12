import path from "node:path"
import { createAgent, HumanMessage } from "langchain"
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
        middleware: [toolMonitoringMiddleware]
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

    return {
        invokeMemoryAgent
    }
}
