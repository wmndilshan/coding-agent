import { readChatHistoryTool } from "@/tools/chat-history/chatHistoryTools"
import { Request, Response } from "express"

export async function getChatHistory(req: Request, res: Response) {
    try {

        const userId = req.query.userId as string
        const projectId = req.query.projectId as string

        if (!userId || !projectId) {
            return res.status(400).json({
                ok: false,
                message: "userId or projectId are required"
            })
        }

        const retrievedMessage = await readChatHistoryTool.invoke({ userId, projectId })
        const messages = JSON.parse(retrievedMessage)

        return res.json({ messages })

    } catch (err: any) {
        console.error(err)
        return res.status(500).json({
            ok: false,
            message: err.message || "Internal Server Error"
        })
    }
}