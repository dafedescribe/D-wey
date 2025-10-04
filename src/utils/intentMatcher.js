/**
 * Advanced Intent Matcher - Handles typos, variations, and natural language
 * Uses multiple strategies for maximum flexibility
 */

class IntentMatcher {
    // Core keywords for each intent (used for fuzzy matching)
    static intentKeywords = {
        check_balance: ['balance', 'money', 'coin', 'tum', 'cash', 'wallet', 'fund', 'much', 'have'],
        create_link: ['create', 'make', 'new', 'add', 'build', 'generate', 'setup', 'link', 'start'],
        link_info: ['stat', 'statistic', 'info', 'detail', 'analytic', 'performance', 'check', 'view', 'see', 'show', 'doing'],
        set_temporal: ['redirect', 'temp', 'temporal', 'change', 'switch', 'move', 'route', 'forward'],
        kill_temporal: ['stop redirect', 'kill redirect', 'remove redirect', 'cancel redirect', 'end redirect', 'delete redirect'],
        my_links: ['my link', 'all link', 'list', 'show link', 'view link', 'see link', 'display link'],
        search_links: ['find', 'search', 'look', 'locate', 'get'],
        best_links: ['best', 'top', 'highest', 'most', 'good', 'great', 'winning', 'performer'],
        worst_links: ['worst', 'lowest', 'bottom', 'bad', 'poor', 'weak', 'least'],
        kill_link: ['delete', 'remove', 'kill', 'destroy', 'deactivate', 'cancel'],
        redeem_coupon: ['coupon', 'code', 'promo', 'redeem', 'claim', 'use', 'enter'],
        help_overview: ['help', 'menu', 'start', 'hi', 'hello', 'hey', 'sup', 'yo', 'info', 'what', 'how', 'command'],
        guide_create: ['guide create', 'help create', 'how create', 'how make link', 'learn create'],
        guide_stats: ['guide stat', 'help stat', 'how track', 'how check stat', 'learn stat'],
        guide_redirect: ['guide redirect', 'help redirect', 'how redirect', 'learn redirect'],
        guide_manage: ['guide manage', 'help manage', 'how manage', 'how delete', 'learn manage'],
        guide_tums: ['guide tum', 'help tum', 'about tum', 'how get tum', 'learn tum', 'guide coupon'],
        commands_list: ['command', 'all command', 'list command', 'show command']
    }

    // Strict patterns for high-confidence matches
    static strictPatterns = {
        check_balance: [
            /^balance$/i,
            /^(my\s+)?(wallet|money|tums?|balance|cash|funds?)$/i,
            /^check\s+(my\s+)?(balance|wallet|tums?|money)$/i,
            /^how\s+much/i
        ],
        create_link: [
            /^(create|make|new|generate|add|build|setup|set\s*up)\s+\d/i,
            /^\d{10,15}(\s|$)/i // Starts with phone number
        ],
        link_info: [
            /^(stats?|info|details?|analytics?|check|view|show|see)\s+[a-z0-9]{3,}/i
        ],
        set_temporal: [
            /^(redirect|temp|temporal|redir|set\s*redirect)\s+[a-z0-9]+\s+\d/i
        ],
        kill_temporal: [
            /^(stop|kill|remove|delete|cancel|end)\s+(redirect|temp|temporal|redir)/i
        ],
        my_links: [
            /^(my\s+)?links?(\s+(all|active))?$/i,
            /^(show|view|see|list|display)\s+(my\s+)?links?/i
        ],
        search_links: [
            /^(find|search|look|locate)\s+\d{10,}/i
        ],
        best_links: [
            /^(best|top|highest|most|good|winning)/i
        ],
        worst_links: [
            /^(worst|lowest|bottom|bad|poor|weak|least)/i
        ],
        kill_link: [
            /^(delete|remove|kill|destroy|deactivate)\s+[a-z0-9]{3,}$/i
        ],
        redeem_coupon: [
            /^(coupon|code|promo|redeem|claim|use)\s+[a-z0-9]+/i
        ],
        help_overview: [
            /^(help|menu|start|info)$/i,
            /^(hi|hello|hey|sup|yo|greetings|hola)/i,
            /^what/i,
            /^how\s+(do\s+)?(i|you|this)/i
        ],
        commands_list: [
            /^(all\s+)?(commands?|cmds?)$/i,
            /^(list|show)\s+commands?$/i
        ]
    }

