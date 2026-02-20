export type Nullable<T> = T | null;

export type LocationRow = {
  id: string;
  name: string;
  code: string | null;
  type: string | null;
  parent_id: string | null;
  description: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
};

export type ItemRow = {
  id: string;
  name: string;
  brand: string | null;
  description: string | null;
  keywords: string[];
  location_id: string;
  low_churn: boolean;
  image_url: string | null;
  created_at: string;
  updated_at: string;
};
