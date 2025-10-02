const UserService = require('../services/userService')
const LinkService = require('../services/linkService')
const CouponService = require('../services/couponService')

// ==================== CONFIGURATION ====================
const CONFIG = {
    MAX_LINKS_DISPLAY: 10,
    BAR_CHART_WIDTH: 10,
    LOW_BALANCE_DAYS: 3,
    MAX_MESSAGE_LENGTH: 4000,
    MESSAGE_DELAY_MS: 500
}

// ==================== ERROR CODES ====================
const ERROR_CODES = {
    INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
    INVALID_PHONE: 'INVALID_PHONE',
    ALREADY_USED: 'ALREADY_USED',
    NOT_FOUND: 'NOT_FOUND',
    RATE_LIMIT: 'RATE_LIMIT'
}

// ==================== PRE-COMPILED REGEX ====================
const PATTERNS = {
    balance: /^(bal|balance|money|coins|tums|wallet|cash)$/i,
    calculator: /^(cost|calculate|calc|estimate|price)$/i,
    createLink: /^(createlink|create|make|new)\s*/i,
    linkInfo: /^(linkinfo|info|stats|check|view|analytics)\s*/i,
    setTemporal: /^(settemporal|temporal|temp|settemp)\s*/i,
    killTemporal: /^(killtemporal|killtemp|removetemp)\s*/i,
    myLinks: /^(mylinks|links|mylink|list)/i,
    searchLinks: /^(searchlinks|search|find)\s*/i,
    bestLinks: /^(best|top|highest)$/i,
    worstLinks: /^(worst|lowest|bottom|low)$/i,
    killLink: /^(killlink|kill|delete|remove)\s*/i,
    coupon: /^(coupon|redeem|code)\s*/i,
    help: /^(help|menu|commands|start|guide|how)$/i,
    greeting: /^(hi|hello|hey|hola|yo|sup|whatsup)$/i,
    status: /^(status|coupons|codes|promocode)$/i
}

// ==================== UTILITIES ====================
const utils = {
    parseCommand: (text) => {
        const trimmed = text.trim()
        const parts = trimmed.split(/\s+/).filter(Boolean)
        return {
            full: trimmed.toLowerCase(),
            command: parts[0]?.toLowerCase() || '',
            args: parts.slice(1)
        }
    },
    
    calculateDaysRemaining: (balance, dailyCost) => {
        return dailyCost > 0 ? Math.floor(balance / dailyCost) : '∞'
    },
    
    safeGet: (arr, index, defaultVal = null) => {
        return arr && arr[index] !== undefined ? arr[index] : defaultVal
    },
    
    sanitizeForLog: (data) => {
        // Remove sensitive data from logs
        const sanitized = { ...data }
        if (sanitized.phoneNumber) {
            sanitized.phoneNumber = sanitized.phoneNumber.replace(/(\d{3})\d+(\d{4})/, '$1****$2')
        }
        return sanitized
    },
    
    detectErrorType: (error) => {
        const message = error.message.toLowerCase()
        if (message.includes('insufficient balance')) return ERROR_CODES.INSUFFICIENT_BALANCE
        if (message.includes('phone number')) return ERROR_CODES.INVALID_PHONE
        if (message.includes('already used') || message.includes('reached its limit')) return ERROR_CODES.ALREADY_USED
        if (message.includes('not found')) return ERROR_CODES.NOT_FOUND
        return null
    }
}

// ==================== VALIDATORS ====================
const validators = {
    phoneNumber: (input) => {
        if (!input) return { valid: false, error: 'Phone number required' }
        const cleaned = input.replace(/\D/g, '')
        if (cleaned.length < 10 || cleaned.length > 15) {
            return { valid: false, error: 'Phone must be 10-15 digits' }
        }
        return { valid: true, value: input }
    },
    
    shortCode: (input) => {
        if (!input) return { valid: false, error: 'Short code required' }
        if (input.length < 3) {
            return { valid: false, error: 'Code must be 3+ characters' }
        }
        return { valid: true, value: input.toLowerCase() }
    },
    
    couponCode: (input) => {
        if (!input) return { valid: false, error: 'Coupon code required' }
        if (input.length < 3) {
            return { valid: false, error: 'Invalid coupon code' }
        }
        return { valid: true, value: input.toUpperCase() }
    }
}

// ==================== MESSAGE FORMATTERS ====================
const formatters = {
    separator: () => `━━━━━━━━━━━━━━━━`,
    
    couponReminder: () => 
        `${formatters.separator()}\n` +
        `💡 GET TUMS:\n` +
        `${formatters.separator()}\n` +
        `🎫 Use: coupon CODE\n` +
        `📢 Check my status for codes!\n` +
        `👀 Stay tuned for new codes!`,
    
    insufficientBalance: (balance, cost) => 
        `❌ Insufficient balance\n\n` +
        `Need: ${cost} tums\n` +
        `Have: ${balance} tums\n\n` +
        `${formatters.couponReminder()}`,
    
    quickActions: (actions) => {
        const parts = [
            formatters.separator(),
            `⚡ QUICK ACTIONS:`,
            formatters.separator(),
            ...actions
        ]
        return parts.join('\n')
    },
    
    linkStatus: (link) => {
        const status = link.is_active ? '✅' : '❌'
        const parts = [
            `${status} ${link.short_code}`,
            `   📊 ${link.total_clicks} clicks (${link.unique_clicks} unique)`
        ]
        if (link.temporal_target_phone) {
            parts.push(`   ⏰ Temporal: ${link.temporal_target_phone}`)
        }
        return parts.join('\n')
    }
}

