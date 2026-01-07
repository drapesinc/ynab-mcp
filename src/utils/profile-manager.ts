/**
 * Profile Manager - handles YNAB API clients for multiple profiles
 */

import * as ynab from "ynab";
import { getProfile, getConfig, Profile, listProfiles } from "../config.js";

// Cache of YNAB API clients per profile
const apiClients: Map<string, ynab.API> = new Map();

/**
 * Get or create a YNAB API client for the specified profile
 */
export function getApiClient(profileName?: string): ynab.API {
  const profile = getProfile(profileName);
  const cacheKey = profile.name;

  if (!apiClients.has(cacheKey)) {
    apiClients.set(cacheKey, new ynab.API(profile.token));
  }

  return apiClients.get(cacheKey)!;
}

/**
 * Resolve budget alias to budget ID for a profile
 */
export function resolveBudgetId(budgetRef?: string, profileName?: string): string {
  const profile = getProfile(profileName);
  const config = getConfig();

  // If no budget specified, use default
  if (!budgetRef) {
    const defaultAlias = profile.defaultBudget || config.defaultBudget;
    if (!defaultAlias) {
      throw new Error(`No budget specified and no default budget configured for profile '${profile.name}'`);
    }
    budgetRef = defaultAlias;
  }

  // Check if it's an alias
  const normalizedRef = budgetRef.toLowerCase();
  const budgetAlias = profile.budgets.find(b => b.alias === normalizedRef);
  if (budgetAlias) {
    return budgetAlias.id;
  }

  // Check if it looks like a UUID (budget ID directly)
  if (budgetRef.includes('-') && budgetRef.length > 30) {
    return budgetRef;
  }

  // Special YNAB shortcuts
  if (budgetRef === 'last-used' || budgetRef === 'default') {
    return budgetRef;
  }

  throw new Error(`Budget '${budgetRef}' not found for profile '${profile.name}'. Available: ${profile.budgets.map(b => b.alias).join(', ')}`);
}

/**
 * Get the default account for a budget
 */
export function getDefaultAccount(budgetAlias?: string, profileName?: string): string | undefined {
  const profile = getProfile(profileName);
  const normalizedAlias = budgetAlias?.toLowerCase() || '';
  return profile.defaultAccounts[normalizedAlias];
}

/**
 * Get profile summary information
 */
export function getProfileInfo(profileName?: string): {
  name: string;
  budgets: Array<{ alias: string; id: string }>;
  defaultBudget: string | undefined;
  defaultAccounts: Record<string, string>;
} {
  const profile = getProfile(profileName);
  return {
    name: profile.name,
    budgets: profile.budgets,
    defaultBudget: profile.defaultBudget,
    defaultAccounts: profile.defaultAccounts,
  };
}

/**
 * List all configured profiles with summary info
 */
export function getAllProfiles(): Array<{
  name: string;
  isDefault: boolean;
  budgetCount: number;
  budgets: string[];
}> {
  const config = getConfig();
  return listProfiles().map(name => {
    const profile = config.profiles[name];
    return {
      name,
      isDefault: name === config.defaultProfile,
      budgetCount: profile.budgets.length,
      budgets: profile.budgets.map(b => b.alias),
    };
  });
}
