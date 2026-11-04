export interface VoiceCloneGatewayConfig {
  provider: "LOCAL_MATERIAL" | "REMOTE_TTS";
  endpoint: string;
  model: string;
}

export interface VoiceProfileDraft {
  profile_id: string;
  name: string;
  source_material_id?: string;
  mode: "UPLOAD_CLONE" | "AI_RANDOM";
  prompt: string;
}

export interface VoiceClonePayload {
  gateway: VoiceCloneGatewayConfig;
  profile: VoiceProfileDraft;
  preview_text: string;
}

// 本地模式占位：当前只返回“由前端素材库试听”提示，后续可无缝替换为真实远程克隆/合成接口。
export async function runVoiceClonePreview(_payload: VoiceClonePayload): Promise<{ ok: true; mode: "LOCAL_MATERIAL" | "REMOTE_TTS" }> {
  return {
    ok: true,
    mode: "LOCAL_MATERIAL"
  };
}