// ==================== BUSINESS LOGIC CALCULATORS ====================
const calculators = {
    walletStatus: (user, links) => {
        const balance = user.wallet_balance || 0
        const activeLinks = links.length
        const dailyCost = activeLinks * LinkService.PRICING.DAILY_MAINTENANCE
        
        return {
            balance,
            activeLinks,
            dailyCost,
            daysRemaining: utils.calculateDaysRemaining(balance, dailyCost),
            canCreateLinks: Math.floor(balance / LinkService.PRICING.CREATE_LINK),
            canCheckInfo: Math.floor(balance / LinkService.PRICING.LINK_INFO_CHECK),
            isLowBalance: balance < dailyCost * CONFIG.LOW_BALANCE_DAYS
        }
    }
}

// ==================== MESSAGE BUILDERS ====================
const messageBuilders = {
    balance: (walletStatus) => {
        const parts = [
            `💰 WALLET STATUS\n`,
            `Balance: ${walletStatus.balance} tums`,
            `Active links: ${walletStatus.activeLinks}`
        ]
        
        if (walletStatus.activeLinks > 0) {
            parts.push(`Daily cost: ${walletStatus.dailyCost} tums`)
            parts.push(`Days left: ${walletStatus.daysRemaining === '∞' ? 'Forever' : walletStatus.daysRemaining + ' days'}\n`)
            
            if (walletStatus.isLowBalance) {
                parts.push(`⚠️ LOW BALANCE WARNING!`)
                parts.push(`Links expire in ${walletStatus.daysRemaining} days.\n`)
            }
        } else {
            parts.push(`\n✨ Can create ${walletStatus.canCreateLinks} links!\n`)
        }
        
        parts.push(formatters.couponReminder())
        return parts.join('\n')
    },
    
    calculator: (walletStatus) => [
        `📊 COST CALCULATOR\n`,
        `${formatters.separator()}`,
        `💰 CURRENT STATUS`,
        `${formatters.separator()}`,
        `Balance: ${walletStatus.balance} tums`,
        `Active links: ${walletStatus.activeLinks}`,
        `Daily cost: ${walletStatus.dailyCost} tums`,
        `Days remaining: ${walletStatus.daysRemaining}\n`,
        `${formatters.separator()}`,
        `💵 PRICING`,
        `${formatters.separator()}`,
        `Create link: ${LinkService.PRICING.CREATE_LINK} tums`,
        `Daily maintenance: ${LinkService.PRICING.DAILY_MAINTENANCE} tums/link`,
        `Link info: ${LinkService.PRICING.LINK_INFO_CHECK} tums`,
        `Set temporal: ${LinkService.PRICING.SET_TEMPORAL_TARGET} tums`,
        `Kill temporal: ${LinkService.PRICING.KILL_TEMPORAL_TARGET} tums\n`,
        `${formatters.separator()}`,
        `📈 WHAT YOU CAN DO`,
        `${formatters.separator()}`,
        `New links: ${walletStatus.canCreateLinks}`,
        `Info checks: ${walletStatus.canCheckInfo}\n`,
        `💡 Each link costs ${LinkService.PRICING.DAILY_MAINTENANCE} tums daily\n`,
        `🎫 Need more? Use: coupon CODE`,
        `📢 Check my status for coupons!`
    ].join('\n'),
    
    createLinkHelp: (balance) => [
        `📝 HOW TO CREATE A LINK\n`,
        `${formatters.separator()}`,
        `Basic:`,
        `createlink 2348012345678\n`,
        `With message:`,
        `createlink 2348012345678 Hello!\n`,
        `Custom code + message (use | or /):`,
        `createlink 2348012345678 Hello!|mycode`,
        `createlink 2348012345678 Hello!/mycode\n`,
        `${formatters.separator()}`,
        `💰 Cost: ${LinkService.PRICING.CREATE_LINK} tums`,
        `📅 Daily: ${LinkService.PRICING.DAILY_MAINTENANCE} tums`,
        `💵 You have: ${balance} tums\n`,
        formatters.couponReminder()
    ].join('\n'),
    
    linkCreated: (result, newBalance, daysLeft, isLowBalance) => {
        const parts = [
            `✅ LINK CREATED!\n`,
            `${formatters.separator()}`,
            `🔗 YOUR LINK:`,
            `${result.redirectUrl}\n`,
            `${formatters.separator()}`,
            `📱 Target: ${result.link.target_phone}`,
            `🏷️ Code: ${result.shortCode}`,
            `💰 Cost: ${result.cost} tums`,
            `⏰ Active until: ${new Date(result.expiresAt).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })}\n`,
            `${formatters.separator()}`,
            `💵 Balance: ${newBalance} tums`,
            `📅 Days left: ${daysLeft}`
        ]
        
        if (isLowBalance) {
            parts.push(`\n⚠️ LOW BALANCE!`)
            parts.push(`🎫 Top up: coupon CODE`)
            parts.push(`📢 Check my status!`)
        }
        
        parts.push(`\n${formatters.quickActions([
            `📊 Stats: linkinfo ${result.shortCode}`,
            `⏰ Temporal: settemporal ${result.shortCode} PHONE`,
            `📤 Share the link above!`
        ])}`)
        
        return parts.join('\n')
    },
    
    help: (displayName, walletStatus) => {
        const parts = [
            `👋 HEY ${displayName.toUpperCase()}!\n`,
            `${formatters.separator()}`,
            `💰 WALLET STATUS`,
            `${formatters.separator()}`,
            `Balance: ${walletStatus.balance} tums`,
            `Active links: ${walletStatus.activeLinks}\n`
        ]
        
        if (walletStatus.balance < LinkService.PRICING.CREATE_LINK) {
            parts.push(
                `⚠️ LOW BALANCE!`,
                `You need ${LinkService.PRICING.CREATE_LINK - walletStatus.balance} more tums.\n`,
                `${formatters.separator()}`,
                `🎫 GET TUMS:`,
                `${formatters.separator()}`,
                `coupon CODE - Redeem coupon\n`,
                `📢 CHECK MY STATUS for coupon codes!`,
                `👀 Stay tuned for new codes!`,
                `🔔 I post codes regularly!\n`
            )
        } else {
            parts.push(`✨ You can create ${walletStatus.canCreateLinks} links!\n`)
        }
        
        parts.push(
            `${formatters.separator()}`,
            `📱 LINK COMMANDS:`,
            `${formatters.separator()}`,
            `createlink PHONE - New link (${LinkService.PRICING.CREATE_LINK}t)`,
            `linkinfo CODE - Stats (${LinkService.PRICING.LINK_INFO_CHECK}t)`,
            `mylinks - View all`,
            `searchlinks PHONE - Find links`,
            `best - Top performers`,
            `worst - Low performers`,
            `killlink CODE - Delete\n`,
            `${formatters.separator()}`,
            `⏰ TEMPORAL:`,
            `${formatters.separator()}`,
            `settemporal CODE PHONE (${LinkService.PRICING.SET_TEMPORAL_TARGET}t)`,
            `killtemporal CODE (${LinkService.PRICING.KILL_TEMPORAL_TARGET}t)\n`,
            `${formatters.separator()}`,
            `💰 WALLET:`,
            `${formatters.separator()}`,
            `balance - Check tums`,
            `cost - Calculator`,
            `coupon CODE - Redeem\n`,
            `${formatters.separator()}`,
            `💡 PRO TIPS:`,
            `${formatters.separator()}`,
            `• Type command alone for help`,
            `• Links cost ${LinkService.PRICING.DAILY_MAINTENANCE}t/day`,
            `• Check my STATUS for coupons!`,
            `• Use | or / for custom codes\n`,
            `📢 STAY TUNED FOR COUPON CODES!`
        )
        
        return parts.join('\n')
    }
}

