import { NextRequest, NextResponse } from "next/server";
import { santaSystemPrompt } from "@/lib/santaPrompt";

export const runtime = "nodejs"; // важно, чтобы был серверный runtime

export async function POST(req: NextRequest) {
  const { sdp, voice, model } = await req.json();

  const apiKey = process.env.OPENAI_API_KEY!;
  const chosenModel = model || process.env.OPENAI_REALTIME_MODEL || "gpt-4o-realtime-preview";
  const chosenVoice = voice || process.env.OPENAI_VOICE || "alloy";

  // Конфигурация сессии: системный промпт, голос, язык/ASR
  const sessionConfig = {
    model: chosenModel,
    voice: chosenVoice,
    // опции могут включать языковые подсказки, бардж-ин, VAD и т.п.
    modalities: ["audio", "text"],
    instructions: santaSystemPrompt,
    input_audio_format: { type: "wav" }, // Realtime сам поймёт поток PCM/Opus
    turn_detection: { type: "server_vad" }, // серверная VAD для бардж-ина
    // Можно указать предпочтительный язык:
    // speech_to_text: { language: "ru" },
  };

  // HTTP SDP-обмен с OpenAI Realtime (WebRTC over HTTP)
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
      body: sdp, // ВАЖНО: это именно строка SDP (offer.sdp), без JSON и без не-ASCII
    }
  );

  if (!resp.ok) {
    const text = await resp.text();
    return NextResponse.json({ error: text }, { status: 500 });
  }

  const answer = await resp.text();
  // Возвращаем SDP-answer клиенту
  return new NextResponse(answer, {
    status: 200,
    headers: { "Content-Type": "application/sdp" },
  });
}
