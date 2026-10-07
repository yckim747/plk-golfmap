import type { Ref } from 'react';
import { Mic, Search, X } from 'lucide-react';
export default function GolfCourseSearch({ value, onChange, onSubmit, inputRef, voice }: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  voice?: { supported: boolean; listening: boolean; start: () => void; stop: () => void };
}) {
  return <div className={`search-box${voice?.listening ? ' listening' : ''}`}>
    <Search size={18}/>
    <input ref={inputRef} type="search" enterKeyHint="search" aria-label="골프장명 또는 지역 검색" placeholder={voice?.listening ? '듣고 있어요… 예) 강원도 제휴 골프장' : '골프장명, 지역으로 검색'} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { onSubmit(event.currentTarget.value); event.currentTarget.blur(); } }}/>
    {value && !voice?.listening && <button aria-label="검색어 지우기" onClick={() => onChange('')}><X size={16}/></button>}
    {voice?.supported ? <button className="mic-button" aria-label={voice.listening ? '음성 검색 멈추기' : '음성으로 검색'} aria-pressed={voice.listening} onClick={voice.listening ? voice.stop : voice.start}><Mic size={17}/></button> : !value && <kbd className="kbd" aria-hidden="true">/</kbd>}
  </div>;
}
