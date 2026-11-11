import { CohereEmbeddings } from "@langchain/cohere"
import { PineconeStore } from "@langchain/pinecone"
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone"

function getEmbeddings() {
    return new CohereEmbeddings({
        model: "embed-english-v3.0",
        apiKey: process.env.COHERE_API_KEY
    })
}

async function getVectorStore(embeddings: any) {
    const pinecone = new PineconeClient({ apiKey: process.env.PINECONE_API_KEY as string })
    const index = pinecone.Index(process.env.PINECONE_INDEX as string)

    return PineconeStore.fromExistingIndex(embeddings, {
        pineconeIndex: index,
        maxConcurrency: 5
    })
}

export async function queryMultiVector({ userId, projectId, query, kChildren=6, kParents=3 }: Record<string, any>) {
    const embeddings = getEmbeddings()
    const vectorStore = await getVectorStore(embeddings)

    const childFilter = {
        docType: "child",
        userId,
        ...(projectId ? { projectId } : {})
    }

    const childDocs = await vectorStore.similaritySearch(query, kChildren, childFilter) 
    console.log(`[RAG] Found ${childDocs.length} child matches`)

    if (childDocs.length === 0) {
        return { query, retrievedDocs: [], childMatches: 0 }
    }

    const parentIds = [
        ...new Set(
            childDocs
                .map((doc) => doc.metadata.parentId)
                .filter((id) => id != null)
        )
    ]

    console.log(`[RAG] Fetching ${parentIds.length} parent chunks`)


    const parentFilter = {
        docType: "parent",
        userId,
        source: { $in: parentIds },
        ...(projectId ? { projectId } : {})
    }

    const retriever = vectorStore.asRetriever({
        k: kParents,
        filter: parentFilter
    })

    const retrievedDocs = await retriever.invoke(query)
    console.log(`[RAG] Retrieved ${retrievedDocs.length} parent documents`)

    return {
        query,
        retrievedDocs,
        childMatches: childDocs.length
    }
}
