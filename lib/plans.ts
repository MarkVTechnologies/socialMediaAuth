import type { PlanId } from "./types";

export interface Plan {
  id: PlanId;
  name: string;
  priceNgn: number; // monthly, in Naira
  yearlyPriceNgn: number; // ~2 months free
  accounts: number;
  postsPerMonth: number; // Infinity = unlimited
  aiPerMonth: number;
  storageGb: number;
  workspaces: number;
  approvals: boolean;
  analytics: boolean;
  pdfReports: boolean;
  bestFor: string;
}

export const PLANS: Record<PlanId, Plan> = {
  trial: {
    id: "trial",
    name: "Free Trial",
    priceNgn: 0,
    yearlyPriceNgn: 0,
    accounts: 3,
    postsPerMonth: 20,
    aiPerMonth: 20,
    storageGb: 1,
    workspaces: 1,
    approvals: false,
    analytics: false,
    pdfReports: false,
    bestFor: "Testing the product (14 days)",
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceNgn: 15_000,
    yearlyPriceNgn: 150_000,
    accounts: 5,
    postsPerMonth: 60,
    aiPerMonth: 100,
    storageGb: 5,
    workspaces: 1,
    approvals: false,
    analytics: false,
    pdfReports: false,
    bestFor: "Small businesses, creators, churches",
  },
  growth: {
    id: "growth",
    name: "Growth",
    priceNgn: 35_000,
    yearlyPriceNgn: 350_000,
    accounts: 12,
    postsPerMonth: Infinity,
    aiPerMonth: 400,
    storageGb: 25,
    workspaces: 1,
    approvals: true,
    analytics: true,
    pdfReports: false,
    bestFor: "Growing brands, real estate firms",
  },
  agency: {
    id: "agency",
    name: "Agency",
    priceNgn: 90_000,
    yearlyPriceNgn: 900_000,
    accounts: 50,
    postsPerMonth: Infinity,
    aiPerMonth: 1500,
    storageGb: 100,
    workspaces: 10,
    approvals: true,
    analytics: true,
    pdfReports: true,
    bestFor: "Agencies and freelance managers",
  },
};

export const TRIAL_DAYS = 14;

export function formatNaira(amount: number) {
  return "₦" + amount.toLocaleString("en-NG");
}
