/**
 * Shared provider resolution utilities.
 * Used by both chat.js and agent.js.
 */

import { fetchQwenModels, QWEN_MODELS } from "./qwen.js";
import { fetchDeepseekModels, DEEPSEEK_MODELS } from "./deepseek.js";

export async function getAllModels() {
  const qwenModels = await fetchQwenModels();
  const dsModels = await fetchDeepseekModels();
  return [...qwenModels, ...dsModels];
}

export async function resolveProvider(modelId) {
  const allModels = await getAllModels();
  if (allModels.some((m) => m.id === modelId && m.id.includes("qwen"))) return "qwen";
  if (allModels.some((m) => m.id === modelId && m.id.includes("deepseek"))) return "deepseek";

  if (QWEN_MODELS.some((m) => m.id === modelId)) return "qwen";
  if (DEEPSEEK_MODELS.some((m) => m.id === modelId)) return "deepseek";

  const lower = modelId.toLowerCase();
  if (lower.includes("qwen") || lower.includes("qwq")) return "qwen";
  if (lower.includes("deepseek") || lower.includes("deep")) return "deepseek";

  return null;
}
