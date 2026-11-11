import { createAgent } from "langchain"
import { HumanMessage } from "@langchain/core/messages"
import { createTaskTool } from "@/tools/task/task"
import { think_tool } from "@/tools/thinkTool"
import { LLM } from "@/llm/LLM"
import { fileSystemTools } from "@/tools/fileSystem"
import { BASE_PROMPT } from "./prompt/system_prompt"
import { bashTool } from "@/tools/bash"
import { astAnalyzeTool } from "@/tools/ast"
import { graphTools } from "@/tools/importGraph"
import { gitTools } from "@/tools/git"
import { agentMemoryTools } from "@/tools/projectContextBuilder"
import { ragTools } from "@/tools/rag"
import { todoListTools } from "@/tools/todo"
import { toolMonitoringMiddleware } from "@/app/middleware/toolMonitoringMiddleware"

const model = LLM.getInstance("deepseek-chat")

const subagentConfigs = {
    tools: [ ...fileSystemTools ],
    middleware: [toolMonitoringMiddleware]
}

export async function codeAgent(userInput: string) {
    const agent = createAgent({
        model: LLM.getInstance("deepseek-chat"),
        systemPrompt: BASE_PROMPT,
        middleware: [toolMonitoringMiddleware],
        tools: [
            think_tool,
            createTaskTool(model, subagentConfigs),
            ...fileSystemTools,
            bashTool,
            astAnalyzeTool,
            ...graphTools,
            ...gitTools,
            ...agentMemoryTools,
            ...ragTools,
            ...todoListTools
        ]
    })

    const result = await agent.invoke(
        {
            messages: [
                new HumanMessage("You are working on windows computer as enviroment. Do not use linux command with bashtool"),
                new HumanMessage(`
                <user_instructions>
                userInput: ${userInput}
                </user_instructions>`)
            ]
        }
    )

    return result
}
