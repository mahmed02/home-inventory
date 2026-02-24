import Constants from "expo-constants";

type RuntimeExtra = {
  apiBaseUrl?: string;
  environment?: string;
  requireUserAccounts?: boolean;
};

const extra = (Constants.expoConfig?.extra ?? {}) as RuntimeExtra;

export const mobileEnv = {
  apiBaseUrl: extra.apiBaseUrl ?? "http://127.0.0.1:4000",
  environment: extra.environment ?? "development",
  requireUserAccounts: extra.requireUserAccounts ?? true,
} as const;
