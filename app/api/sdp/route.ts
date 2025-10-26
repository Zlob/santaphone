import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function cleanModel(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().replace(/^"+|"+$/g, ""); // убираем случайные кавычки
  return s || undefined;
}

function cleanSdp(v: unknown): string {
  if (typeof v !== "string") return "";
  // Иногда оффер приходит обёрнутым кавычками — снимем их и нормализуем переводы строк
  const s = v.replace(/^"+|"+$/g, "").replace(/\r?\n/g, "\r\n");
  return s;
}

// Если хочешь белый список — добавь сюда свои модели из /v1/models
const ALLOWED_MODELS = new Set<string>([
  "gpt-4o-realtime-preview-2025-06-03", // рекомендованный стабильный id
  "gpt-4o-realtime-preview",
  "gpt-4o-realtime-preview-2024-12-17",
  "gpt-4o-realtime-preview-2024-10-01",
  "gpt-4o-mini-realtime-preview",
  "gpt-4o-mini-realtime-preview-2024-12-17",
  "gpt-realtime",
  "gpt-realtime-2025-08-28",
  "gpt-realtime-mini",
  "gpt-realtime-mini-2025-10-06",
]);

export async function POST(req: NextRequest) {
  const { sdp: rawSdp, model: rawModel } = await req.json();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
  }

  // 1) модель: либо из тела, либо из .env, либо зафиксированный дефолт
  const envModel = cleanModel(process.env.OPENAI_REALTIME_MODEL);
  const bodyModel = cleanModel(rawModel);

  // Рекомендуется на этапе отладки зафиксировать один проверенный id:
  const chosenModel =
      (bodyModel && ALLOWED_MODELS.has(bodyModel) && bodyModel) ||
      (envModel && ALLOWED_MODELS.has(envModel) && envModel) ||
      "gpt-4o-realtime-preview-2025-06-03";

  // 2) sdp: чистим и проверяем
  const sdp = cleanSdp(rawSdp);
  if (!sdp || !/m=audio/.test(sdp)) {
    return NextResponse.json(
        { error: "Offer did not have an audio media section." },
        { status: 400 }
    );
  }

  console.log("[Realtime] Using model:", chosenModel);

  // 3) HTTP SDP-обмен с OpenAI Realtime
  const resp = await fetch(
      `https://api.openai.com/v1/realtime?model=${encodeURIComponent(chosenModel)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "OpenAI-Beta": "realtime=v1",
          "Content-Type": "application/sdp",
          Accept: "application/sdp",
        },
        body: sdp, // важен «сырой» SDP (string), без JSON
      }
  );

  if (!resp.ok) {
    // пробуем вытащить JSON-ошибку от OpenAI
    const text = await resp.text();
    let payload: any = text;
    try {
      payload = JSON.parse(text);
    } catch {
      /* no-op */
    }
    return NextResponse.json({ error: payload }, { status: 500 });
  }

  const answer = await resp.text();
  return new NextResponse(answer, {
    status: 200,
    headers: { "Content-Type": "application/sdp" },
  });
}