    /**
     * Main intent matching function - tries multiple strategies
     */
    static matchIntent(text) {
        if (!text || typeof text !== 'string') return null

        const normalized = text.trim().toLowerCase()
        
        // Strategy 1: Try strict pattern matching first (highest confidence)
        const strictMatch = this.matchStrictPatterns(normalized)
        if (strictMatch) return strictMatch

        // Strategy 2: Handle special cases (phone numbers, commands with codes)
        const specialCase = this.handleSpecialCases(normalized, text)
        if (specialCase) return specialCase

        // Strategy 3: Keyword + context matching
        const keywordMatch = this.matchByKeywords(normalized)
        if (keywordMatch) return keywordMatch

        // Strategy 4: Fuzzy matching with typo tolerance
        const fuzzyMatch = this.fuzzyMatchIntent(normalized)
        if (fuzzyMatch) return fuzzyMatch

        // Strategy 5: Natural language understanding
        const nlMatch = this.understandNaturalLanguage(normalized)
        if (nlMatch) return nlMatch

        return null
    }

    /**
     * Match against strict patterns
     */
    static matchStrictPatterns(text) {
        for (const [intent, patterns] of Object.entries(this.strictPatterns)) {
            for (const pattern of patterns) {
                if (pattern.test(text)) {
                    return intent
                }
            }
        }
        return null
    }

    /**
     * Handle special cases like phone numbers and short codes
     */
    static handleSpecialCases(normalized, originalText) {
        const words = normalized.split(/\s+/)
        
        // If starts with phone number, it's create_link
        if (/^\d{10,15}/.test(normalized)) {
            return 'create_link'
        }

        // "stats CODE" or "info CODE" or just "CODE" if it looks like a code
        if (words.length >= 2) {
            const firstWord = words[0]
            const secondWord = words[1]
            
            // Check if talking about stats/info for a code
            if (this.fuzzyMatch(firstWord, 'stat') || this.fuzzyMatch(firstWord, 'info') ||
                this.fuzzyMatch(firstWord, 'check') || this.fuzzyMatch(firstWord, 'view') ||
                this.fuzzyMatch(firstWord, 'show')) {
                if (this.looksLikeShortCode(secondWord)) {
                    return 'link_info'
                }
            }

            // "redirect CODE NUMBER" or "temp CODE NUMBER"
            if ((this.fuzzyMatch(firstWord, 'redirect') || this.fuzzyMatch(firstWord, 'temp')) &&
                this.looksLikeShortCode(secondWord) && words.length >= 3) {
                return 'set_temporal'
            }

            // "delete CODE" or "remove CODE"
            if ((this.fuzzyMatch(firstWord, 'delete') || this.fuzzyMatch(firstWord, 'remove') ||
                 this.fuzzyMatch(firstWord, 'kill')) && this.looksLikeShortCode(secondWord)) {
                return 'kill_link'
            }

            // "stop redirect CODE"
            if (this.fuzzyMatch(firstWord, 'stop') && 
                (this.fuzzyMatch(secondWord, 'redirect') || this.fuzzyMatch(secondWord, 'temp'))) {
                return 'kill_temporal'
            }

            // "coupon CODE"
            if (this.fuzzyMatch(firstWord, 'coupon') || this.fuzzyMatch(firstWord, 'code') ||
                this.fuzzyMatch(firstWord, 'redeem') || this.fuzzyMatch(firstWord, 'claim')) {
                return 'redeem_coupon'
            }

            // "find NUMBER" or "search NUMBER"
            if ((this.fuzzyMatch(firstWord, 'find') || this.fuzzyMatch(firstWord, 'search')) &&
                /\d{10,}/.test(secondWord)) {
                return 'search_links'
            }

            // "create NUMBER"
            if ((this.fuzzyMatch(firstWord, 'create') || this.fuzzyMatch(firstWord, 'make') ||
                 this.fuzzyMatch(firstWord, 'new') || this.fuzzyMatch(firstWord, 'add')) &&
                /\d{10,}/.test(secondWord)) {
                return 'create_link'
            }

            // "guide TOPIC"
            if (this.fuzzyMatch(firstWord, 'guide') || this.fuzzyMatch(firstWord, 'help') ||
                this.fuzzyMatch(firstWord, 'learn') || (firstWord === 'how' && words.length >= 3)) {
                if (this.fuzzyMatch(secondWord, 'create') || this.fuzzyMatch(secondWord, 'make')) {
                    return 'guide_create'
                }
                if (this.fuzzyMatch(secondWord, 'stat') || this.fuzzyMatch(secondWord, 'track')) {
                    return 'guide_stats'
                }
                if (this.fuzzyMatch(secondWord, 'redirect') || this.fuzzyMatch(secondWord, 'temp')) {
                    return 'guide_redirect'
                }
                if (this.fuzzyMatch(secondWord, 'manage') || this.fuzzyMatch(secondWord, 'delete')) {
                    return 'guide_manage'
                }
                if (this.fuzzyMatch(secondWord, 'tum') || this.fuzzyMatch(secondWord, 'coupon') ||
                    this.fuzzyMatch(secondWord, 'money') || this.fuzzyMatch(secondWord, 'balance')) {
                    return 'guide_tums'
                }
            }
        }

        // Single word checks
        if (words.length === 1) {
            const word = words[0]
            
            // Common single-word commands
            if (this.fuzzyMatch(word, 'balance')) return 'check_balance'
            if (this.fuzzyMatch(word, 'links')) return 'my_links'
            if (this.fuzzyMatch(word, 'help')) return 'help_overview'
            if (this.fuzzyMatch(word, 'commands')) return 'commands_list'
            if (this.fuzzyMatch(word, 'best')) return 'best_links'
            if (this.fuzzyMatch(word, 'worst')) return 'worst_links'
            if (this.fuzzyMatch(word, 'hi') || this.fuzzyMatch(word, 'hello') || 
                this.fuzzyMatch(word, 'hey') || this.fuzzyMatch(word, 'start') ||
                this.fuzzyMatch(word, 'menu')) return 'help_overview'
        }

        return null
    }

