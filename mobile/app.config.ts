import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Home Inventory",
  slug: "home-inventory-mobile",
  version: "0.1.0",
  orientation: "portrait",
  platforms: ["ios", "android"],
  extra: {
    apiBaseUrl: process.env.MOBILE_API_BASE_URL ?? "http://127.0.0.1:4000",
    environment: process.env.MOBILE_ENVIRONMENT ?? "development",
    requireUserAccounts: process.env.MOBILE_REQUIRE_USER_ACCOUNTS === "true",
  },
});
