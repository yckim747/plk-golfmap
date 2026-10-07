import { Search, X } from 'lucide-react';
export default function GolfCourseSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className="search-box"><Search size={20}/><input aria-label="골프장명 또는 지역 검색" placeholder="어떤 골프장을 찾으세요?" value={value} onChange={(event) => onChange(event.target.value)}/>{value && <button aria-label="검색어 지우기" onClick={() => onChange('')}><X size={18}/></button>}</div>;
}
