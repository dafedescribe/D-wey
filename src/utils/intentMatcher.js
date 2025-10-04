/**
 * Intent Matcher - Maps user messages to intents
 * Handles typos, variations, and natural language
 */

class IntentMatcher {
    static intentPatterns = {
        // Balance checking - very flexible
        check_balance: [
            /\b(balance|money|coins?|tums?|cash|wallet|funds?)\b/i,
            /\bhow\s+much\b/i,
            /\bwhat.*have\b/i,
            /\bcheck.*balance\b/i,
            /\bmy.*money\b/i,
            /\bmy.*tums?\b/i,
            /\bhow.*many.*tums?\b/i
        ],

        // Create link - supports typos and variations
        create_link: [
            /^(create|make|new|add|build|generate|setup|set\s*up|creat|mak|generat)\s+\d/i,
            /^(link|lnk|create\s*link|make\s*link|new\s*link)\s+\d/i,
            /^\d{10,15}/i, // Just a phone number
        ],

        // Link info/stats - flexible patterns
        link_info: [
            /^(stats?|statistics|info|information|details?|analytics?|performance|check|view|see)\s+\w{3,}/i,
            /^(stat|stati|analy|perfom|perfor)\s+\w{3,}/i,
            /\bhow.*doing\b/i,
            /\bshow.*stats?\b/i,
            /\blink.*info\b/i,
            /\bcheck.*link\b/i,
            /\bview.*link\b/i
        ],

        // Set temporal redirect
        set_temporal: [
            /^(redirect|redir|temp|temporal|set\s*redirect|set\s*temp)\s+\w+\s+\d/i,
            /^(change|switch|move|route)\s+\w+\s+(to\s+)?\d/i,
            /\btemporary\s+target\b/i,
            /\bset.*temporal\b/i
        ],

        // Kill temporal redirect
        kill_temporal: [
            /^(stop|kill|remove|delete|cancel|end)\s+(redirect|redir|temp|temporal)/i,
            /^(stop|kill|remove|delete|cancel|end)\s+\w{3,}\s*(redirect|redir|temp)?/i,
            /\bkill.*temporal\b/i,
            /\bremove.*redirect\b/i,
            /\bcancel.*redirect\b/i
        ],

        // My links
        my_links: [
            /^(my\s*)?(links?|lnks?|all|list|show)\s*(all|active|mine)?$/i,
            /^(view|see|show|display)\s*(my\s*)?(links?|all)/i,
            /\bmy.*links?\b/i,
            /\ball.*links?\b/i,
            /\bshow.*me\b/i,
            /^links?\s*(active)?$/i
        ],

        // Search links
        search_links: [
            /^(find|search|look|locate|get)\s+\d{10,}/i,
            /^(search|find|look)\s+(for\s+)?(links?\s+)?(to\s+)?\d/i,
            /\bfind.*links?\b.*\d/i,
            /\bsearch.*number\b/i
        ],

        // Best performing links
        best_links: [
            /^(best|top|highest|most|good|great|winning)/i,
            /\btop\s+performer/i,
            /\bbest.*link/i,
            /\bmost.*click/i,
            /\bhighest.*perform/i
        ],

        // Worst performing links
        worst_links: [
            /^(worst|lowest|bottom|bad|poor|weak)/i,
            /\blowest.*perform/i,
            /\bworst.*link/i,
            /\bleast.*click/i,
            /\bpoor.*perform/i
        ],

        // Kill/delete link
        kill_link: [
            /^(delete|remove|kill|del|rm|destroy|deactivate)\s+\w{3,}$/i,
            /^(stop|end|cancel)\s+link\s+\w/i,
            /\bdelete.*link\b/i,
            /\bremove.*link\b/i,
            /\bkill.*link\b/i
        ],

        // Redeem coupon
        redeem_coupon: [
            /^(coupon|code|promo|redeem|claim|use)\s+\w{3,}/i,
            /^(coupon|cupon|copon|copoun)\s+/i,
            /\bredeem.*code\b/i,
            /\buse.*coupon\b/i,
            /\bclaim.*code\b/i,
            /\benter.*code\b/i
        ],

        // Help overview
        help_overview: [
            /^(help|menu|start|hi|hello|hey|info|commands?|what.*do)$/i,
            /^(helo|hel|hlp|men|mnu)$/i,
            /\bwhat\s+can.*do\b/i,
            /\bhow.*work\b/i,
            /\bhow.*use\b/i,
            /\bget\s+started\b/i,
            /\bshow.*options\b/i,
            /\bwhat.*features\b/i,
            /\bwhat.*this\b/i,
            /^(commands?|cmds?)$/i
        ],

        // Specific guides
        guide_create: [
            /^(guide|help|how|learn|teach|explain)\s+(create|make|link|creating|making)/i,
            /\bhow.*create.*link\b/i,
            /\bhow.*make.*link\b/i,
            /\bguide.*create\b/i,
            /\bcreate.*guide\b/i,
            /\blink.*guide\b/i
        ],

        guide_stats: [
            /^(guide|help|how|learn|teach|explain)\s+(stats?|track|analytics?|performance)/i,
            /\bhow.*track\b/i,
            /\bhow.*check.*stats\b/i,
            /\bguide.*stats\b/i,
            /\bstats.*guide\b/i,
            /\banalytics.*guide\b/i
        ],

        guide_redirect: [
            /^(guide|help|how|learn|teach|explain)\s+(redirect|temporal|temp)/i,
            /\bhow.*redirect\b/i,
            /\bhow.*temporal\b/i,
            /\bguide.*redirect\b/i,
            /\bredirect.*guide\b/i,
            /\btemporal.*guide\b/i
        ],

        guide_manage: [
            /^(guide|help|how|learn|teach|explain)\s+(manage|managing|organize|delete)/i,
            /\bhow.*manage.*link/i,
            /\bhow.*delete\b/i,
            /\bguide.*manage\b/i,
            /\bmanage.*guide\b/i
        ],

        guide_tums: [
            /^(guide|help|how|learn|teach|explain)\s+(tums?|money|coin|currency|coupon|balance)/i,
            /\bhow.*get.*tums\b/i,
            /\bhow.*coupon\b/i,
            /\bguide.*tums\b/i,
            /\btums.*guide\b/i,
            /\bcoupon.*guide\b/i,
            /\babout.*tums\b/i
        ],

        // Commands list
        commands_list: [
            /^(commands?|cmds?|all\s*commands?|list.*commands?|show.*commands?)$/i,
            /\ball.*commands?\b/i,
            /\blist.*commands?\b/i,
            /\bwhat.*commands?\b/i
        ]
    }

