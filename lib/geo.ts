export interface LatLng { lat: number; lng: number }
export interface MyLocation extends LatLng { accuracy: number; at: number }

// 두 좌표 사이 거리(km, 하버사인)
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// 850m / 3.4km / 27km
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.max(10, Math.round(km * 100) * 10)}m`;
  return km < 10 ? `${km.toFixed(1)}km` : `${Math.round(km)}km`;
}

export function isInKorea({ lat, lng }: LatLng): boolean {
  return lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;
}