    /**
     * Match based on keyword presence and frequency
     */
    static matchByKeywords(text) {
        let bestIntent = null
        let bestScore = 0

        for (const [intent, keywords] of Object.entries(this.intentKeywords)) {
            let score = 0
            
            for (const keyword of keywords) {
                if (text.includes(keyword)) {
                    score += 2 // Exact match
                } else if (this.fuzzyMatch(text, keyword)) {
                    score += 1 // Fuzzy match
                }
            }

            // Boost score based on context
            if (intent === 'create_link' && /\d{10,}/.test(text)) score += 5
            if (intent === 'link_info' && this.containsShortCode(text)) score += 3
            if (intent === 'redeem_coupon' && this.containsShortCode(text)) score += 2
            if (intent === 'search_links' && /\d{10,}/.test(text)) score += 4

            if (score > bestScore) {
                bestScore = score
                bestIntent = intent
            }
        }

        return bestScore >= 2 ? bestIntent : null
    }

    /**
     * Fuzzy match with typo tolerance
     */
    static fuzzyMatchIntent(text) {
        const words = text.split(/\s+/)
        const firstWord = words[0]

        // Common commands with typo tolerance
        const commandMap = {
            'create': ['creat', 'crate', 'craete', 'mak', 'make', 'new', 'add'],
            'balance': ['balanc', 'balace', 'blance', 'money', 'tum', 'cash', 'wallet'],
            'stats': ['stat', 'statz', 'stas', 'info', 'detail', 'analytic'],
            'links': ['link', 'lnk', 'list', 'all'],
            'redirect': ['redir', 'redirects', 'temp', 'temporal'],
            'coupon': ['cupon', 'copon', 'copoun', 'code', 'promo'],
            'help': ['hel', 'hlp', 'halp', 'menu'],
            'find': ['find', 'search', 'look', 'locate'],
            'best': ['best', 'top', 'good', 'highest'],
            'worst': ['worst', 'bad', 'lowest', 'poor'],
            'delete': ['delet', 'remove', 'kill', 'del', 'rm']
        }

        for (const [command, variations] of Object.entries(commandMap)) {
            for (const variation of variations) {
                if (this.fuzzyMatch(firstWord, variation)) {
                    // Map command to intent
                    if (command === 'create') return words.length >= 2 ? 'create_link' : null
                    if (command === 'balance') return 'check_balance'
                    if (command === 'stats') return words.length >= 2 ? 'link_info' : null
                    if (command === 'links') return 'my_links'
                    if (command === 'redirect') return words.length >= 3 ? 'set_temporal' : null
                    if (command === 'coupon') return words.length >= 2 ? 'redeem_coupon' : null
                    if (command === 'help') return 'help_overview'
                    if (command === 'find') return words.length >= 2 ? 'search_links' : null
                    if (command === 'best') return 'best_links'
                    if (command === 'worst') return 'worst_links'
                    if (command === 'delete') return words.length >= 2 ? 'kill_link' : null
                }
            }
        }

        return null
    }

