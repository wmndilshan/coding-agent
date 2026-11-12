import { tool } from "@langchain/core/tools"
import { z } from "zod"
import path from "path"
import { MemoryStore } from "../memo/memoryStore"
import { queryMultiVector } from "@/rag/retrieval"
import { bm25Retriever, extractRelevantDocument, formatDocumentsAsString } from "../retriever/bm25Retriever"

export const retrieveRelevantLTMTool = tool(
    async ({ query }, config) => {
        const projectId = config.configurable?.projectId
        const userId = config.configurable?.userId

        const memoryRoot = path.resolve(process.cwd(), "public", "memory")

        const memoryManager = new MemoryStore(memoryRoot, { userId, projectId })

        let relevantLongTermMemory = ""
        const archiveLog = await memoryManager.readArchiveFile()

        const vectorData = await queryMultiVector({ userId: userId, query })
        const docToString = formatDocumentsAsString(vectorData?.retrievedDocs)
        relevantLongTermMemory += `\n\n#<data_retrieved_from_vector_db>\n${docToString}\n\n</data_retrieved_from_vector_db>`

        if (archiveLog.exist) {
            const bm25Data = await bm25Retriever(archiveLog?.data as string, query)
            relevantLongTermMemory += `\n\n#<data_retrieved_from_daily_log_archive>${bm25Data}</data_retrieved_from_daily_log_archive>`
        }

        const filteredData = await extractRelevantDocument(query, relevantLongTermMemory)

        const longTermMemory = `# Relevant LTM Layer\n${filteredData || "No relevant long-term memories found."}`

        console.log("===============Retrieved from memo=====================", longTermMemory)

        return `${longTermMemory}`
    },
    {
        name: "retrieve_relevant_ltm",
        description: `
        Retrieve relevant long-term memory (LTM) entries based on the user query.
        
        This tool searches a vector database of previously stored summaries and returns
        high-level contextual information about the user, such as preferences, goals,
        past interaction, and important background knowledge.
        
        Use this tool when:
        - The query depends on past conversations or long-term context
        - You need to recall user-specific information (preferences, habits, goals, etc.)
        - The current input is ambiguous and may benefit from historical context
        - Personalization or continuity is required
        
        Do NOT use this tool for:
        - Simple factual questions that do not depend on user history
        - Real-time or short-term conversation context (use short-term memory instead)
        
        Returns:
        - A list of summarized memory entries relevant to the query
        `,
        schema: z.object({
            query: z.string().describe("The semantic search query used to retrieve relevant long-term memory")
        })
    }
)
