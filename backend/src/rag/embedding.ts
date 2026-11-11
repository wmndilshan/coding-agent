import { CohereEmbeddings } from "@langchain/cohere"
import { PineconeStore } from "@langchain/pinecone"
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone"
import { v4 as uuidv4 } from "uuid"
import { chunkFileByAST } from "./chunker"
import path from "path"

function getEmbeddings() {
    return new CohereEmbeddings({ model: "embed-english-v3.0", apiKey: process.env.COHERE_API_KEY })
}

async function getPineconeStore(embeddings: any) {
    const pinecone = new PineconeClient({ apiKey: process.env.PINECONE_API_KEY as string })
    const index = pinecone.Index(process.env.PINECONE_INDEX as string)
    return new PineconeStore(embeddings, { pineconeIndex: index, maxConcurrency: 5 })
}

function createChildrenFromParent(parentDoc: Record<string, any>, parentId: string) {
    const lines = parentDoc.pageContent.split("\n")
    const mid = Math.ceil(lines.length / 2)
    const halves = [lines.slice(0, mid).join("\n"), lines.slice(mid).join("\n")].filter((half) => half.trim().length > 0)

    return halves.map((half, i) => ({
        pageContent: half,
        metadata: {
            ...parentDoc.metadata,
            docType: "child",
            parentId,
            chunkId: `child-${parentId}-${i}`,
            source: `child-${parentId}-${i}`,
            chunkIndex: i
        }
    }))
}

export async function embedFilesWithAST({ files, userId, projectId="default" }: Record<string, any>) {
    const embeddings = getEmbeddings()
    const vectorStore = await getPineconeStore(embeddings)
    const parentDocs = []
    const childDocs = []
    const fileChunkMap: Record<string, any> = {}

    for (const { path: filePath, content } of files) {
        const ext = path.extname(filePath).toLocaleLowerCase()
        const chunks = chunkFileByAST(content, filePath, ext)
        let fcc = 0

        for (const chunk of chunks) {
            const parentId = uuidv4()
            const parentDoc = {
                pageContent: chunk.pageContent,
                metadata: {
                    ...chunk.metadata,
                    docType: "parent", chunkId: parentId, parentId, source: parentId, userId, projectId
                }
            }
            parentDocs.push(parentDoc)

            if (chunk.pageContent.length > 600) {
                const children = createChildrenFromParent(parentDoc, parentId).map((c) => ({
                    ...c, metadata: { ...c.metadata, userId, projectId },
                }))
                childDocs.push(...children)
                fcc += children.length
            }
        }

        fileChunkMap[filePath] = chunks.length
        console.log(`[RAG] ${filePath} -> ${chunks.length} AST chunks, ${fcc} children`)
    }

    console.log(`[RAG] Upserting ${parentDocs.length} parents + ${childDocs.length} children...`)
    await vectorStore.addDocuments([...parentDocs, ...childDocs])
    console.log(`[RAG] Done`)


    return { fileChunkMap, parentCount: parentDocs.length, childCount: childDocs.length, total: parentDocs.length + childDocs.length}
}
