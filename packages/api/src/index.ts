import { createTRPCRouter } from "./trpc";
import { authRouter } from "./routers/auth";
import { raffleRouter } from "./routers/raffle";
import { contactRouter } from "./routers/contact";
import { saleRouter } from "./routers/sale";
import { campaignRouter } from "./routers/campaign";
import { vendorRouter } from "./routers/vendor";
import { analyticsRouter } from "./routers/analytics";
import { settingsRouter } from "./routers/settings";
import { subscriptionRouter } from "./routers/subscription";
import { automationRouter } from "./routers/automation";
import { templateRouter } from "./routers/template";
import { publicRouter } from "./routers/public";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  public: publicRouter,
  raffle: raffleRouter,
  contact: contactRouter,
  sale: saleRouter,
  campaign: campaignRouter,
  vendor: vendorRouter,
  analytics: analyticsRouter,
  settings: settingsRouter,
  subscription: subscriptionRouter,
  automation: automationRouter,
  template: templateRouter,
});

export type AppRouter = typeof appRouter;
