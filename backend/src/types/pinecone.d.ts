declare module "@pinecone-database/pinecone" {
    export class Pinecone {
        constructor(options: { apiKey: string })
        Index(name: string): any
    }
}