// ==================== MESSENGER ====================
const createMessenger = (sock) => ({
    async send(jid, text, chunkIfNeeded = true) {
        try {
            if (!chunkIfNeeded || text.length <= CONFIG.MAX_MESSAGE_LENGTH) {
                return await sock.sendMessage(jid, { text })
            }
            
            const chunks = this.chunkMessage(text)
            for (let i = 0; i < chunks.length; i++) {
                await sock.sendMessage(jid, { text: chunks[i] })
                if (i < chunks.length - 1) {
                    await new Promise(r => setTimeout(r, CONFIG.MESSAGE_DELAY_MS))
                }
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Failed to send message:`, error.message)
            throw error
        }
    },
    
    chunkMessage(text, maxLength = CONFIG.MAX_MESSAGE_LENGTH) {
        if (text.length <= maxLength) return [text]
        
        const chunks = []
        let current = ''
        const lines = text.split('\n')
        
        for (const line of lines) {
            if ((current + line + '\n').length > maxLength) {
                if (current) chunks.push(current.trim())
                current = line + '\n'
            } else {
                current += line + '\n'
            }
        }
        if (current) chunks.push(current.trim())
        return chunks
    }
})

// ==================== ERROR HANDLER ====================
const handleCommandError = async (messenger, jid, error, context = {}) => {
    const errorType = utils.detectErrorType(error)
    let message = `❌ ${error.message}`
    
    switch (errorType) {
        case ERROR_CODES.INSUFFICIENT_BALANCE:
            if (context.balance !== undefined && context.cost !== undefined) {
                message = formatters.insufficientBalance(context.balance, context.cost)
            } else {
                message += `\n\n${formatters.couponReminder()}`
            }
            break
            
        case ERROR_CODES.INVALID_PHONE:
            message += `\n\n💡 Use format: 2348012345678\nOr: 08012345678 (auto-converts)`
            break
            
        case ERROR_CODES.ALREADY_USED:
            message += `\n\n${formatters.separator()}\n`
            message += `💡 GET NEW COUPONS:\n`
            message += `${formatters.separator()}\n`
            message += `📢 Check my WhatsApp status\n`
            message += `🔔 I post codes regularly\n`
            message += `👀 Stay tuned for fresh codes!`
            break
            
        default:
            message += `\n\n💡 Try: help`
    }
    
    await messenger.send(jid, message)
}

// ==================== MAIN HANDLER ====================
function handleMessage(sock) {
    const messenger = createMessenger(sock)
    
    return async (messageEvent) => {
        const msg = messageEvent.messages[0]
        
        if (!msg?.message || 
            msg.key.remoteJid === 'status@broadcast' || 
            msg.key.fromMe) return

        if (messageEvent.type !== 'notify') return

        const text = msg.message?.conversation || 
                    msg.message?.extendedTextMessage?.text || ''
        
        const jid = msg.key.remoteJid
        const phoneNumber = jid.split('@')[0].replace(/\D/g, '')
        const displayName = msg.pushName || 'Friend'
        
        const timestamp = new Date().toISOString()
        console.log(`[${timestamp}] ${utils.sanitizeForLog({ phoneNumber }).phoneNumber} (${displayName}): ${text}`)

        try {
            const { full: command, args } = utils.parseCommand(text)

            // ==================== RATE LIMITING ====================
            const rateLimitCheck = UserService.checkRateLimit(phoneNumber, 'general')
            if (!rateLimitCheck.allowed) {
                await messenger.send(jid,
                    `⚠️ Whoa, slow down!\n\n` +
                    `Wait ${rateLimitCheck.resetIn} seconds.\n` +
                    `Remaining: ${rateLimitCheck.remaining}/${UserService.MAX_REQUESTS_PER_MINUTE}\n\n` +
                    `💡 This keeps the service fast!`
                )
                return
            }

            // ==================== BALANCE CHECK ====================
            if (PATTERNS.balance.test(command)) {
                const { user } = await UserService.softRegisterUser(phoneNumber, displayName)
                const links = await LinkService.getUserLinks(phoneNumber, 'active')
                const walletStatus = calculators.walletStatus(user, links)
                
                await messenger.send(jid, messageBuilders.balance(walletStatus))
                return
            }

            // ==================== COST CALCULATOR ====================
            if (PATTERNS.calculator.test(command)) {
                const { user } = await UserService.softRegisterUser(phoneNumber, displayName)
                const links = await LinkService.getUserLinks(phoneNumber, 'active')
                const walletStatus = calculators.walletStatus(user, links)
                
                await messenger.send(jid, messageBuilders.calculator(walletStatus))
                return
            }

            // ==================== CREATE LINK ====================
            if (PATTERNS.createLink.test(command)) {
                await messenger.send(jid, '⏳ Creating your link...')
                
                const linkRateCheck = UserService.checkRateLimit(phoneNumber, 'createlink')
                if (!linkRateCheck.allowed) {
                    await messenger.send(jid, `⚠️ Wait ${linkRateCheck.resetIn}s before creating another link.`)
                    return
                }

                const { user } = await UserService.softRegisterUser(phoneNumber, displayName)
                
                const targetPhone = utils.safeGet(args, 0)
                
                if (!targetPhone) {
                    await messenger.send(jid, messageBuilders.createLinkHelp(user.wallet_balance))
                    return
                }
                
                const phoneValidation = validators.phoneNumber(targetPhone)
                if (!phoneValidation.valid) {
                    await messenger.send(jid, `❌ ${phoneValidation.error}\n\n💡 Example: 2348012345678`)
                    return
                }
                
                try {
                    let customMessage = null
                    let customCode = null

                    if (args.length > 1) {
                        const extraParts = args.slice(1).join(' ')
                        const delimiter = extraParts.includes('|') ? '|' : extraParts.includes('/') ? '/' : null
                        
                        if (delimiter) {
                            const [msg, code] = extraParts.split(delimiter)
                            customMessage = msg.trim() || null
                            customCode = code.trim() || null
                        } else {
                            customMessage = extraParts.trim()
                        }
                    }

                    const result = await LinkService.createWhatsAppLink(
                        phoneNumber,
                        targetPhone,
                        customCode,
                        customMessage
                    )

                    const newBalance = user.wallet_balance - result.cost
                    const daysLeft = Math.floor(newBalance / LinkService.PRICING.DAILY_MAINTENANCE)
                    const isLowBalance = newBalance < LinkService.PRICING.DAILY_MAINTENANCE * CONFIG.LOW_BALANCE_DAYS

                    await messenger.send(jid, messageBuilders.linkCreated(result, newBalance, daysLeft, isLowBalance))

                } catch (error) {
                    await handleCommandError(messenger, jid, error, {
                        balance: user.wallet_balance,
                        cost: LinkService.PRICING.CREATE_LINK
                    })
                }
                return
            }

            // ==================== LINK INFO ====================
            if (PATTERNS.linkInfo.test(command)) {
                const shortCode = utils.safeGet(args, 0)
                
                if (!shortCode) {
                    await messenger.send(jid,
                        `📊 CHECK LINK STATS\n\n` +
                        `Usage: linkinfo SHORTCODE\n` +
                        `Example: linkinfo abc123\n\n` +
                        `💰 Cost: ${LinkService.PRICING.LINK_INFO_CHECK} tums\n\n` +
                        `💡 See your links: mylinks`
                    )
                    return
                }
                
                const codeValidation = validators.shortCode(shortCode)
                if (!codeValidation.valid) {
                    await messenger.send(jid, `❌ ${codeValidation.error}`)
                    return
                }

                await messenger.send(jid, '📊 Analyzing clicks...')
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                try {
                    const info = await LinkService.getLinkInfo(phoneNumber, shortCode)
                    const { analytics, link } = info

                    const parts = [
                        `📊 LINK ANALYTICS\n`,
                        `${formatters.separator()}`,
                        `🏷️ Code: ${link.shortCode}`,
                        `🔗 ${link.redirectUrl}`,
                        `📱 Target: ${link.targetPhone}`
                    ]
                    
                    if (link.temporalTarget) {
                        parts.push(`⏰ Temporal: ${link.temporalTarget}`)
                    }
                    
                    parts.push(
                        `\n${formatters.separator()}`,
                        `📈 PERFORMANCE`,
                        `${formatters.separator()}`,
                        `Total clicks: ${link.totalClicks}`,
                        `Unique clicks: ${link.uniqueClicks}`,
                        `Unique rate: ${analytics.uniqueClickRate}`,
                        `Avg/day: ${analytics.averageClicksPerDay}`
                    )
                    
                    if (analytics.totalClicks > 0) {
                        parts.push(
                            `\n${formatters.separator()}`,
                            `⏰ TIME PATTERNS`,
                            `${formatters.separator()}`,
                            `Peak hour: ${analytics.peakTime}`,
                            `Peak day: ${analytics.peakDay} (${analytics.peakDayClicks} clicks)`,
                            `Peak weekday: ${analytics.peakDayOfWeek} (${analytics.peakDayOfWeekClicks} clicks)`,
                            `\n${formatters.separator()}`,
                            `📅 ACTIVITY`,
                            `${formatters.separator()}`,
                            `Active days: ${analytics.totalDays}`,
                            `Active hours: ${analytics.activeHours}/24`,
                            `Active weekdays: ${analytics.activeDaysOfWeek}/7`,
                            `\n${formatters.separator()}`,
                            `📊 DAY OF WEEK`,
                            `${formatters.separator()}`
                        )
                        
                        Object.entries(analytics.clicksByDayOfWeek).forEach(([day, count]) => {
                            if (count > 0) {
                                const barLength = Math.ceil(count / analytics.peakDayOfWeekClicks * CONFIG.BAR_CHART_WIDTH)
                                const bar = '█'.repeat(barLength)
                                parts.push(`${day.substring(0,3)}: ${bar} ${count}`)
                            }
                        })
                        
                        parts.push(
                            `\n${formatters.separator()}`,
                            `🕐 HOURLY PATTERN`,
                            `${formatters.separator()}`
                        )
                        
                        const periods = {
                            'Night (12am-6am)': [0,1,2,3,4,5],
                            'Morning (6am-12pm)': [6,7,8,9,10,11],
                            'Afternoon (12pm-6pm)': [12,13,14,15,16,17],
                            'Evening (6pm-12am)': [18,19,20,21,22,23]
                        }
                        
                        Object.entries(periods).forEach(([period, hours]) => {
                            const periodClicks = hours.reduce((sum, hour) => sum + (analytics.clicksByHour[hour] || 0), 0)
                            if (periodClicks > 0) {
                                const percentage = ((periodClicks / analytics.totalClicks) * 100).toFixed(0)
                                parts.push(`${period}: ${periodClicks} (${percentage}%)`)
                            }
                        })
                        
                        const firstClick = new Date(analytics.firstClick).toLocaleString('en-GB', {
                            timeZone: 'Africa/Lagos',
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit'
                        })
                        const lastClick = new Date(analytics.lastClick).toLocaleString('en-GB', {
                            timeZone: 'Africa/Lagos',
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit'
                        })
                        
                        parts.push(
                            `\n${formatters.separator()}`,
                            `📅 TIMELINE`,
                            `${formatters.separator()}`,
                            `First: ${firstClick}`,
                            `Last: ${lastClick}`
                        )
                    }
                    
                    parts.push(`\n💰 Cost: ${LinkService.PRICING.LINK_INFO_CHECK} tums`)

                    await messenger.send(jid, parts.join('\n'))

                } catch (error) {
                    await handleCommandError(messenger, jid, error)
                }
                return
            }

            // ==================== SET TEMPORAL ====================
            if (PATTERNS.setTemporal.test(command)) {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                const shortCode = utils.safeGet(args, 0)
                const temporalPhone = utils.safeGet(args, 1)
                
                if (!shortCode || !temporalPhone) {
                    await messenger.send(jid,
                        `⏰ SET TEMPORAL TARGET\n\n` +
                        `Temporarily redirect a link.\n\n` +
                        `${formatters.separator()}\n` +
                        `Usage:\n` +
                        `settemporal SHORTCODE PHONE\n\n` +
                        `Example:\n` +
                        `settemporal abc123 2348012345678\n\n` +
                        `${formatters.separator()}\n` +
                        `💰 Cost: ${LinkService.PRICING.SET_TEMPORAL_TARGET} tums\n\n` +
                        `💡 Remove with: killtemporal SHORTCODE`
                    )
                    return
                }
                
                try {
                    const result = await LinkService.setTemporalTarget(phoneNumber, shortCode, temporalPhone)

                    await messenger.send(jid,
                        `✅ TEMPORAL TARGET SET!\n\n` +
                        `${formatters.separator()}\n` +
                        `🔗 Link: ${shortCode}\n` +
                        `⏰ Temporal: ${result.temporalTarget}\n` +
                        `💰 Cost: ${LinkService.PRICING.SET_TEMPORAL_TARGET} tums\n\n` +
                        formatters.quickActions([
                            `Remove: killtemporal ${shortCode}`,
                            `Stats: linkinfo ${shortCode}`
                        ])
                    )
                } catch (error) {
                    await handleCommandError(messenger, jid, error)
                }
                return
            }

            // ==================== KILL TEMPORAL ====================
            if (PATTERNS.killTemporal.test(command)) {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                const shortCode = utils.safeGet(args, 0)
                
                if (!shortCode) {
                    await messenger.send(jid,
                        `⏰ REMOVE TEMPORAL TARGET\n\n` +
                        `Usage: killtemporal SHORTCODE\n` +
                        `Example: killtemporal abc123\n\n` +
                        `💰 Cost: ${LinkService.PRICING.KILL_TEMPORAL_TARGET} tums\n\n` +
                        `💡 Returns link to original target`
                    )
                    return
                }
                
                try {
                    await LinkService.killTemporalTarget(phoneNumber, shortCode)
                    await messenger.send(jid,
                        `✅ TEMPORAL REMOVED!\n\n` +
                        `🔗 Link: ${shortCode}\n` +
                        `↩️ Restored to original target\n` +
                        `💰 Cost: ${LinkService.PRICING.KILL_TEMPORAL_TARGET} tums\n\n` +
                        `📊 Check status: linkinfo ${shortCode}`
                    )
                } catch (error) {
                    await handleCommandError(messenger, jid, error)
                }
                return
            }

            // ==================== MY LINKS ====================
            if (PATTERNS.myLinks.test(command)) {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                try {
                    const filter = command.includes('active') ? 'active' : 'all'
                    const links = await LinkService.getUserLinks(phoneNumber, filter)

                    if (!links || links.length === 0) {
                        await messenger.send(jid,
                            `📋 NO LINKS YET\n\n` +
                            `Create your first link:\n` +
                            `createlink 2348012345678\n\n` +
                            `💰 Cost: ${LinkService.PRICING.CREATE_LINK} tums\n\n` +
                            formatters.couponReminder()
                        )
                        return
                    }

                    const parts = [`📋 YOUR LINKS (${links.length})\n`]
                    
                    links.slice(0, CONFIG.MAX_LINKS_DISPLAY).forEach(link => {
                        parts.push(formatters.linkStatus(link))
                        parts.push('')
                    })
                    
                    if (links.length > CONFIG.MAX_LINKS_DISPLAY) {
                        parts.push(`... and ${links.length - CONFIG.MAX_LINKS_DISPLAY} more\n`)
                    }
                    
                    parts.push(formatters.quickActions([
                        `linkinfo CODE - Check stats`,
                        `searchlinks PHONE - Find links`,
                        `best - Top performers`,
                        `worst - Low performers`
                    ]))

                    await messenger.send(jid, parts.join('\n'))
                } catch (error) {
                    await handleCommandError(messenger, jid, error)
                }
                return
            }

            // ==================== SEARCH LINKS ====================
            if (PATTERNS.searchLinks.test(command)) {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                const targetPhone = utils.safeGet(args, 0)
                
                if (!targetPhone) {
                    await messenger.send(jid,
                        `🔍 SEARCH LINKS\n\n` +
                        `Find all links to a number.\n\n` +
                        `Usage: searchlinks PHONE\n` +
                        `Example: searchlinks 2348012345678\n\n` +
                        `💡 Shows your links to that number`
                    )
                    return
                }
                
                try {
                    const links = await LinkService.getLinksByTarget(phoneNumber, targetPhone)

                    if (!links || links.length === 0) {
                        await messenger.send(jid,
                            `🔍 No links found for ${targetPhone}\n\n` +
                            `Create one:\n` +
                            `createlink ${targetPhone}`
                        )
                        return
                    }

                    const parts = [
                        `🔍 LINKS TO ${targetPhone}\n`,
                        `Found ${links.length} link(s):\n`
                    ]
                    
                    links.slice(0, CONFIG.MAX_LINKS_DISPLAY).forEach(link => {
                        parts.push(formatters.linkStatus(link))
                        parts.push('')
                    })
                    
                    parts.push(`${formatters.separator()}`)
                    parts.push(`Check details: linkinfo CODE`)

                    await messenger.send(jid, parts.join('\n'))
                } catch (error) {
                    await handleCommandError(messenger, jid, error)
                }
                return
            }

            // ==================== BEST LINKS ====================
            if (PATTERNS.bestLinks.test(command)) {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                try {
                    const links = await LinkService.getBestPerformingLinks(phoneNumber)

                    if (!links || links.length === 0) {
                        await messenger.send(jid,
                            `🏆 NO ACTIVE LINKS\n\n` +
                            `Create your first link:\n` +
                            `createlink 2348012345678`
                        )
                        return
                    }

                    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣']
                    const parts = [`🏆 TOP PERFORMING LINKS\n`]
                    
                    links.forEach((link, index) => {
                        const medal = medals[index] || `${index + 1}.`
                        parts.push(
                            `${medal} ${link.short_code}`,
                            `   📊 ${link.total_clicks} clicks (${link.unique_clicks} unique)`,
                            `   📱 Target: ${link.target_phone}\n`
                        )
                    })
                    
                    parts.push(`${formatters.separator()}`)
                    parts.push(`💡 Get details: linkinfo CODE`)

                    await messenger.send(jid, parts.join('\n'))
                } catch (error) {
                    await handleCommandError(messenger, jid, error)
                }
                return
            }

            // ==================== WORST LINKS ====================
            if (PATTERNS.worstLinks.test(command)) {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                try {
                    const links = await LinkService.getLowestPerformingLinks(phoneNumber)

                    if (!links || links.length === 0) {
                        await messenger.send(jid,
                            `📉 NO ACTIVE LINKS\n\n` +
                            `Create your first link:\n` +
                            `createlink 2348012345678`
                        )
                        return
                    }

                    const parts = [
                        `📉 LOWEST PERFORMING LINKS\n`,
                        `Consider killing these to save tums:\n`
                    ]
                    
                    links.forEach((link, index) => {
                        parts.push(
                            `${index + 1}. ${link.short_code}`,
                            `   📊 ${link.total_clicks} clicks (${link.unique_clicks} unique)`,
                            `   📱 Target: ${link.target_phone}`,
                            `   💰 Costs ${LinkService.PRICING.DAILY_MAINTENANCE} tums/day\n`
                        )
                    })
                    
                    parts.push(formatters.quickActions([
                        `💡 Kill link: killlink CODE`,
                        `📊 Check stats: linkinfo CODE`
                    ]))

                    await messenger.send(jid, parts.join('\n'))
                } catch (error) {
                    await handleCommandError(messenger, jid, error)
                }
                return
            }

            // ==================== KILL LINK ====================
            if (PATTERNS.killLink.test(command)) {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                const shortCode = utils.safeGet(args, 0)
                
                if (!shortCode) {
                    await messenger.send(jid,
                        `🗑️ DELETE LINK\n\n` +
                        `Permanently deactivate a link.\n\n` +
                        `Usage: killlink SHORTCODE\n` +
                        `Example: killlink abc123\n\n` +
                        `⚠️ Cannot be undone!\n` +
                        `💰 Stops daily charges\n\n` +
                        `💡 See links: mylinks`
                    )
                    return
                }
                
                try {
                    await LinkService.killLink(phoneNumber, shortCode)
                    await messenger.send(jid,
                        `✅ LINK DELETED!\n\n` +
                        `🗑️ ${shortCode} is now inactive\n` +
                        `💰 No more daily charges\n` +
                        `📊 Click history preserved\n\n` +
                        `${formatters.separator()}\n` +
                        `See remaining: mylinks\n` +
                        `Create new: createlink PHONE`
                    )
                } catch (error) {
                    await handleCommandError(messenger, jid, error)
                }
                return
            }

            // ==================== COUPON ====================
            if (PATTERNS.coupon.test(command)) {
                const couponRateCheck = UserService.checkRateLimit(phoneNumber, 'coupon')
                if (!couponRateCheck.allowed) {
                    await messenger.send(jid,
                        `🎫 Please wait ${couponRateCheck.resetIn}s before trying another coupon.`
                    )
                    return
                }

                await UserService.softRegisterUser(phoneNumber, displayName)

                const couponCode = utils.safeGet(args, 0)
                
                if (!couponCode) {
                    await messenger.send(jid,
                        `🎫 REDEEM COUPON\n\n` +
                        `Usage: coupon CODE\n` +
                        `Example: coupon SAVE100\n\n` +
                        `${formatters.separator()}\n` +
                        `💡 WHERE TO FIND COUPONS?\n` +
                        `${formatters.separator()}\n` +
                        `📢 Check my WhatsApp status!\n` +
                        `👀 Stay tuned for new codes\n` +
                        `🔔 I post codes regularly\n\n` +
                        `⚠️ Codes are one-time use only!`
                    )
                    return
                }
                
                const codeValidation = validators.couponCode(couponCode)
                if (!codeValidation.valid) {
                    await messenger.send(jid, `❌ ${codeValidation.error}`)
                    return
                }
                
                try {
                    const result = await CouponService.redeemCoupon(phoneNumber, codeValidation.value)
                    
                    const parts = [
                        `🎉 COUPON REDEEMED!\n`,
                        `${formatters.separator()}`,
                        `Code: ${codeValidation.value}`,
                        `Reward: +${result.coupon.amount} tums`,
                        `New balance: ${result.newBalance} tums\n`,
                        `${formatters.separator()}`,
                        `💡 WHAT YOU CAN DO:`,
                        `${formatters.separator()}`,
                        `Create ${Math.floor(result.newBalance / LinkService.PRICING.CREATE_LINK)} links`,
                        `Or check ${Math.floor(result.newBalance / LinkService.PRICING.LINK_INFO_CHECK)} stats\n`,
                        `📢 Check my status for more codes!`,
                        `👀 Stay tuned for updates!`
                    ]
                    
                    await messenger.send(jid, parts.join('\n'))
                } catch (error) {
                    await handleCommandError(messenger, jid, error)
                }
                return
            }

            // ==================== HELP ====================
            if (PATTERNS.help.test(command)) {
                const { user } = await UserService.softRegisterUser(phoneNumber, displayName)
                const links = await LinkService.getUserLinks(phoneNumber, 'active')
                const walletStatus = calculators.walletStatus(user, links)
                
                await messenger.send(jid, messageBuilders.help(displayName, walletStatus))
                return
            }

            // ==================== GREETING ====================
            if (PATTERNS.greeting.test(command)) {
                const { user } = await UserService.softRegisterUser(phoneNumber, displayName)
                const balance = user.wallet_balance || 0
                
                const parts = [`👋 Hey ${displayName}!\n`]
                
                if (balance >= LinkService.PRICING.CREATE_LINK) {
                    parts.push(
                        `💰 You have ${balance} tums!\n`,
                        `Ready to create a link?`,
                        `Try: createlink 2348012345678\n`
                    )
                } else {
                    parts.push(
                        `💰 Balance: ${balance} tums\n`,
                        `Need tums? Get codes from:`,
                        `📢 My WhatsApp status`,
                        `👀 Stay tuned for new codes!\n`,
                        `Use: coupon CODE\n`
                    )
                }
                
                parts.push(`See all commands: help`)
                
                await messenger.send(jid, parts.join('\n'))
                return
            }

            // ==================== STATUS CHECK ====================
            if (PATTERNS.status.test(command)) {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                await messenger.send(jid,
                    `📢 COUPON CODES\n\n` +
                    `${formatters.separator()}\n` +
                    `💡 WHERE TO FIND CODES?\n` +
                    `${formatters.separator()}\n` +
                    `📱 Check my WhatsApp STATUS\n` +
                    `🔔 I post new codes regularly\n` +
                    `👀 Stay tuned for updates\n` +
                    `⚡ Codes expire fast - use quick!\n\n` +
                    `${formatters.separator()}\n` +
                    `💎 HOW TO USE:\n` +
                    `${formatters.separator()}\n` +
                    `coupon CODE\n\n` +
                    `Example: coupon SAVE100\n\n` +
                    `⚠️ Each code works once only!`
                )
                return
            }

            // ==================== FALLBACK ====================
            const { user } = await UserService.softRegisterUser(phoneNumber, displayName)
            const balance = user.wallet_balance || 0
            
            const fallbackParts = [
                `🤔 I didn't understand that.\n`,
                `${formatters.separator()}`,
                `⚡ QUICK COMMANDS:`,
                `${formatters.separator()}`,
                `help - See all commands`,
                `balance - Check tums (${balance}t)`
            ]
            
            if (balance >= LinkService.PRICING.CREATE_LINK) {
                fallbackParts.push(`createlink PHONE - Make link\n`)
                fallbackParts.push(`💡 You can create a link now!`)
            } else {
                fallbackParts.push(`coupon CODE - Get tums\n`)
                fallbackParts.push(`💡 GET COUPON CODES:`)
                fallbackParts.push(`📢 Check my WhatsApp status!`)
                fallbackParts.push(`👀 Stay tuned for codes!`)
            }
            
            await messenger.send(jid, fallbackParts.join('\n'))
            
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error:`, utils.sanitizeForLog({
                command: text.split(' ')[0],
                phoneNumber,
                errorType: error.constructor.name,
                message: error.message
            }))
            
            await messenger.send(jid,
                `❌ Oops! Something went wrong.\n\n` +
                `Please try again in 1 minute.\n\n` +
                `💡 If this keeps happening:\n` +
                `• Try: help\n` +
                `• Check command spelling\n` +
                `• Wait a moment and retry`
            ).catch(err => console.error(`[${new Date().toISOString()}] Failed to send error message:`, err.message))
        }
    }
}

module.exports = { handleMessage }