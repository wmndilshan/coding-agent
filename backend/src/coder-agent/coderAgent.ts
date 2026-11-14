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
import { transferTool } from "@/memory-agent/tools/transferTool"
import { getWriter } from "@langchain/langgraph"

const model = LLM.getInstance("deepseek-chat")

const subagentConfigs = {
    tools: [ ...fileSystemTools ],
    middleware: [toolMonitoringMiddleware]
}

interface ICoderAgnetProps {
    userId: string
    projectId: string
}
export async function codeAgent(chatHistory: any[], selectedTools: any[] = [], { userId, projectId }: ICoderAgnetProps, config: Record<string, any> = {}) {

    const fixedToolsArray = (Array.isArray(selectedTools) ? selectedTools : [])
        .filter(tool => tool !== undefined)

    const agent = (createAgent as any)({
        model: LLM.getInstance("deepseek-chat"),
        systemPrompt: BASE_PROMPT,
        middleware: [toolMonitoringMiddleware],
        tools: [
            ...fixedToolsArray,
            transferTool,
            think_tool,
            createTaskTool(model, subagentConfigs),
        ]
    })

    const agentStream = await agent.stream(
        {
            messages: [
                new HumanMessage(`
                    You are collaborating with the Tool Selector Agent.
                    If you need a tool for the task, call transfer_to_assistant
                    to request tool selection.

                    eg: I need you to select for me tool_name.
                    `),
                new HumanMessage("You are working on a Windows computer. Use Windows-compatible commands with the bash tool; do not use Linux-only commands."),
                ...chatHistory
            ]
        },
        {
            streamMode: "updates",
            recursionLimit: 300,
            configurable: {
                projectId,
                userId
            }
        }
    )

    let fullContent = ""

    for await (const chunk of await agentStream) {
        const updates = chunk?.tools?.messages
        const req = chunk?.model_request?.messages

        if (updates && updates.length > 0) {
            const toolContent = String(updates[0].content ?? "")
            if (updates[0].name === "transfer_to_assistant" || toolContent.includes("__TRANSFER__")) {
                fullContent += toolContent
                getWriter(config)?.({ manager_name: "coderAgent", content: toolContent })
            }
        }

        if (req && req.length > 0) {
            const aiMsg = req[0]
            const content = aiMsg?.content ?? ""

            const hasToolCalls = (aiMsg as any).tool_calls && (aiMsg as any).tool_calls.length > 0

            if (hasToolCalls) {
                // config.writer({
                //     manager_name: "coderAgent",
                //     contnet: content
                // })
            } else {
                fullContent += content
                getWriter(config)?.({
                    manager_name: "coderAgent",
                    content: content
                })
            }
        }

    }
    return fullContent
}
