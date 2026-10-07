import { REGIONS, type Region } from '@/lib/region';
export type PartnerFilter = 'all' | '제휴' | '이용협약' | '협의중';
const KINDS: { value: PartnerFilter; label: string; dot?: string }[] = [
  { value: 'all', label: '전체' },
  { value: '제휴', label: '제휴', dot: 'partner' },
  { value: '이용협약', label: '이용협약', dot: 'agreement' },
  { value: '협의중', label: '협의중', dot: 'pending' },
];
export default function GolfCourseFilter({ kind, onKind, counts, region, onRegion }: { kind: PartnerFilter; onKind: (value: PartnerFilter) => void; counts: Record<PartnerFilter, number> | null; region: Region | 'all'; onRegion: (value: Region | 'all') => void }) {
  return <>
    <div className="segmented" role="group" aria-label="제휴 구분">{KINDS.map(({ value, label, dot }) => <button key={value} aria-pressed={kind === value} className={kind === value ? 'active' : ''} onClick={() => onKind(value)}>{dot && <i className={`dot ${dot}`}/>}{label}{counts && <span className="count">{counts[value]}</span>}</button>)}</div>
    <div className="chips" role="group" aria-label="권역">{(['all', ...REGIONS] as const).map((value) => <button key={value} aria-pressed={region === value} className={`chip${region === value ? ' active' : ''}`} onClick={() => onRegion(value)}>{value === 'all' ? '전국' : value}</button>)}</div>
  </>;
}
