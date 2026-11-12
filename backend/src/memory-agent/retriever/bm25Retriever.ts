import { Document } from "@langchain/core/documents"
import { LLM } from "@/llm/LLM"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"

export function formatDocumentsAsString(documents: Document[] = []) {
    return documents.map((doc) => doc.pageContent).join("\n\n")
}

function terms(value: string): string[] {
    return value.toLowerCase().match(/[a-z0-9_]+/g) ?? []
}

/** Lightweight local lexical retrieval for the archived daily log. */
export async function bm25Retriever(document: string, query: string) {
    const chunks = document.split(/\n{2,}/).filter((chunk) => chunk.trim())
    const queryTerms = terms(query)
    const ranked = chunks.map((chunk, index) => {
        const chunkTerms = terms(chunk)
        const score = queryTerms.reduce((sum, term) => sum + chunkTerms.filter((item) => item === term).length, 0)
        return { chunk, score, index }
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 4)
    return extractRelevantDocument(query, ranked.map((item) => item.chunk).join("\n\n"))
}

export async function extractRelevantDocument(query: string, doc: string) {
    if (!doc.trim()) return ""
    const llm = LLM.getInstance("deepseek-chat")
    const response = await llm.invoke([
        new SystemMessage(`You filter retrieved memory. Return only verbatim passages directly relevant to the question. Do not explain, paraphrase, or add headings. If nothing is relevant, return an empty string.`),
        new HumanMessage(`Question:\n${query}\n\nRetrieved memory:\n${doc}`)
    ])
    return typeof response.content === "string" ? response.content.trim() : ""
}