    /**
     * Match user input to an intent
     * @param {string} text - User's message
     * @returns {string|null} - Matched intent or null
     */
    static matchIntent(text) {
        if (!text || typeof text !== 'string') {
            return null
        }

        const normalizedText = text.trim()

        // Try to match against each intent pattern
        for (const [intent, patterns] of Object.entries(this.intentPatterns)) {
            for (const pattern of patterns) {
                if (pattern.test(normalizedText)) {
                    return intent
                }
            }
        }

        return null
    }

    /**
     * Check if text contains a phone number
     * @param {string} text 
     * @returns {boolean}
     */
    static containsPhoneNumber(text) {
        return /\d{10,15}/.test(text)
    }

    /**
     * Extract phone number from text
     * @param {string} text 
     * @returns {string|null}
     */
    static extractPhoneNumber(text) {
        const match = text.match(/\d{10,15}/)
        return match ? match[0] : null
    }

    /**
     * Check if text looks like a short code
     * @param {string} text 
     * @returns {boolean}
     */
    static looksLikeShortCode(text) {
        // Short codes are typically 3-20 alphanumeric characters
        return /^[a-z0-9]{3,20}$/i.test(text.trim())
    }

    /**
     * Fuzzy match for common typos and variations
     * @param {string} text 
     * @param {string} target 
     * @returns {boolean}
     */
    static fuzzyMatch(text, target) {
        const textLower = text.toLowerCase()
        const targetLower = target.toLowerCase()

        // Exact match
        if (textLower === targetLower) return true

        // Contains match
        if (textLower.includes(targetLower) || targetLower.includes(textLower)) return true

        // Levenshtein distance for typos (simple version)
        if (this.levenshteinDistance(textLower, targetLower) <= 2) return true

        return false
    }

    /**
     * Calculate Levenshtein distance (edit distance)
     * @param {string} a 
     * @param {string} b 
     * @returns {number}
     */
    static levenshteinDistance(a, b) {
        const matrix = []

        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i]
        }

        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j
        }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1]
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    )
                }
            }
        }

        return matrix[b.length][a.length]
    }

    /**
     * Get intent confidence score (0-1)
     * @param {string} text 
     * @param {string} intent 
     * @returns {number}
     */
    static getConfidence(text, intent) {
        const patterns = this.intentPatterns[intent]
        if (!patterns) return 0

        let maxConfidence = 0

        for (const pattern of patterns) {
            if (pattern.test(text)) {
                // Exact pattern match = high confidence
                maxConfidence = Math.max(maxConfidence, 0.9)
            }
        }

        return maxConfidence
    }

    /**
     * Suggest corrections for common typos
     * @param {string} word 
     * @returns {string|null}
     */
    static suggestCorrection(word) {
        const commonCommands = [
            'create', 'make', 'stats', 'info', 'balance', 'coupon',
            'links', 'find', 'best', 'worst', 'delete', 'redirect',
            'help', 'guide', 'commands'
        ]

        const wordLower = word.toLowerCase()

        for (const command of commonCommands) {
            if (this.levenshteinDistance(wordLower, command) <= 2) {
                return command
            }
        }

        return null
    }

    /**
     * Parse natural language for common intents
     * @param {string} text 
     * @returns {object}
     */
    static parseNaturalLanguage(text) {
        const result = {
            intent: null,
            confidence: 0,
            entities: {
                phoneNumber: null,
                shortCode: null,
                customMessage: null
            },
            suggestions: []
        }

        // Match intent
        result.intent = this.matchIntent(text)
        
        if (result.intent) {
            result.confidence = this.getConfidence(text, result.intent)
        }

        // Extract entities
        const phoneMatch = text.match(/\d{10,15}/)
        if (phoneMatch) {
            result.entities.phoneNumber = phoneMatch[0]
        }

        // Look for short codes (3-20 alphanumeric after command)
        const words = text.trim().split(/\s+/)
        for (let i = 1; i < words.length; i++) {
            if (this.looksLikeShortCode(words[i])) {
                result.entities.shortCode = words[i]
                break
            }
        }

        // Suggest corrections for first word if no intent matched
        if (!result.intent && words.length > 0) {
            const correction = this.suggestCorrection(words[0])
            if (correction) {
                result.suggestions.push(`Did you mean "${correction}"?`)
            }
        }

        return result
    }
}

module.exports = IntentMatcher