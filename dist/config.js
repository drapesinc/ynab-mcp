/**
 * Configuration system for multi-profile YNAB MCP
 *
 * Environment Variables:
 * - YNAB_PROFILES: Comma-separated list of profile names (e.g., "personal,ammish")
 * - YNAB_TOKEN_{PROFILE}: API token for each profile (e.g., YNAB_TOKEN_PERSONAL)
 * - YNAB_BUDGETS_{PROFILE}: Budget aliases for profile (e.g., "cad:uuid,usd:uuid")
 * - YNAB_DEFAULT_PROFILE: Default profile to use
 * - YNAB_DEFAULT_BUDGET: Default budget alias
 * - YNAB_DEFAULT_ACCOUNT_{BUDGET}: Default account per budget (e.g., YNAB_DEFAULT_ACCOUNT_CAD)
 */
/**
 * Parse budget aliases from environment variable
 * Format: "alias1:uuid1,alias2:uuid2"
 */
function parseBudgetAliases(envValue) {
    if (!envValue)
        return [];
    return envValue.split(',').map(pair => {
        const [alias, id] = pair.trim().split(':');
        return { alias: alias.trim().toLowerCase(), id: id.trim() };
    }).filter(b => b.alias && b.id);
}
/**
 * Parse default accounts from environment variables
 * Looks for YNAB_DEFAULT_ACCOUNT_{BUDGET} pattern
 */
function parseDefaultAccounts() {
    const accounts = {};
    const prefix = 'YNAB_DEFAULT_ACCOUNT_';
    for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith(prefix) && value) {
            const budgetAlias = key.substring(prefix.length).toLowerCase();
            accounts[budgetAlias] = value;
        }
    }
    return accounts;
}
/**
 * Load configuration from environment variables
 */
export function loadConfig() {
    const profileNames = process.env.YNAB_PROFILES?.split(',').map(p => p.trim().toLowerCase()) || [];
    const defaultAccounts = parseDefaultAccounts();
    // If no profiles defined, create a "default" profile from legacy env vars
    if (profileNames.length === 0) {
        const token = process.env.YNAB_API_TOKEN;
        if (!token) {
            throw new Error('No YNAB_PROFILES or YNAB_API_TOKEN configured');
        }
        // Parse legacy YNAB_BUDGET_ALIASES or create single budget from YNAB_BUDGET_ID
        let budgets = parseBudgetAliases(process.env.YNAB_BUDGET_ALIASES);
        if (budgets.length === 0 && process.env.YNAB_BUDGET_ID) {
            budgets = [{ alias: 'default', id: process.env.YNAB_BUDGET_ID }];
        }
        return {
            profiles: {
                default: {
                    name: 'default',
                    token,
                    budgets,
                    defaultBudget: budgets[0]?.alias,
                    defaultAccounts,
                }
            },
            defaultProfile: 'default',
            defaultBudget: budgets[0]?.alias || '',
        };
    }
    // Build profiles from environment
    const profiles = {};
    for (const profileName of profileNames) {
        const upperName = profileName.toUpperCase();
        const token = process.env[`YNAB_TOKEN_${upperName}`];
        if (!token) {
            console.error(`Warning: No token found for profile ${profileName} (YNAB_TOKEN_${upperName})`);
            continue;
        }
        const budgets = parseBudgetAliases(process.env[`YNAB_BUDGETS_${upperName}`]);
        profiles[profileName] = {
            name: profileName,
            token,
            budgets,
            defaultBudget: budgets[0]?.alias,
            defaultAccounts,
        };
    }
    if (Object.keys(profiles).length === 0) {
        throw new Error('No valid profiles configured');
    }
    const defaultProfile = process.env.YNAB_DEFAULT_PROFILE?.toLowerCase() || profileNames[0];
    const defaultBudget = process.env.YNAB_DEFAULT_BUDGET?.toLowerCase() ||
        profiles[defaultProfile]?.defaultBudget || '';
    return {
        profiles,
        defaultProfile,
        defaultBudget,
    };
}
// Singleton config instance
let configInstance = null;
export function getConfig() {
    if (!configInstance) {
        configInstance = loadConfig();
    }
    return configInstance;
}
/**
 * Get a specific profile by name
 */
export function getProfile(profileName) {
    const config = getConfig();
    const name = profileName?.toLowerCase() || config.defaultProfile;
    const profile = config.profiles[name];
    if (!profile) {
        throw new Error(`Profile '${name}' not found. Available: ${Object.keys(config.profiles).join(', ')}`);
    }
    return profile;
}
/**
 * List all available profiles
 */
export function listProfiles() {
    return Object.keys(getConfig().profiles);
}
