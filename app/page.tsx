// app/page.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { santaSystemPrompt } from "@/lib/santaPrompt";

type LogLine = { t: number; text: string };

export default function Home() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const [started, setStarted] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [voice, setVoice] = useState("ash");
  const [model, setModel] = useState("gpt-realtime-mini");
  const [micDeviceId, setMicDeviceId] = useState<string | undefined>(undefined);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [isTalking, setIsTalking] = useState(false);

  function log(text: string) {
    setLogs((prev) => [...prev, { t: Date.now(), text }]);
  }

  useEffect(() => {
    // Получаем список микрофонов
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      setMics(devices.filter((d) => d.kind === "audioinput"));
    });
  }, []);

  async function startCall() {
    if (started) return;

    log("Инициализация WebRTC…");

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
    });
    pcRef.current = pc;

    // DataChannel (на случай динамических команд/настроек)
    const dc = pc.createDataChannel("santa-data");
    dcRef.current = dc;
    dc.onopen = () => {
      // 1) системные инструкции (промпт)
      dc.send(JSON.stringify({
        type: "session.update",
        session: {
          instructions: santaSystemPrompt,     // <-- русский промпт
          voice,                               // "alloy" и т.п.
          modalities: ["audio","text"],
          turn_detection: { type: "server_vad" }
          // ВАЖНО: НЕ передаём здесь model
        }
      }));

      // 2) хотим, чтобы Дед Мороз сам поздоровался сразу:
      dc.send(JSON.stringify({
        type: "response.create",
        response: {
          conversation: "auto",
          modalities: ["audio","text"],
          instructions: "Скажи короткое приветствие 10–15 секунд и спроси имя ребёнка.",
        }
      }));
    };
    dc.onmessage = (e) => log(`DC: ${e.data}`);

    // Воспроизведение удалённого аудио (голос Деда Мороза)
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (audioRef.current) {
        audioRef.current.srcObject = stream;
        audioRef.current.play().catch(() => {});
      }
    };

    // Микрофон
    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: micDeviceId ? { exact: micDeviceId } : undefined,
        channelCount: 1,
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
      },
    };
    const mic = await navigator.mediaDevices.getUserMedia(constraints);
    mic.getTracks().forEach((t) => pc.addTrack(t, mic));

    // Детектор речи (простой): меняем флаг isTalking
    setupSimpleVAD(mic, (talking) => {
      setIsTalking(talking);
      // При желании можно «мягко заглушать» удалённое аудио,
      // когда пользователь заговорил, чтобы усилить эффект бардж-ина:
      const audio = audioRef.current;
      if (audio) audio.volume = talking ? 0.3 : 1.0;
    });

    // Получаем удалённые кандидаты ICE
    pc.onicecandidate = () => {
      // В режиме HTTP-SDP обмена обычно кандидаты встраиваются в SDP,
      // так что отдельная пересылка не требуется — оставим пустым.
    };

    // Создаём оффер
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });
    await pc.setLocalDescription(offer);

    // Отправляем оффер на свой сервер — он обменяется с OpenAI и вернёт answer
    const resp = await fetch("/api/sdp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sdp: offer.sdp,
        voice,
        model,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      log(`Ошибка SDP: ${err?.error || resp.statusText}`);
      return;
    }

    const answerSdp = await resp.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    setStarted(true);
    log("Готово! Говори с Дедом Морозом 🎅");
  }

  function hangup() {
    dcRef.current?.close();
    pcRef.current?.getSenders().forEach((s) => s.track?.stop());
    pcRef.current?.close();
    pcRef.current = null;
    setStarted(false);
    log("Звонок завершён.");
  }

  return (
    <main className="min-h-screen p-6 mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold mb-4">Дед Мороз — голосовой звонок (MVP)</h1>

      <div className="space-y-3 mb-6">
        <div>
          <label className="block text-sm font-medium mb-1">Микрофон</label>
          <select
            className="border rounded p-2 w-full"
            value={micDeviceId || ""}
            onChange={(e) => setMicDeviceId(e.target.value || undefined)}
            disabled={started}
          >
            <option value="">По умолчанию</option>
            {mics.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Голос</label>
            <select
              className="border rounded p-2 w-full"
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              disabled={started}
            >
              <option value="ash">Ash</option>
              <option value="verse">Verse</option>
              <option value="cove">Cove</option>
              {/* Добавь варианты голосов, доступных в твоём аккаунте */}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Модель</label>
            <input
              className="border rounded p-2 w-full"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={started}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!started ? (
            <button
              onClick={startCall}
              className="px-4 py-2 rounded bg-blue-600 text-white"
            >
              Позвонить Деду Морозу
            </button>
          ) : (
            <button
              onClick={hangup}
              className="px-4 py-2 rounded bg-gray-700 text-white"
            >
              Завершить
            </button>
          )}
          <div className={`text-sm px-2 py-1 rounded ${isTalking ? "bg-green-200" : "bg-gray-200"}`}>
            {isTalking ? "Вы говорите…" : "Микрофон ждёт"}
          </div>
        </div>
      </div>

      <audio ref={audioRef} autoPlay playsInline />

      <div className="mt-6">
        <h2 className="font-semibold mb-2">Лог</h2>
        <div className="h-56 overflow-auto border rounded p-2 text-sm bg-white">
          {logs.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap">{new Date(l.t).toLocaleTimeString()} — {l.text}</div>
          ))}
        </div>
      </div>
    </main>
  );
}

/**
 * Простейший VAD на основе уровня RMS — только для индикации/UX.
 * Для точного бардж-ина опираемся на серверную VAD Realtime.
 */
function setupSimpleVAD(stream: MediaStream, onState: (talking: boolean) => void) {
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);

  let talking = false;
  function tick() {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    const nowTalking = rms > 0.03; // простейший порог
    if (nowTalking !== talking) {
      talking = nowTalking;
      onState(talking);
    }
    requestAnimationFrame(tick);
  }
  tick();
}
