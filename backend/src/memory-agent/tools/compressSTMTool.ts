import { tool } from "@langchain/core/tools"
import { z } from "zod"
import { SystemMessage, HumanMessage } from "@langchain/core/messages"
import { LLM } from "@/llm/LLM"

const SYSTEM_PROMPT = `
You are a Memory Compression Agent.

Your task is to compress a full daily chat log into a clean, durable summary.

Rules:
- Remove ALL internal reasoning traces such as <think> blocks.
- Ignore system prompts, tool calls, and assistant planning text.
- Extract only meaningful conversational content.
- Remove timestamps and formatting noise.
- Do NOT rewrite the conversation as dialogue.
- Keep summary concise (max 150-250 words).

Output Format (strictly follow this structure):

# Daily Log Summary
Date: {date}
Status: Compressed

## Overview
- {fact 1}
- {fact 2}
- {fact 3}

## Conversation Summary
{Short narrative summary of meaningful events}

Do not include anything outside this format.
`

export const compreeSTMPTool = tool(
    async ({ message }) => {
        const llm = LLM.getInstance("deepseek-chat")
        const res = await llm.invoke([
            new SystemMessage(SYSTEM_PROMPT),
            new HumanMessage(message)
        ])

        return res?.content
    },
    {
        name: "summarize_message",
        description: "compress memory",
        schema: z.object({
            message: z
                .string()
                .describe("Raw text or concatenated messages to be summarized.")
        })
    }
)
