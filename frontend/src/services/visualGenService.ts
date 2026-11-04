const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const API_RETRY_MAX = Number(import.meta.env.VITE_API_RETRY_MAX ?? 2);

function buildUrl(path: string): string {
  if (!API_BASE_URL) {
    return path;
  }
  return `${API_BASE_URL}${path}`;
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetchWithRetry(buildUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const raw = await response.text();
  let json: ({ ok?: boolean; error?: string } & T) | null = null;
  if (raw) {
    try {
      json = JSON.parse(raw) as { ok?: boolean; error?: string } & T;
    } catch {
      throw new Error(`视觉服务返回非 JSON 响应（HTTP ${response.status}）。`);
    }
  }
  if (!response.ok || !json || json.ok === false) {
    throw new Error((json?.error ?? raw) || `Request failed: ${response.status}`);
  }
  return json;
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const maxAttempts = Number.isFinite(API_RETRY_MAX) && API_RETRY_MAX > 0 ? Math.floor(API_RETRY_MAX) : 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.status >= 500 && attempt < maxAttempts) {
        await delay(250 * attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransientFetchError(error)) {
        throw error;
      }
      await delay(250 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown network error");
}

function isTransientFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("load failed") ||
    message.includes("aborted") ||
    message.includes("timeout")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export interface StylePreviewResponse {
  ok: true;
  prompt: string;
  image_url: string;
}

export interface CharacterRestyleResponse {
  ok: true;
  prompt: string;
  image_url: string;
}

export interface StyleRecommendResponse {
  ok: true;
  presets: Array<{
    name: string;
    themeStyle: string;
    tone: string;
    palette: string;
    promptHint: string;
    originReason: string;
  }>;
}

export const visualGenService = {
  recommendStylePresets(payload: {
    genre?: string;
    source_summary?: string;
    source_file_name?: string;
  }) {
    return postJson<StyleRecommendResponse>("/api/visual/style-recommend", payload);
  },

  generateStylePreview(payload: {
    style_name?: string;
    style_prompt: string;
    genre?: string;
    source_summary?: string;
    aspect_ratio?: string;
  }) {
    return postJson<StylePreviewResponse>("/api/visual/style-preview", payload);
  },

  restyleCharacter(payload: {
    style_prompt: string;
    style_name?: string;
    style_tone?: string;
    style_palette?: string;
    character_prompt?: string;
    reference_image_url?: string;
    reference_image_data_url?: string;
    aspect_ratio?: string;
  }) {
    return postJson<CharacterRestyleResponse>("/api/visual/character-restyle", payload);
  }
};
