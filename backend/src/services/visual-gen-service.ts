import { resolveProxyDispatcher } from "./llm/proxy-dispatcher";
import { createLlmService } from "./llmService";

type PromptFromImageInput = {
  instruction?: string;
  image_list: string[];
  model?: string;
};

type GenerateImageInput = {
  text: string;
  aspect_ratio?: string;
  seed?: number;
};

type StylePreviewInput = {
  style_name?: string;
  style_prompt: string;
  genre?: string;
  source_summary?: string;
  aspect_ratio?: string;
};

type CharacterRestyleInput = {
  style_prompt: string;
  style_name?: string;
  style_tone?: string;
  style_palette?: string;
  character_prompt?: string;
  reference_image_url?: string;
  reference_image_data_url?: string;
  aspect_ratio?: string;
};

type StyleRecommendInput = {
  genre?: string;
  source_summary?: string;
  source_file_name?: string;
};

type VisualStylePresetRecommendation = {
  name: string;
  themeStyle: string;
  tone: string;
  palette: string;
  promptHint: string;
  originReason: string;
};

const DEFAULT_QWEN_VL_URL = "";
const DEFAULT_QWEN_VL_MODEL = "Qwen2-VL-72B-Instruct";
const DEFAULT_QWEN_VL_KEY = "";
const DEFAULT_IMAGE_API_URL = "https://new.12ai.org/v1/images/generations";
const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";
const DEFAULT_PUBLIC_DOWNLOAD_PREFIX = "https://metaso.cn/api/public-file/download?fileName=";
const DEFAULT_REWRITE_FROM = "";
const DEFAULT_REWRITE_TO = "";

export class VisualGenService {
  private readonly llmService = createLlmService();

