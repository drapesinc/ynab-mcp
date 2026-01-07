/**
 * Resolver - resolves account/category/payee names to IDs
 * Uses caching to minimize API calls
 */
import { getApiClient, resolveBudgetId } from "./profile-manager.js";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const accountCache = new Map();
const categoryCache = new Map();
const payeeCache = new Map();
function getCacheKey(profile, budgetId) {
    return `${profile}:${budgetId}`;
}
function normalizeForSearch(name) {
    return name.toLowerCase().trim();
}
/**
 * Resolve account name to account ID
 * Accepts either account name (fuzzy match) or account ID (passthrough)
 */
export async function resolveAccountId(accountRef, budgetRef, profileName) {
    // If it looks like a UUID, return as-is
    if (accountRef.includes('-') && accountRef.length > 30) {
        return accountRef;
    }
    const api = getApiClient(profileName);
    const budgetId = resolveBudgetId(budgetRef, profileName);
    const cacheKey = getCacheKey(profileName || 'default', budgetId);
    // Check cache
    let cache = accountCache.get(cacheKey);
    const now = Date.now();
    if (!cache || (cache.size > 0 && now - Array.from(cache.values())[0].timestamp > CACHE_TTL)) {
        // Refresh cache
        const response = await api.accounts.getAccounts(budgetId);
        cache = new Map();
        for (const account of response.data.accounts) {
            if (!account.deleted) {
                cache.set(normalizeForSearch(account.name), {
                    id: account.id,
                    name: account.name,
                    timestamp: now,
                });
            }
        }
        accountCache.set(cacheKey, cache);
    }
    // Search for account
    const normalized = normalizeForSearch(accountRef);
    const exact = cache.get(normalized);
    if (exact) {
        return exact.id;
    }
    // Fuzzy search - check if account name contains the search term
    for (const [name, entry] of cache.entries()) {
        if (name.includes(normalized) || normalized.includes(name)) {
            return entry.id;
        }
    }
    throw new Error(`Account '${accountRef}' not found. Available: ${Array.from(cache.values()).map(e => e.name).join(', ')}`);
}
/**
 * Resolve category name to category ID
 * Accepts "Group: Category" format or just "Category"
 */
export async function resolveCategoryId(categoryRef, budgetRef, profileName) {
    // If it looks like a UUID, return as-is
    if (categoryRef.includes('-') && categoryRef.length > 30) {
        return categoryRef;
    }
    const api = getApiClient(profileName);
    const budgetId = resolveBudgetId(budgetRef, profileName);
    const cacheKey = getCacheKey(profileName || 'default', budgetId);
    // Check cache
    let cache = categoryCache.get(cacheKey);
    const now = Date.now();
    if (!cache || (cache.size > 0 && now - Array.from(cache.values())[0].timestamp > CACHE_TTL)) {
        // Refresh cache
        const response = await api.categories.getCategories(budgetId);
        cache = new Map();
        for (const group of response.data.category_groups) {
            for (const category of group.categories) {
                if (!category.deleted && !category.hidden) {
                    // Store with group prefix and without
                    const fullName = `${group.name}: ${category.name}`;
                    cache.set(normalizeForSearch(fullName), {
                        id: category.id,
                        name: fullName,
                        timestamp: now,
                    });
                    cache.set(normalizeForSearch(category.name), {
                        id: category.id,
                        name: category.name,
                        timestamp: now,
                    });
                }
            }
        }
        categoryCache.set(cacheKey, cache);
    }
    // Search for category
    const normalized = normalizeForSearch(categoryRef);
    const exact = cache.get(normalized);
    if (exact) {
        return exact.id;
    }
    // Fuzzy search
    for (const [name, entry] of cache.entries()) {
        if (name.includes(normalized) || normalized.includes(name)) {
            return entry.id;
        }
    }
    throw new Error(`Category '${categoryRef}' not found`);
}
/**
 * Resolve payee name to payee ID
 */
export async function resolvePayeeId(payeeRef, budgetRef, profileName) {
    // If it looks like a UUID, return as-is
    if (payeeRef.includes('-') && payeeRef.length > 30) {
        return payeeRef;
    }
    const api = getApiClient(profileName);
    const budgetId = resolveBudgetId(budgetRef, profileName);
    const cacheKey = getCacheKey(profileName || 'default', budgetId);
    // Check cache
    let cache = payeeCache.get(cacheKey);
    const now = Date.now();
    if (!cache || (cache.size > 0 && now - Array.from(cache.values())[0].timestamp > CACHE_TTL)) {
        // Refresh cache
        const response = await api.payees.getPayees(budgetId);
        cache = new Map();
        for (const payee of response.data.payees) {
            if (!payee.deleted) {
                cache.set(normalizeForSearch(payee.name), {
                    id: payee.id,
                    name: payee.name,
                    timestamp: now,
                });
            }
        }
        payeeCache.set(cacheKey, cache);
    }
    // Search for payee
    const normalized = normalizeForSearch(payeeRef);
    const exact = cache.get(normalized);
    if (exact) {
        return exact.id;
    }
    // For payees, return undefined if not found - YNAB will create new payee
    return payeeRef;
}
/**
 * Get account name from ID
 */
export async function getAccountName(accountId, budgetRef, profileName) {
    const api = getApiClient(profileName);
    const budgetId = resolveBudgetId(budgetRef, profileName);
    try {
        const response = await api.accounts.getAccountById(budgetId, accountId);
        return response.data.account.name;
    }
    catch {
        return accountId;
    }
}
/**
 * Clear all caches (useful for testing or when data changes)
 */
export function clearCaches() {
    accountCache.clear();
    categoryCache.clear();
    payeeCache.clear();
}
