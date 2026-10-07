export interface GolfCourse {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  holes: number | null;
  phone: string;
  homepage: string;
  plkPartner: boolean;
  partnerNote?: string;
  kakaoPlaceUrl?: string;
}