  async promptFromImage(input: PromptFromImageInput): Promise<{ prompt: string }> {
    const images = input.image_list.filter((item) => typeof item === "string" && item.trim().length > 0);
    if (images.length === 0) {
      throw new Error("image_list is required.");
    }

    const qwenUrl = process.env.VISUAL_QWEN_VL_URL ?? DEFAULT_QWEN_VL_URL;
    const qwenModel = input.model ?? process.env.VISUAL_QWEN_VL_MODEL ?? DEFAULT_QWEN_VL_MODEL;
    const qwenKey = process.env.VISUAL_QWEN_VL_KEY ?? DEFAULT_QWEN_VL_KEY;
    const instruction =
      input.instruction?.trim() ||
      "Describe this image in detail for a text-to-image AI. Output only the English prompt.";

    const payload = {
      model: qwenModel,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: instruction
            },
            ...images.map((url) => ({
              type: "image_url",
              image_url: {
                url
              }
            }))
          ]
        }
      ]
    };

    const requestInit: Record<string, unknown> = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${qwenKey}`
      },
      body: JSON.stringify(payload)
    };
    const response = await fetchWithNetworkFallback(qwenUrl, requestInit);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Qwen-VL request failed (${response.status}): ${text}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    const prompt = String(json.choices?.[0]?.message?.content ?? "").trim();
    if (!prompt) {
      throw new Error("Qwen-VL returned empty prompt.");
    }

    return {
      prompt
    };
  }

  async generateImage(input: GenerateImageInput): Promise<{ image_url: string }> {
    const text = String(input.text ?? "").trim();
    if (!text) {
      throw new Error("text is required.");
    }

    const imageApiUrl = process.env.VISUAL_IMAGE_API_URL ?? process.env.VISUAL_ZIMAGE_URL ?? DEFAULT_IMAGE_API_URL;
    const provider = String(process.env.VISUAL_IMAGE_PROVIDER ?? "OPENAI_COMPAT").toUpperCase();
    const aspectRatio = input.aspect_ratio ?? "16:9";

    const payload =
      provider === "METASOTA"
        ? {
            text,
            aspect_ratio: aspectRatio
          }
        : {
            model: process.env.VISUAL_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL,
            prompt: text,
            input: text,
            size: mapAspectRatioToSize(aspectRatio),
            n: 1,
            response_format: process.env.VISUAL_IMAGE_RESPONSE_FORMAT ?? "url"
          };

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (provider !== "METASOTA") {
      const apiKey = String(process.env.VISUAL_IMAGE_API_KEY ?? "").trim();
      if (!apiKey) {
        throw new Error("VISUAL_IMAGE_API_KEY is required for OPENAI_COMPAT image provider.");
      }
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const requestInit: Record<string, unknown> = {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    };
    const response = await fetchWithNetworkFallback(imageApiUrl, requestInit);

    if (!response.ok) {
      const textBody = await response.text();
      throw new Error(`image API request failed (${response.status}): ${textBody}`);
    }

    const json = (await response.json()) as {
      code?: number;
      msg?: string;
      image_url?: string;
      data?: Array<{
        url?: string;
        b64_json?: string;
      }>;
    };

    if (provider === "METASOTA" && json.code !== 0) {
      throw new Error(`image API returned error: ${json.msg ?? "unknown"}`);
    }

    const rawUrl = resolveImageUrlFromResponse(json);
    if (!rawUrl) {
      throw new Error("image API returned empty image_url.");
    }

    return {
      image_url: normalizeImageUrl(String(rawUrl).trim())
    };
  }

  async generateStylePreview(input: StylePreviewInput): Promise<{ prompt: string; image_url: string }> {
    const prompt = [
      input.style_prompt,
      input.style_name ? `style name: ${input.style_name}` : "",
      input.genre ? `genre: ${input.genre}` : "",
      input.source_summary ? `story context: ${input.source_summary}` : "",
      "high detail, cinematic lighting, clean composition, no embedded text"
    ]
      .filter(Boolean)
      .join(", ");

    const image = await this.generateImage({
      text: prompt,
      aspect_ratio: input.aspect_ratio ?? "16:9"
    });

    return {
      prompt,
      image_url: image.image_url
    };
  }

  async recommendStylePresets(input: StyleRecommendInput): Promise<{ presets: VisualStylePresetRecommendation[] }> {
    const genre = String(input.genre ?? "通用题材").trim() || "通用题材";
    const sourceSummary = String(input.source_summary ?? "").trim();
    const sourceFileName = String(input.source_file_name ?? "").trim() || undefined;
    const raw = await this.llmService.recommendVisualStyles({
      genre,
      sourceSummary: sourceSummary || "暂无摘要，请按题材生成差异化风格。",
      sourceFileName
    });
    const normalized = normalizeVisualStylePresets(raw);
    if (normalized.length !== 4) {
      throw new Error("VISUAL_STYLE_RECOMMEND returned invalid presets (must be exactly 4).");
    }
    return { presets: normalized };
  }

  async characterRestyle(input: CharacterRestyleInput): Promise<{ prompt: string; image_url: string }> {
    const styleAnchor = [
      input.style_name ? `风格名称：${input.style_name}` : "",
      input.style_tone ? `统一基调：${input.style_tone}` : "",
      input.style_palette ? `统一色板：${input.style_palette}` : "",
      "硬约束：人物画风必须严格匹配上述风格锚点，不可偏离到其他流派"
    ]
      .filter(Boolean)
      .join("；");
    const basePromptParts = [styleAnchor, input.style_prompt, input.character_prompt ?? ""].filter(Boolean);
    let extractedPrompt = "";

    const referenceImages = [input.reference_image_data_url, input.reference_image_url]
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim());

    if (referenceImages.length > 0) {
      try {
        const extracted = await this.promptFromImage({
          instruction:
            "请提取这张人物参考图的外貌关键词，仅输出中文短句。只描述五官、发型、体态、服装与武器外观；不要描述剧情，不要描述场景背景。",
          image_list: [referenceImages[0]]
        });
        extractedPrompt = extracted.prompt;
      } catch {
        // Fallback: keep generation available even if prompt-from-image service is unstable.
        extractedPrompt = "";
      }
    }

    const finalPrompt = dedupePromptSegments([
      ...basePromptParts,
      extractedPrompt,
      "人物半身立绘，主体居中，五官清晰，服装与武器细节明确，完整头肩与上半身构图",
      "纯色或透明背景，无场景元素",
      "避免剧情剧透，不出现事件描述",
      "无文字，无水印"
    ]).join("；");

    const image = await this.generateImage({
      text: finalPrompt,
      aspect_ratio: input.aspect_ratio ?? "3:4"
    });

    return {
      prompt: finalPrompt,
      image_url: image.image_url
    };
  }
}

function rewriteImageUrl(url: string): string {
  const rewriteFrom = process.env.VISUAL_IMAGE_URL_REWRITE_FROM ?? DEFAULT_REWRITE_FROM;
  const rewriteTo = process.env.VISUAL_IMAGE_URL_REWRITE_TO ?? DEFAULT_REWRITE_TO;
  if (!rewriteFrom || !rewriteTo) {
    return url;
  }
  return url.replace(rewriteFrom, rewriteTo);
}

function normalizeImageUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (/^data:image\//i.test(trimmed)) {
    return trimmed;
  }

  const byNameIdx = trimmed.lastIndexOf("by-name/");
  if (byNameIdx >= 0) {
    const fileName = trimmed.slice(byNameIdx + "by-name/".length);
    const prefix = process.env.VISUAL_PUBLIC_DOWNLOAD_PREFIX ?? DEFAULT_PUBLIC_DOWNLOAD_PREFIX;
    return `${prefix}${fileName}`;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    const prefix = process.env.VISUAL_PUBLIC_DOWNLOAD_PREFIX ?? DEFAULT_PUBLIC_DOWNLOAD_PREFIX;
    return `${prefix}${trimmed.replace(/^\/+/, "")}`;
  }

  return rewriteImageUrl(trimmed);
}

function resolveImageUrlFromResponse(json: {
  image_url?: string;
  data?: Array<{ url?: string; b64_json?: string }>;
}): string {
  const fromLegacy = String(json.image_url ?? "").trim();
  if (fromLegacy) {
    return fromLegacy;
  }

  const data0 = json.data?.[0];
  const fromUrl = String(data0?.url ?? "").trim();
  if (fromUrl) {
    return fromUrl;
  }

  const fromB64 = String(data0?.b64_json ?? "").trim();
  if (fromB64) {
    return `data:image/png;base64,${fromB64}`;
  }

  return "";
}

function mapAspectRatioToSize(aspectRatio: string): string {
  const ratio = aspectRatio.trim();
  switch (ratio) {
    case "1:1":
      return "1024x1024";
    case "3:4":
      return "1024x1365";
    case "4:3":
      return "1365x1024";
    case "9:16":
      return "1024x1792";
    case "16:9":
      return "1792x1024";
    default:
      return "1024x1024";
  }
}

async function fetchWithNetworkFallback(url: string, baseInit: Record<string, unknown>): Promise<Response> {
  const proxyDispatcher = resolveProxyDispatcher();
  const mode = String(process.env.VISUAL_PROXY_MODE ?? "auto").toLowerCase();
  const attempts: Array<{ useProxy: boolean }> = [];

  if (mode === "proxy") {
    attempts.push({ useProxy: true });
  } else if (mode === "direct") {
    attempts.push({ useProxy: false });
  } else {
    if (proxyDispatcher) {
      attempts.push({ useProxy: true });
    }
    attempts.push({ useProxy: false });
  }

  if (attempts.length === 0) {
    attempts.push({ useProxy: false });
  }

  let lastError: unknown = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    const hasFallback = index < attempts.length - 1;
    const requestInit: Record<string, unknown> = { ...baseInit };

    if (attempt.useProxy && proxyDispatcher) {
      requestInit.dispatcher = proxyDispatcher;
    }

    try {
      const response = await fetch(url, requestInit as RequestInit);
      if (hasFallback && attempt.useProxy && mode === "auto" && isProxyGatewayStatus(response.status)) {
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!hasFallback) {
        throw new Error(formatFetchError(error));
      }
    }
  }

  throw new Error(formatFetchError(lastError));
}

function isProxyGatewayStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function formatFetchError(error: unknown): string {
  if (error instanceof Error) {
    const cause = Reflect.get(error, "cause");
    const causeMessage =
      cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string"
        ? cause.message
        : "";
    return causeMessage ? `${error.message} (cause: ${causeMessage})` : error.message;
  }
  return String(error);
}

function dedupePromptSegments(segments: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  segments.forEach((segment) => {
    const normalized = String(segment ?? "")
      .replace(/[，,;；]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(String(segment).trim());
  });
  return result;
}

function normalizeVisualStylePresets(raw: unknown): VisualStylePresetRecommendation[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return [];
  }
  const presets = Array.isArray((raw as Record<string, unknown>).presets)
    ? ((raw as Record<string, unknown>).presets as unknown[])
    : [];
  const normalized = presets
    .map((item, idx) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const row = item as Record<string, unknown>;
      const name = String(row.name ?? "").trim();
      const themeStyle = normalizeStyleId(String(row.themeStyle ?? row.theme_style ?? "").trim() || `dynamic_style_${idx + 1}`);
      const tone = String(row.tone ?? "").trim();
      const palette = String(row.palette ?? "").trim();
      const promptHint = String(row.promptHint ?? row.prompt_hint ?? "").trim();
      const originReason = String(row.originReason ?? row.origin_reason ?? "").trim();
      if (!name || !themeStyle || !tone || !palette || !promptHint) {
        return null;
      }
      return {
        name,
        themeStyle,
        tone,
        palette,
        promptHint,
        originReason: originReason || "由小说内容自动推断。"
      } satisfies VisualStylePresetRecommendation;
    })
    .filter((item): item is VisualStylePresetRecommendation => !!item)
    .slice(0, 4);

  if (normalized.length < 4) {
    return [];
  }
  return normalized;
}

function normalizeStyleId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}
