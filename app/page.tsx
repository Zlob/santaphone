// app/page.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { santaSystemPrompt } from "@/lib/santaPrompt";

type LogLine = { t: number; text: string };

// дефолтные настройки
const DEFAULT_MODEL = "gpt-realtime";
const DEFAULT_VOICE = "ash";

export default function Home() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioTxRef = useRef<RTCRtpTransceiver | null>(null);

  const [started, setStarted] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [isTalking, setIsTalking] = useState(false);

  function log(text: string) {
    setLogs((prev) => [...prev, { t: Date.now(), text }]);
  }

  async function startCall() {
    if (started) return;

    log("Инициализация WebRTC…");

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
    });
    pcRef.current = pc;

    // Диагностика соединения
    pc.addEventListener("iceconnectionstatechange", () => log("ICE state: " + pc.iceConnectionState));
    pc.addEventListener("connectionstatechange", () => log("PC state: " + pc.connectionState));

    // На всякий случай снимаем mute и выставляем громкость
    if (audioRef.current) {
      audioRef.current.muted = false;
      audioRef.current.volume = 1.0;
    }

    // Рендер удалённого аудио по входящему треку
    pc.ontrack = (event) => {
      const track = event.track;
      log(`remote track: kind=${track.kind} id=${track.id} streams=${event.streams.map((s) => s.id).join(",")}`);
      if (track.kind === "audio") {
        const ms = new MediaStream();
        ms.addTrack(track);
        if (audioRef.current) {
          audioRef.current.srcObject = ms;
          audioRef.current.muted = false;
          audioRef.current.volume = 1.0;
          audioRef.current.play().catch((e) => log("audio.play() blocked: " + String(e)));
        }
      }
    };

    // DataChannel для команд/логов
    const dc = pc.createDataChannel("santa-data");
    dcRef.current = dc;

    dc.onopen = () => {
      // (1) Инструкции ДО подключения микрофона, сначала без автоответа
      dc.send(JSON.stringify({
        type: "session.update",
        session: {
          instructions: santaSystemPrompt,
          voice: DEFAULT_VOICE,
          modalities: ["audio", "text"],
          turn_detection: { type: "server_vad", create_response: false, interrupt_response: true },
        },
      }));

      // (2) Однократное приветствие
      dc.send(JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["audio", "text"],
          instructions: "Скажи голосом Санта Клауса 'Хо-хо-хо, Я Санта Клаус, а как зовут тебя?'",
        },
      }));

      // (3) Включаем автоответы для последующей речи пользователя
      dc.send(JSON.stringify({
        type: "session.update",
        session: {
          turn_detection: { type: "server_vad", create_response: true, interrupt_response: true },
        },
      }));

      // (4) Подключаем микрофон (replaceTrack)
      attachMic().catch((e) => log("Ошибка микрофона: " + String(e)));
    };

    dc.onmessage = (e) => log(`DC: ${e.data}`);

    // === Медиасекции в SDP ДО createOffer ===
    // Аудио-трансивер: sendrecv (реальный трек подставим позже)
    audioTxRef.current = pc.addTransceiver("audio", { direction: "sendrecv" });
    // Видео-трансивер: recvonly — требуется Realtime
    pc.addTransceiver("video", { direction: "recvonly" });

    // Создаём оффер, ждём ICE
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);

    // Обмен SDP через наш сервер
    const resp = await fetch("/api/sdp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sdp: pc.localDescription?.sdp,
        voice: DEFAULT_VOICE,
        model: DEFAULT_MODEL, // зашили дефолтную модель
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      log(`Ошибка SDP: ${JSON.stringify(err, null, 2)}`);
      return;
    }

    const answerSdp = await resp.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    setStarted(true);
    log("Готово! Говори с Дедом Морозом 🎅");

    // На всякий случай добиваем автоплей
    audioRef.current?.play().catch((e) => log("autoplay retry: " + String(e)));
  }

  async function attachMic() {
    const pc = pcRef.current!;
    // микрофон по умолчанию — без выбора deviceId
    const constraints: MediaStreamConstraints = {
      audio: {
        channelCount: 1,
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
      },
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const [track] = stream.getAudioTracks();

    // Подставляем реальный трек в уже согласованный аудио-трансивер
    await audioTxRef.current?.sender.replaceTrack(track);

    // Простой VAD-индикатор (UX)
    setupSimpleVAD(stream, (talking) => {
      setIsTalking(talking);
      const audio = audioRef.current;
      if (audio) audio.volume = talking ? 0.6 : 1.0; // мягко приглушаем ассистента, когда говорим
    });
  }

  function hangup() {
    dcRef.current?.close();
    pcRef.current?.getSenders().forEach((s) => s.track?.stop());
    pcRef.current?.close();
    pcRef.current = null;
    setStarted(false);
    log("Звонок завершён.");
  }

  // UI helpers
  const statusText = started ? (isTalking ? "Вы говорите…" : "Вызов активен") : "Готов к звонку";
  const statusDot = started ? (isTalking ? "bg-green-500" : "bg-emerald-500") : "bg-gray-400";

  return (
      <main className="min-h-screen bg-gradient-to-b from-sky-50 to-white flex items-center justify-center p-6">
        <div className="w-[360px]">
          {/* "Трубка" */}
          <div className="rounded-[2rem] shadow-xl bg-white border border-gray-100 overflow-hidden">
            {/* Шапка контакта */}
            <div className="p-6 flex flex-col items-center text-center">
              <div className="relative">
                <div className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full ring-2 ring-white ${statusDot}`} />
                <Image
                    src="/santa.png"
                    alt="Santa Claus"
                    width={112}
                    height={112}
                    className="rounded-full object-cover border-4 border-white shadow-md"
                    priority
                />
              </div>

              <div className="mt-4">
                <div className="text-lg font-semibold">Santa Claus</div>
                <div className="text-xs text-gray-500">Северный полюс • Контакты</div>
              </div>

              <div className="mt-4 flex items-center gap-2 text-sm">
                <span className={`inline-block w-2 h-2 rounded-full ${statusDot}`} />
                <span className="text-gray-600">{statusText}</span>
              </div>
            </div>

            {/* Панель действий как в телефоне */}
            <div className="px-6 pb-2">
              <div className="flex items-center justify-center gap-6 py-5">
                {!started ? (
                    <button
                        onClick={startCall}
                        className="h-14 w-14 rounded-full bg-green-500 text-white flex items-center justify-center shadow-md active:scale-95 transition"
                        aria-label="Позвонить"
                        title="Позвонить"
                    >
                      {/* handset icon */}
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 011 1V21a1 1 0 01-1 1C10.85 22 2 13.15 2 2a1 1 0 011-1h3.49a1 1 0 011 1c0 1.24.2 2.45.57 3.57a1 1 0 01-.24 1.02l-2.2 2.2z" />
                      </svg>
                    </button>
                ) : (
                    <button
                        onClick={hangup}
                        className="h-14 w-14 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md active:scale-95 transition"
                        aria-label="Завершить"
                        title="Завершить"
                    >
                      {/* handset down icon */}
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 rotate-135" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M21 16a1 1 0 01-1 1c-1.24 0-2.45-.2-3.57-.57a1 1 0 00-1.02.24l-2.2 2.2a15.05 15.05 0 01-6.59-6.59l2.2-2.2a1 1 0 00.24-1.02A12.58 12.58 0 008 4a1 1 0 00-1-1H4a1 1 0 00-1 1C3 13.15 11.85 22 22 22a1 1 0 001-1v-3.49a1 1 0 00-1-1z" />
                      </svg>
                    </button>
                )}
              </div>

              {/* Индикатор речи */}
              <div className="pb-5 flex items-center justify-center gap-2 text-xs text-gray-500">
                <span className={`inline-flex h-2.5 w-2.5 rounded-full ${isTalking ? "bg-green-500 animate-pulse" : "bg-gray-300"}`} />
                <span>{isTalking ? "Микрофон активен" : "Микрофон ждёт"}</span>
              </div>
            </div>
          </div>

          {/* Вспомогательная кнопка лога */}
          <div className="flex items-center justify-between mt-3">
            <button
                className="text-xs text-gray-500 underline underline-offset-4"
                onClick={() => setShowLogs((s) => !s)}
            >
              {showLogs ? "Скрыть лог" : "Показать лог"}
            </button>
          </div>

          {showLogs && (
              <div className="mt-2 h-48 overflow-auto border rounded-xl p-2 text-xs bg-white/80 shadow-inner">
                {logs.map((l, i) => (
                    <div key={i} className="whitespace-pre-wrap">
                      {new Date(l.t).toLocaleTimeString()} — {l.text}
                    </div>
                ))}
              </div>
          )}
        </div>

        {/* Аудио-элемент */}
        <audio ref={audioRef} autoPlay playsInline />
      </main>
  );
}

/** Дождаться завершения ICE-сборки, чтобы SDP включал кандидаты */
async function waitForIceGatheringComplete(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    function check() {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    }
    pc.addEventListener("icegatheringstatechange", check);
  });
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
    const nowTalking = rms > 0.03;
    if (nowTalking !== talking) {
      talking = nowTalking;
      onState(talking);
    }
    requestAnimationFrame(tick);
  }
  tick();
}