    /**
     * Understand natural language queries
     */
    static understandNaturalLanguage(text) {
        // Greetings and help
        if (/\b(hi|hello|hey|sup|yo|hola|greet)/i.test(text)) return 'help_overview'
        if (/\b(what|how|can|help|guide|show|explain|tell)/i.test(text)) return 'help_overview'
        
        // Balance related
        if (/\b(much|many|balance|money|tum|have|got)/i.test(text) && 
            !/\b(link|create|stat)/i.test(text)) return 'check_balance'
        
        // Creating something
        if (/\b(create|make|new|build|add|generate|setup|want|need)/i.test(text) && 
            /\d{10,}/.test(text)) return 'create_link'
        
        // Viewing stats
        if (/\b(how.*doing|perform|click|stat|view|check|show|see)/i.test(text) && 
            this.containsShortCode(text)) return 'link_info'
        
        // List of links
        if (/\b(my|all|show.*link|list|view.*link|see.*link)/i.test(text)) return 'my_links'
        
        // Finding something
        if (/\b(find|search|look|where|locate)/i.test(text)) {
            if (/\d{10,}/.test(text)) return 'search_links'
            return 'my_links'
        }
        
        // Performance queries
        if (/\b(best|top|good|highest|great|winning)/i.test(text)) return 'best_links'
        if (/\b(worst|bad|poor|lowest|weak|least)/i.test(text)) return 'worst_links'
        
        // Deletion
        if (/\b(delete|remove|kill|stop|cancel|end)/i.test(text)) {
            if (/\b(redirect|temp)/i.test(text)) return 'kill_temporal'
            if (this.containsShortCode(text)) return 'kill_link'
        }
        
        // Redirection
        if (/\b(redirect|forward|change|switch|temp|route)/i.test(text)) {
            if (/\b(stop|kill|remove|cancel)/i.test(text)) return 'kill_temporal'
            return 'set_temporal'
        }
        
        // Coupon
        if (/\b(coupon|code|promo|redeem|claim|use|free|bonus)/i.test(text)) return 'redeem_coupon'
        
        // Commands
        if (/\b(command|option|feature|can.*do|all.*command)/i.test(text)) return 'commands_list'
        
        return null
    }

    /**
     * Fuzzy string matching with typo tolerance
     */
    static fuzzyMatch(str1, str2) {
        if (!str1 || !str2) return false
        
        const s1 = str1.toLowerCase().trim()
        const s2 = str2.toLowerCase().trim()
        
        // Exact match
        if (s1 === s2) return true
        
        // Contains match
        if (s1.includes(s2) || s2.includes(s1)) return true
        
        // Starts with
        if (s1.startsWith(s2.substring(0, 3)) || s2.startsWith(s1.substring(0, 3))) return true
        
        // Allow 2 character difference for typos
        if (Math.abs(s1.length - s2.length) <= 2) {
            const distance = this.levenshteinDistance(s1, s2)
            if (distance <= 2) return true
        }
        
        return false
    }

    /**
     * Check if text contains a short code
     */
    static containsShortCode(text) {
        const words = text.split(/\s+/)
        for (const word of words) {
            if (this.looksLikeShortCode(word)) return true
        }
        return false
    }

    /**
     * Check if string looks like a short code
     */
    static looksLikeShortCode(str) {
        return /^[a-z0-9]{3,20}$/i.test(str.trim())
    }

    /**
     * Check if text contains phone number
     */
    static containsPhoneNumber(text) {
        return /\d{10,15}/.test(text)
    }

    /**
     * Extract phone number
     */
    static extractPhoneNumber(text) {
        const match = text.match(/\d{10,15}/)
        return match ? match[0] : null
    }

    /**
     * Calculate Levenshtein distance
     */
    static levenshteinDistance(a, b) {
        if (a.length === 0) return b.length
        if (b.length === 0) return a.length

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
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    )
                }
            }
        }

        return matrix[b.length][a.length]
    }

    /**
     * Get suggestions for unmatched input
     */
    static getSuggestions(text) {
        const normalized = text.toLowerCase()
        const words = normalized.split(/\s+/)
        
        // If contains phone number, suggest create
        if (this.containsPhoneNumber(text)) {
            return 'create ' + this.extractPhoneNumber(text)
        }
        
        // If contains short code, suggest stats
        if (this.containsShortCode(text)) {
            const code = words.find(w => this.looksLikeShortCode(w))
            return 'stats ' + code
        }
        
        // Try to find closest command
        const commands = ['create', 'balance', 'stats', 'links', 'help', 'coupon', 'find', 'best', 'worst']
        for (const word of words) {
            for (const cmd of commands) {
                if (this.levenshteinDistance(word, cmd) <= 2) {
                    return cmd
                }
            }
        }
        
        return 'help'
    }
}

module.exports = IntentMatcher