export default function GolfCourseFilter({ partnerOnly, onChange, total, partners }: { partnerOnly: boolean; onChange: (value: boolean) => void; total: number; partners: number }) {
  return <div className="filter-row"><button aria-pressed={!partnerOnly} className={!partnerOnly ? 'active' : ''} onClick={() => onChange(false)}>전체 <span>{total}</span></button><button aria-pressed={partnerOnly} className={partnerOnly ? 'active' : ''} onClick={() => onChange(true)}>✦ PLK 제휴 <span>{partners}</span></button></div>;
}
