import { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { ChatDeepSeek } from "@langchain/deepseek"
import { ChatGoogle } from "@langchain/google/node"

export type DeepSeekModel = `deepseek-${string}`
export type GeminiModel = `gemini-${string}`
export type LLMModel = DeepSeekModel | GeminiModel

const DEFAULT_MODEL: LLMModel = "deepseek-chat"

export class LLM {
  private static readonly instances = new Map<LLMModel, BaseChatModel>()

  private constructor() {}

  public static getInstance(model: LLMModel = DEFAULT_MODEL): BaseChatModel {
    const existingInstance = LLM.instances.get(model)
    if (existingInstance) return existingInstance

    let instance: BaseChatModel

    if (model.startsWith("deepseek-")) {
      const apiKey = process.env.DEEPSEEK_API_KEY
      if (!apiKey) {
        throw new Error("DEEPSEEK_API_KEY is not defined in the environment variables.")
      }

      instance = new ChatDeepSeek({
        model,
        temperature: 0.7,
        apiKey
      })
    } else if (model.startsWith("gemini-")) {
      const apiKey = process.env.GOOGLE_API_KEY
      if (!apiKey) {
        throw new Error("GOOGLE_API_KEY is not defined in the environment variables.")
      }

      instance = new ChatGoogle({
        model,
        temperature: 0.7,
        maxRetries: 2,
        apiKey
      })
    } else {
      throw new Error(`Unsupported LLM model: ${model}`)
    }

    LLM.instances.set(model, instance)
    return instance
  }
}
