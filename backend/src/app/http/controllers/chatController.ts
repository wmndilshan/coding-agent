import { LLM } from "@/llm/LLM"
import { createMemoryAgent } from "@/memory-agent"
import { graph } from "@/mult-agent/multi-agent"
import { writeToChatHistoryTool } from "@/tools/chat-history/chatHistoryTools"

interface IUserInput {
    message: string
    userId: string
    projectId: string
}
 
import { Request, Response } from "express"

export const postChatStream = async (req: Request, res: Response) => {
    try {
        const { message, userId, projectId }: IUserInput = req.body

        const graphStream = await graph.stream(
            {
                messages: [{ role: "user", content: message }],
                userId,
                projectId
            },
            { streamMode: "custom", subgraphs: true, recursionLimit: 300 }
        )

        res.setHeader("Content-Type", "text/event-stream; charset=utf-8")
        res.setHeader("Cache-Control", "no-cache, no-transform")
        res.setHeader("Connection", "keep-alive")

        const sendSSE = (event: string, data: any) => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        }

        await writeToChatHistoryTool.invoke({
            messages: [{ role: "user", content: message, userId, projectId }]
        })

        let streamingText = ""
        let thinkingBuffer = ""
        let inThinking = false

        try {
            for await (const [array, chunk] of graphStream) {
                if ((chunk as any).manager_name) {
                    const content = (chunk as any).content || ""
                    const parts = content.split(/(<think>|<\/think>)/)

                    parts.forEach((part: string) => {
                        if (part === "<think>") {
                            inThinking = true
                        } else if (part === "</think>") {
                            inThinking = false
                        } else if (part.length > 0) {
                            if (inThinking) {
                                thinkingBuffer += part
                                sendSSE("thinking", { thinking: part })
                            } else {
                                streamingText += part
                                sendSSE("message", { message: part })
                            }
                        }
                    })
                }
            }

            sendSSE("end", { ok: true })
            await writeToChatHistoryTool.invoke({
                messages: [{ role: "ai", thinking: thinkingBuffer, content: streamingText, userId, projectId }]
            })
            res.end()
        }  catch (error) {
            console.error("Streaming Error: ", (error as Error)?.message)
            sendSSE("error", { error: (error as Error)?.message })
            res.end()
        }
    } catch (err: any) {
        if (!res.headersSent) {
            res.status(500).json({ ok: false, error: err.message })
        } else {
            res.end()
        }
    }
}
