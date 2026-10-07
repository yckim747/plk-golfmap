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
  partnerType?: '제휴' | '이용협약';
  status?: '협의중';
  partnerNote?: string;
  kakaoPlaceUrl?: string;
}
