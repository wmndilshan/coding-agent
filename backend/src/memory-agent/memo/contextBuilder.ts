import { Document } from "@langchain/core/documents"
import { MemoryStore, UserData } from "../memo/memoryStore"
import { compreeSTMPTool } from "../tools/compressSTMTool"
import { docEmbeddingMultiVector } from "../retriever/multivector-retriever"
import { estimateTokens } from "../helper/tokenCounter"

export class ContextBuilder {
    private memory: MemoryStore
    private modelContextLimit: number
    private userData: UserData

    constructor(memory: MemoryStore, modelContextLimit: number, userData: UserData) {
        this.memory = memory
        this.modelContextLimit = modelContextLimit
        this.userData = userData
    }

    async assemble(userQuery: string, options={}) {
        const systemPrompt = await this.memory.readMemoryFiles(`system_prompt-${this.userData.userId}.md`)

        const userProfile = await this.memory.readMemoryFiles(`MEMORY-${this.userData.userId}.md`)
        const todayLog = await this.memory.readToday(new Date())

        const memoryAgentContextLayer = [
            `# System Layer\n${systemPrompt}`,
            `# Profile Layer\n${userProfile}`,
            `# Recent STM Layer\n${todayLog}`
        ]

        const coderAgentContextLayers = [
            `# Profile Layer\n${userProfile}`,
            `# Recent STM Layer\n${todayLog}`
        ].join("\n\n")

        const memoryContext = memoryAgentContextLayer.join("\n\n")
        const finalPrompt = `<working_memory>${memoryContext}</working_memory>\n\n<current_user_input># New Input\n${userQuery}</current_user_input>`
        const numberOfTokens = estimateTokens(finalPrompt)

        if (numberOfTokens > this.modelContextLimit) {
            console.log("===============compressing....================")

            const compressData = await compreeSTMPTool.invoke({ message: finalPrompt }) as string

            const now = new Date()
            await this.memory.logToArchive("Assistant", compressData, now)

            const docToEmbed = new Document({
                pageContent: compressData,
                metadata: { title: "user daily log summary" }
            })

            await Promise.all([
                    docEmbeddingMultiVector({
                    userId: this.userData.userId,
                    allDocs: [docToEmbed]
                }),
                this.memory.emptyAFileContent()
            ])

            console.log("===============finish compression================")
        }

        return {
            prompt: finalPrompt,
            coderAgentContextLayers,
            diagnostics: {
                estimatedTokens: numberOfTokens
            }
        }
    }
}
