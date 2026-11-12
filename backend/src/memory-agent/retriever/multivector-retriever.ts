import { Document } from "@langchain/core/documents"
import { CohereEmbeddings } from "@langchain/cohere"
import { PineconeStore } from "@langchain/pinecone"
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone"
import { v4 as uuidv4 } from "uuid"

function splitDocument(document: Document, chunkSize: number, overlap: number): Document[] {
    const text = document.pageContent
    const result: Document[] = []
    const step = Math.max(1, chunkSize - overlap)
    for (let start = 0; start < text.length; start += step) {
        const pageContent = text.slice(start, start + chunkSize)
        if (pageContent.trim()) result.push(new Document({ pageContent, metadata: { ...document.metadata } }))
        if (start + chunkSize >= text.length) break
    }
    return result
}

function createParentDocs(rawDocs: Document[], userId: string) {
    return rawDocs.flatMap((rawDoc) => splitDocument(rawDoc, 2000, 400)).map((split) => {
        const chunkId = uuidv4()
        split.metadata = { ...split.metadata, docType: "parent", chunkId, parentId: chunkId, source: chunkId, userId }
        return split
    })
}

function createChildDocs(parentDocs: Document[], userId: string) {
    return parentDocs.flatMap((parent) => splitDocument(parent, 800, 100)).map((split, index) => {
        const parentId = String(split.metadata.parentId)
        const chunkId = `child-${parentId}-${index}`
        split.metadata = { ...split.metadata, docType: "child", parentId, chunkId, source: chunkId, userId }
        return split
    })
}

export async function docEmbeddingMultiVector(props: { allDocs: Document[]; userId: string; projectId?: string }) {
    const { allDocs, userId, projectId = "default" } = props
    if (!process.env.COHERE_API_KEY || !process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX) {
        throw new Error("COHERE_API_KEY, PINECONE_API_KEY, and PINECONE_INDEX are required for memory embeddings.")
    }
    const embeddings = new CohereEmbeddings({ model: "embed-english-v3.0", apiKey: process.env.COHERE_API_KEY })
    const pinecone = new PineconeClient({ apiKey: process.env.PINECONE_API_KEY })
    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX)
    const parentDocs = createParentDocs(allDocs, userId)
    const childDocs = createChildDocs(parentDocs, userId)
    for (const document of [...parentDocs, ...childDocs]) document.metadata.projectId = projectId
    const vectorStore = new PineconeStore(embeddings, { pineconeIndex, maxConcurrency: 5 })
    await vectorStore.addDocuments([...parentDocs, ...childDocs])
    return { parentCount: parentDocs.length, childCount: childDocs.length }
}
