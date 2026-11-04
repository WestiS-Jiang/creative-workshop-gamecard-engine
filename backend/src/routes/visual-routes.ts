import { Router } from "express";
import { VisualGenService } from "../services/visual-gen-service";

const router = Router();
const visualService = new VisualGenService();

router.post("/prompt-from-image", async (req, res, next) => {
  try {
    const body = req.body;
    if (!isRecord(body) || !Array.isArray(body.image_list)) {
      res.status(400).json({
        ok: false,
        error: "image_list must be a non-empty string array."
      });
      return;
    }

    const imageList = body.image_list.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0);
    if (imageList.length === 0) {
      res.status(400).json({
        ok: false,
        error: "image_list must include at least one image url/data url."
      });
      return;
    }

    const output = await visualService.promptFromImage({
      instruction: typeof body.instruction === "string" ? body.instruction : undefined,
      image_list: imageList,
      model: typeof body.model === "string" ? body.model : undefined
    });

    res.json({
      ok: true,
      ...output
    });
  } catch (error) {
    next(error);
  }
});

router.post("/generate", async (req, res, next) => {
  try {
    const body = req.body;
    if (!isRecord(body) || typeof body.text !== "string" || body.text.trim().length === 0) {
      res.status(400).json({
        ok: false,
        error: "text is required."
      });
      return;
    }

    const output = await visualService.generateImage({
      text: body.text,
      aspect_ratio: typeof body.aspect_ratio === "string" ? body.aspect_ratio : undefined,
      seed: Number(body.seed)
    });

    res.json({
      ok: true,
      ...output
    });
  } catch (error) {
    next(error);
  }
});

router.post("/style-preview", async (req, res, next) => {
  try {
    const body = req.body;
    if (!isRecord(body) || typeof body.style_prompt !== "string" || body.style_prompt.trim().length === 0) {
      res.status(400).json({
        ok: false,
        error: "style_prompt is required."
      });
      return;
    }

    const output = await visualService.generateStylePreview({
      style_name: typeof body.style_name === "string" ? body.style_name : undefined,
      style_prompt: body.style_prompt,
      genre: typeof body.genre === "string" ? body.genre : undefined,
      source_summary: typeof body.source_summary === "string" ? body.source_summary : undefined,
      aspect_ratio: typeof body.aspect_ratio === "string" ? body.aspect_ratio : undefined
    });

    res.json({
      ok: true,
      ...output
    });
  } catch (error) {
    next(error);
  }
});

router.post("/style-recommend", async (req, res, next) => {
  try {
    const body = req.body;
    if (!isRecord(body)) {
      res.status(400).json({
        ok: false,
        error: "body must be an object."
      });
      return;
    }

    const output = await visualService.recommendStylePresets({
      genre: typeof body.genre === "string" ? body.genre : undefined,
      source_summary: typeof body.source_summary === "string" ? body.source_summary : undefined,
      source_file_name: typeof body.source_file_name === "string" ? body.source_file_name : undefined
    });

    res.json({
      ok: true,
      ...output
    });
  } catch (error) {
    next(error);
  }
});

router.post("/character-restyle", async (req, res, next) => {
  try {
    const body = req.body;
    if (!isRecord(body) || typeof body.style_prompt !== "string" || body.style_prompt.trim().length === 0) {
      res.status(400).json({
        ok: false,
        error: "style_prompt is required."
      });
      return;
    }

    const output = await visualService.characterRestyle({
      style_prompt: body.style_prompt,
      style_name: typeof body.style_name === "string" ? body.style_name : undefined,
      style_tone: typeof body.style_tone === "string" ? body.style_tone : undefined,
      style_palette: typeof body.style_palette === "string" ? body.style_palette : undefined,
      character_prompt: typeof body.character_prompt === "string" ? body.character_prompt : undefined,
      reference_image_url: typeof body.reference_image_url === "string" ? body.reference_image_url : undefined,
      reference_image_data_url:
        typeof body.reference_image_data_url === "string" ? body.reference_image_data_url : undefined,
      aspect_ratio: typeof body.aspect_ratio === "string" ? body.aspect_ratio : undefined
    });

    res.json({
      ok: true,
      ...output
    });
  } catch (error) {
    next(error);
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export default router;
