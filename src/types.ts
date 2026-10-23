export interface Vehicle {
  id: string;
  name: string;
  brand: string;
  temperature: '常温' | '冷藏';
  bodyType: '面包' | '平板' | '厢货' | '高栏';
  bodyTypes?: string[];
  published: boolean;
  availability: '待确认' | '有现车' | '需预订';
  description: string;
  highlights: string[];
  specs: { label: string; value: string }[];
  images: string[];
  sourceFiles: string[];
  battery?: string;
  range?: string;
  cargoVolume?: string;
  payload?: string;
  dimensions?: string;
}
export interface Settings {
  siteName: string;
  logoUrl: string;
  tagline: string;
  phone: string;
  wechat: string;
  address: string;
}
