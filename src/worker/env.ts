export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;
}

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
}

export type AppContext = {
  Bindings: Env;
  Variables: {
    user: AuthUser;
  };
};
