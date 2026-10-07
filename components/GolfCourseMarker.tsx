// SVG marker images work with Kakao MarkerClusterer; green also carries a P label.
export function markerImageUrl(partner: boolean) {
  const fill = partner ? '#176349' : '#ffffff';
  const ink = partner ? '#ffffff' : '#53645c';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="50" viewBox="0 0 42 50"><path d="M21 48L13 37A19 19 0 1 1 29 37Z" fill="${fill}" stroke="#53645c" stroke-width="1.5"/><text x="21" y="27" text-anchor="middle" font-family="Arial" font-size="18" font-weight="bold" fill="${ink}">${partner ? 'P' : '•'}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
