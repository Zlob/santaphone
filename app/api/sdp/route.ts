import { NextRequest, NextResponse } from "next/server";
import { getRealtimeModel } from "@/lib/realtimeServerConfig";

export const runtime = "nodejs";

function cleanSdp(v: unknown): string {
  if (typeof v !== "string") return "";
  // Иногда оффер приходит обёрнутым кавычками — снимем их и нормализуем переводы строк
  const s = v.replace(/^"+|"+$/g, "").replace(/\r?\n/g, "\r\n");
  return s;
}

// Если хочешь белый список — добавь сюда свои модели из /v1/models
export async function POST(req: NextRequest) {
  const { sdp: rawSdp } = await req.json();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
  }

  // 1) модель: фиксированная конфигурация на сервере
  const chosenModel = getRealtimeModel();

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
    let payload: unknown = text;
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
