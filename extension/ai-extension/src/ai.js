import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);

// Using Gemini 1.5 Flash (fast + good for chat/QA)
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

export async function askAI(prompt) {
  try {
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    console.error("AI Error:", error);
    return "⚠️ Error calling AI";
  }
}