// app/page.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { santaSystemPrompt } from "@/lib/santaPrompt";

type LogLine = { t: number; text: string };

export default function Home() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioTxRef = useRef<RTCRtpTransceiver | null>(null);

  const [started, setStarted] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [voice, setVoice] = useState("ash");
  const [model, setModel] = useState("gpt-realtime");
  const [micDeviceId, setMicDeviceId] = useState<string | undefined>(undefined);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [isTalking, setIsTalking] = useState(false);

  function log(text: string) {
    setLogs((prev) => [...prev, { t: Date.now(), text }]);
  }

  useEffect(() => {
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

    // Диагностика соединения
    pc.addEventListener("iceconnectionstatechange", () => log("ICE state: " + pc.iceConnectionState));
    pc.addEventListener("connectionstatechange", () => log("PC state: " + pc.connectionState));

    // На всякий случай снимаем mute и выставляем громкость
    if (audioRef.current) {
      audioRef.current.muted = false;
      audioRef.current.volume = 1.0;
    }

    // Рендер удалённого аудио: привязываем именно track
    pc.ontrack = (event) => {
      const track = event.track;
      log(`remote track: kind=${track.kind} id=${track.id} streams=${event.streams.map(s => s.id).join(",")}`);
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
      // (1) Инструкции ДО подключения микрофона, автогенерация выключена
      dc.send(JSON.stringify({
        type: "session.update",
        session: {
          instructions: santaSystemPrompt,
          voice,
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

      // (3) Включаем автоответы
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
    // Аудио-трансивер: sendrecv (позже подставим реальный трек)
    audioTxRef.current = pc.addTransceiver("audio", { direction: "sendrecv" });

    // Видео-трансивер: recvonly (требуется Realtime)
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
        voice,
        model, // сервер может игнорировать и подставлять фиксированный id
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
    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: micDeviceId ? { exact: micDeviceId } : undefined,
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
      if (audio) audio.volume = talking ? 0.6 : 1.0; // помягче приглушаем
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
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || d.deviceId}
                  </option>
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
                <option value="alloy">Alloy</option>
                <option value="ash">Ash</option>
                <option value="verse">Verse</option>
                <option value="cove">Cove</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Модель (опционально)</label>
              <input
                  className="border rounded p-2 w-full"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={started}
              />
              <p className="text-xs text-gray-500 mt-1">
                На сервере можно зафиксировать стабильный id, например: <code>gpt-4o-realtime-preview-2025-06-03</code>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!started ? (
                <button onClick={startCall} className="px-4 py-2 rounded bg-blue-600 text-white">
                  Позвонить Деду Морозу
                </button>
            ) : (
                <button onClick={hangup} className="px-4 py-2 rounded bg-gray-700 text-white">
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
                <div key={i} className="whitespace-pre-wrap">
                  {new Date(l.t).toLocaleTimeString()} — {l.text}
                </div>
            ))}
          </div>
        </div>
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
    const nowTalking = rms > 0.03; // простой порог
    if (nowTalking !== talking) {
      talking = nowTalking;
      onState(talking);
    }
    requestAnimationFrame(tick);
  }
  tick();
}
