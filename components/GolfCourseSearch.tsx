import type { Ref } from 'react';
import { Search, X } from 'lucide-react';
export default function GolfCourseSearch({ value, onChange, inputRef }: { value: string; onChange: (value: string) => void; inputRef?: Ref<HTMLInputElement> }) {
  return <div className="search-box"><Search size={18}/><input ref={inputRef} type="search" enterKeyHint="search" aria-label="골프장명 또는 지역 검색" placeholder="골프장명, 지역으로 검색" value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}/>{value ? <button aria-label="검색어 지우기" onClick={() => onChange('')}><X size={16}/></button> : <kbd className="kbd" aria-hidden="true">/</kbd>}</div>;
}
