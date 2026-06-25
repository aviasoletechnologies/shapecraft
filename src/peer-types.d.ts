// Stubs for optional peer dependencies — users install only what they need
declare module "openai" {
  const OpenAI: any;
  export default OpenAI;
}

declare module "groq-sdk" {
  const Groq: any;
  export default Groq;
}

declare module "@anthropic-ai/sdk" {
  const Anthropic: any;
  export default Anthropic;
}

declare module "@google/genai" {
  export const GoogleGenAI: any;
}

declare module "node-llama-cpp" {
  export const getLlama: any;
  export const LlamaChatSession: any;
}
