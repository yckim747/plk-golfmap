'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// 브라우저 내장 음성 인식(Web Speech API). Chrome·삼성 인터넷·Safari(iOS 14.5+)·Edge 지원, Firefox·앱 WebView는 미지원.
// 표준 타입이 아직 TypeScript DOM 라이브러리에 없어 필요한 부분만 선언한다.
interface SpeechResultEvent { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }
interface SpeechRecognizer {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecognizerConstructor = new () => SpeechRecognizer;
const getRecognizer = (): RecognizerConstructor | undefined => {
  const scope = window as unknown as { SpeechRecognition?: RecognizerConstructor; webkitSpeechRecognition?: RecognizerConstructor };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
};

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': '마이크 권한이 꺼져 있어요. 브라우저 설정에서 마이크 접근을 허용해 주세요.',
  'service-not-allowed': '이 브라우저에서는 음성 검색을 사용할 수 없어요.',
  'no-speech': '말씀을 듣지 못했어요. 다시 눌러 말씀해 주세요.',
  'audio-capture': '마이크를 찾을 수 없어요.',
  network: '음성 인식 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
};

export function useSpeechSearch({ onInterim, onFinal, onError }: { onInterim: (text: string) => void; onFinal: (text: string) => void; onError: (message: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognizer = useRef<SpeechRecognizer | null>(null);
  const handlers = useRef({ onInterim, onFinal, onError });
  handlers.current = { onInterim, onFinal, onError };
  // 서버 렌더링 결과와 맞추기 위해 지원 여부는 마운트 후에 확인한다.
  useEffect(() => { setSupported(!!getRecognizer()); return () => recognizer.current?.abort(); }, []);

  const start = useCallback(() => {
    const Recognizer = getRecognizer();
    if (!Recognizer) { handlers.current.onError('이 브라우저에서는 음성 검색을 지원하지 않아요.'); return; }
    recognizer.current?.abort();
    const instance = new Recognizer();
    instance.lang = 'ko-KR';
    instance.interimResults = true;
    instance.continuous = false;
    instance.maxAlternatives = 1;
    let finalText = '';
    instance.onresult = (event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal) finalText += result[0].transcript; else interim += result[0].transcript;
      }
      handlers.current.onInterim((finalText + interim).trim());
    };
    instance.onerror = (event) => { if (event.error !== 'aborted') handlers.current.onError(ERROR_MESSAGES[event.error] ?? '음성을 인식하지 못했어요. 다시 시도해 주세요.'); };
    instance.onend = () => { setListening(false); if (finalText.trim()) handlers.current.onFinal(finalText.trim()); };
    recognizer.current = instance;
    setListening(true);
    instance.start();
  }, []);
  const stop = useCallback(() => recognizer.current?.stop(), []);
  return { supported, listening, start, stop };
}
