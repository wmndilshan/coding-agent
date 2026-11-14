import {
    END,
    START,
    StateGraph,
    Annotation,
    MessagesAnnotation,
    Command
} from "@langchain/langgraph"
import { getWriter } from "@langchain/langgraph"
import { LLM } from "@/llm/LLM"
import path from "path"
import { MemoryStore } from "@/memory-agent/memo/memoryStore"
import { createMemoryAgent } from "@/memory-agent"
import { AIMessage, HumanMessage } from "@langchain/core/messages"
import { escapeThinking } from "@/helper/escapeThinkingTag"
import { toolSelector } from "@/tool-selector-agent/toolSelector"
import { TOOL_REGISTRY } from "@/tools/toolRegistry"
import { codeAgent } from "@/coder-agent/coderAgent"

const llm = LLM.getInstance("deepseek-chat")

const memoryRoot = path.resolve(process.cwd(), "public", "memory")

const stateAnnotation = Annotation.Root({
    ...MessagesAnnotation.spec,
    projectId: Annotation(),
    userId: Annotation(),
    nextNode: Annotation(),
    coderAgentContext: Annotation<string | null>(),
    coderAgentMessage: Annotation<string | null>(),
    selectedTools: Annotation<any[]>()
})

const memoryAgent = async (state: any, config: any) => {
    console.log("=================memoryBuilder======================")
    const { userId, projectId } = state

    const last = state.messages
        .filter((m: any) => m._getType() === "human") 
        .slice(-1)[0]

    const memory = await createMemoryAgent({ model: llm, userId, projectId })
    const fullContent = await memory.invokeMemoryAgent(String(last?.content ?? ""))
    getWriter(config)?.({ manager_name: "memoryAgent", content: fullContent })
    const coderAgentContext = fullContent

    const shouldHandoff = (
        fullContent.includes("__TRANSFER__")
    )

    const coderContext = `<working_memory>${coderAgentContext}</working_memory>`
    const userInput = `<current_user_request>${fullContent}</current_user_request>`

    if (shouldHandoff) {
        return new Command({
            update: { messages: [new HumanMessage(userInput)], coderAgentContext: coderContext, nextNode: "coderAgent" },
            goto: "coderAgent"
        })
    }

    return new Command({
        update: { messages: [new AIMessage(fullContent)], nextNode: END },
        goto: END
    })
}

const toolSelectorAgent = async (state: any, config: any) => {
    const cleanMessage = escapeThinking(state.coderAgentMessage)
    const { result, toolMapContent } = await toolSelector(llm, cleanMessage)

    const tools = Array.isArray(result?.tools) ? result.tools : []
    console.log("==============tools=================", result)
    const selectedTools = []

    // for (const toolName of tools) {
    //     const tool = await TOOL_REGISTRY["filesystem"].load(toolName)
    //     selectedTools.push(tool)
    // }

    for (const group of tools) {
        const category = group?.category
        const toolNames = group.tools || []

        for (const toolName of toolNames) {
            if (TOOL_REGISTRY[category]) {
                const loaded = await TOOL_REGISTRY[category].load(toolName)
                if (Array.isArray(loaded)) selectedTools.push(...loaded.filter(Boolean))
                else if (loaded) selectedTools.push(loaded)
            } else {
                console.warn(`Tool category "${category}" not found in TOOL_REGISTRY`)
            }
        }
    }

    const toolNamesList = result?.tools?.flatMap((group: any) => group.tools)

    const statusUpdate = new HumanMessage({
        content: `[SYSTEM_NOTIFICATION]: Tool access GRANTED.
        The following tools are now ACTIVE and ready for use: <selected_tools>${toolNamesList?.join(", ")}</selected_tools>.
        Please proceed with the user's request using these tools.`
    })

    return new Command({
        update: {
            selectedTools: [...selectedTools],
            messages: [statusUpdate]
        },
        goto: "codeAgent"
    })

}

const coderAgent = async (state: any, config: any) => {
    console.log("====================coderAgent=======================")
    const { userId, projectId } = state

    const memoryManger = new MemoryStore(memoryRoot, { userId, projectId })

    const cleanMessages = state.messages.filter((m: any) => {
        return !String(m.content ?? "").includes("__TRANSFER__")
    })

    const inputForCoder = [
        ...cleanMessages,
        new HumanMessage(`CURRENT CONTEXT: ${state.coderAgentContext}`)
    ]

    const aiMessage = await codeAgent(inputForCoder, state.selectedTools ?? [], {userId, projectId}, config) as string

    await memoryManger.logInteraction("Coder-Agent", aiMessage, new Date())

    const shouldHandoff = (
        aiMessage.includes("__TRANSFER__")
    )

    if (shouldHandoff) {
        return new Command({
            update: {
                coderAgentMessage: aiMessage,
                nextNode: "toolSelectorAgent"
            },
            goto: "toolSelectorAgent"
        })
    }

    return new Command({
        update: { messages: [new AIMessage(aiMessage)], nextNode: END },
        goto: END
    })
}

const workflow = new StateGraph(stateAnnotation)
    .addNode("memoryAgent", memoryAgent)
    .addNode("coderAgent", coderAgent)
    .addNode("toolSelectorAgent", toolSelectorAgent)

    .addEdge("__start__", "memoryAgent")
    .addConditionalEdges("memoryAgent", (state) => {
        if (state.nextNode === "coderAgent") {
            return "coderAgent"
        }
        return END
    })
    .addConditionalEdges("coderAgent", (state) => {
        if (state.nextNode === "toolSelectorAgent") {
            return "toolSelectorAgent"
        }
        return END
    })
    .addEdge("toolSelectorAgent", "coderAgent")

export const graph = workflow.compile()
