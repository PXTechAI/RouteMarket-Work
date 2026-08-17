export type AccountLinkTarget = "account_center" | "plan_upgrade" | "credits_top_up" | "credits_usage";

const ACCOUNT_LINK_PATHS: Partial<Record<AccountLinkTarget, string>> = {
  account_center: "/workspace/chat",
  credits_top_up: "/workspace/credits",
  credits_usage: "/workspace/usage"
};

const ACCOUNT_LINK_INTENTS: Partial<Record<AccountLinkTarget, string>> = {
  plan_upgrade: "upgrade",
  credits_top_up: "top-up-credits"
};

export function routeMarketAccountUrl(webBaseUrl: string, target: AccountLinkTarget): string {
  const url = new URL(ACCOUNT_LINK_PATHS[target] ?? "/settings", webBaseUrl);
  url.searchParams.set("utm_source", "routemarket_work_desktop");
  url.searchParams.set("utm_medium", "desktop_app");
  url.searchParams.set("utm_campaign", "account_menu");
  url.searchParams.set("utm_content", target);

  const intent = ACCOUNT_LINK_INTENTS[target];
  if (intent) url.searchParams.set("intent", intent);
  if (target === "account_center") url.searchParams.set("account_settings", "profile");
  return url.toString();
}
