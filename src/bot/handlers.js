const UserService = require('../services/userService')
const LinkService = require('../services/linkService')
const CouponService = require('../services/couponService')
const IntentMatcher = require('../utils/intentMatcher')

function handleMessage(sock) {
    return async (m) => {
        const msg = m.messages[0]
        
        if (!msg?.message || 
            msg.key.remoteJid === 'status@broadcast' || 
            msg.key.fromMe) return

        if (m.type !== 'notify') return

        const text = msg.message?.conversation || 
                    msg.message?.extendedTextMessage?.text || ''
        
        const jid = msg.key.remoteJid
        const phoneNumber = jid.split('@')[0].replace(/\D/g, '')
        const displayName = msg.pushName || 'Friend'
        
        console.log(`${phoneNumber} (${displayName}): ${text}`)

        try {
            const command = text.trim()
            const intent = IntentMatcher.matchIntent(command)

            // Rate limiting
            const rateLimitCheck = UserService.checkRateLimit(phoneNumber, 'general')
            if (!rateLimitCheck.allowed) {
                await sock.sendMessage(jid, { 
                    text: `⏳ *Slow down a bit!*\n\nYou're sending messages too quickly. Please wait *${rateLimitCheck.resetIn} seconds* and try again.\n\nThis helps keep the bot running smoothly for everyone! 😊` 
                })
                return
            }

            // BALANCE CHECK
            if (intent === 'check_balance') {
                await UserService.softRegisterUser(phoneNumber, displayName)
                const user = await UserService.getUserByPhone(phoneNumber)
                
                const balance = user.wallet_balance || 0
                const recentTransactions = (user.transactions || []).slice(0, 3)
                
                let message = `💰 *Your Wallet Balance*\n\n`
                message += `You currently have: *${balance} tums*\n\n`
                
                if (recentTransactions.length > 0) {
                    message += `📊 *Recent Activity:*\n`
                    recentTransactions.forEach(tx => {
                        const emoji = tx.type === 'credit' ? '➕' : '➖'
                        const sign = tx.type === 'credit' ? '+' : '-'
                        message += `${emoji} ${sign}${tx.tums_amount} - ${tx.description}\n`
                    })
                    message += `\n`
                }
                
                message += `🎫 *Need more tums?*\nUse: *coupon CODE*\n\n`
                message += `💡 I post fresh coupon codes on my WhatsApp status daily! Check it out! 📱`
                
                await sock.sendMessage(jid, { text: message })
                return
            }

            // CREATE LINK
            if (intent === 'create_link') {
                const linkRateCheck = UserService.checkRateLimit(phoneNumber, 'createlink')
                if (!linkRateCheck.allowed) {
                    await sock.sendMessage(jid, { 
                        text: `⏳ Please wait *${linkRateCheck.resetIn} seconds* before creating another link.` 
                    })
                    return
                }

                await UserService.softRegisterUser(phoneNumber, displayName)
                
                try {
                    const parsed = parseCreateLinkCommand(command)
                    
                    if (!parsed.targetPhone) {
                        await sock.sendMessage(jid, { 
                            text: `📝 *How to Create a Link*\n\n` +
                                  `Just send the phone number you want the link to open:\n\n` +
                                  `*Example:*\n` +
                                  `create 08012345678\n\n` +
                                  `━━━━━━━━━━━━━━━━\n` +
                                  `*Want to customize?*\n\n` +
                                  `Add a message:\n` +
                                  `create 08012345678 Hello there!\n\n` +
                                  `Choose your own short link:\n` +
                                  `create 08012345678 / mylink\n` +
                                  `create 08012345678 | mylink\n\n` +
                                  `Do both:\n` +
                                  `create 08012345678 Hello! / mylink\n\n` +
                                  `Multi-line messages:\n` +
                                  `create 08012345678 Line 1\\nLine 2 / code\n\n` +
                                  `━━━━━━━━━━━━━━━━\n` +
                                  `💰 Cost: ${LinkService.PRICING.CREATE_LINK} tums\n` +
                                  `⏰ Links last 24 hours (renews daily)` 
                        })
                        return
                    }

                    // Check balance before proceeding
                    const user = await UserService.getUserByPhone(phoneNumber)
                    const cost = LinkService.PRICING.CREATE_LINK
                    
                    if (user.wallet_balance < cost) {
                        await sock.sendMessage(jid, {
                            text: `❌ *Not Enough Tums*\n\n` +
                                  `You need *${cost} tums* to create a link.\n` +
                                  `You have: *${user.wallet_balance} tums*\n\n` +
                                  `🎫 Get more tums with coupon codes!\n` +
                                  `Check my WhatsApp status daily for fresh codes! 📱`
                        })
                        return
                    }

                    const result = await LinkService.createWhatsAppLink(
                        phoneNumber,
                        parsed.targetPhone,
                        parsed.customCode,
                        parsed.customMessage
                    )

                    // Show balance after transaction
                    const updatedUser = await UserService.getUserByPhone(phoneNumber)
                    const newBalance = updatedUser.wallet_balance

                    const expiryTime = new Date(result.expiresAt).toLocaleString('en-GB', {
                        timeZone: 'Africa/Lagos',
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })

                    await sock.sendMessage(jid, { 
                        text: `✅ *Link Created Successfully!*\n\n` +
                              `🔗 *Your Link:*\n${result.redirectUrl}\n\n` +
                              `📱 Opens WhatsApp chat with: ${parsed.targetPhone}\n` +
                              `⏰ Active until: ${expiryTime}\n\n` +
                              `━━━━━━━━━━━━━━━━\n` +
                              `💰 *Payment:*\n` +
                              `Charged: ${result.cost} tums\n` +
                              `New balance: ${newBalance} tums\n\n` +
                              `━━━━━━━━━━━━━━━━\n` +
                              `📊 *Track Performance:*\n` +
                              `See clicks: *stats ${result.shortCode}*\n\n` +
                              `💡 Both you and ${parsed.targetPhone} can check this link's stats!` 
                    })

                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ *Oops! Something went wrong*\n\n${error.message}\n\n💡 Need help? Type *guide create* to see how to use this feature.` 
                    })
                }
                return
            }

            // LINK INFO/STATS
            if (intent === 'link_info') {
                const parsed = parseLinkInfoCommand(command)
                
                if (!parsed.shortCode) {
                    await sock.sendMessage(jid, { 
                        text: `📊 *How to Check Link Stats*\n\n` +
                              `To see how your link is performing, send:\n\n` +
                              `*stats LINKCODE*\n\n` +
                              `*Example:*\n` +
                              `stats abc123\n\n` +
                              `━━━━━━━━━━━━━━━━\n` +
                              `You'll see:\n` +
                              `• Total clicks\n` +
                              `• Unique visitors\n` +
                              `• Peak activity times\n` +
                              `• Daily patterns\n` +
                              `• And more!\n\n` +
                              `💰 Cost: ${LinkService.PRICING.LINK_INFO_CHECK} tums per check\n\n` +
                              `💡 Both you and your target can view stats!` 
                    })
                    return
                }

                await UserService.softRegisterUser(phoneNumber, displayName)
                
                try {
                    // Check balance first
                    const user = await UserService.getUserByPhone(phoneNumber)
                    if (user.wallet_balance < LinkService.PRICING.LINK_INFO_CHECK) {
                        await sock.sendMessage(jid, {
                            text: `❌ *Not Enough Tums*\n\n` +
                                  `You need *${LinkService.PRICING.LINK_INFO_CHECK} tums* to check stats.\n` +
                                  `You have: *${user.wallet_balance} tums*\n\n` +
                                  `🎫 Get more with: *coupon CODE*`
                        })
                        return
                    }

                    const info = await LinkService.getLinkInfo(phoneNumber, parsed.shortCode)
                    const analytics = info.analytics
                    const link = info.link

                    let message = `📊 *Link Performance Report*\n\n`
                    message += `🔗 Link: ${link.shortCode}\n`
                    message += `📱 Opens chat with: ${link.targetPhone}\n`
                    if (link.temporalTarget) {
                        message += `⏰ Currently redirecting to: ${link.temporalTarget}\n`
                    }
                    message += `\n━━━━━━━━━━━━━━━━\n`
                    message += `📈 *OVERALL PERFORMANCE*\n`
                    message += `━━━━━━━━━━━━━━━━\n`
                    message += `Total clicks: ${link.totalClicks}\n`
                    message += `Unique visitors: ${link.uniqueClicks}\n`
                    message += `Unique rate: ${analytics.uniqueClickRate}\n`
                    message += `Average per day: ${analytics.averageClicksPerDay}\n`
                    
                    if (analytics.totalClicks > 0) {
                        message += `\n━━━━━━━━━━━━━━━━\n`
                        message += `🕐 *BEST TIMES TO SHARE*\n`
                        message += `━━━━━━━━━━━━━━━━\n`
                        message += `Peak hour: ${analytics.peakTime}\n`
                        message += `Peak day: ${analytics.peakDay}\n`
                        message += `Best weekday: ${analytics.peakDayOfWeek}\n`
                        
                        message += `\n━━━━━━━━━━━━━━━━\n`
                        message += `📅 *DAILY ACTIVITY PATTERN*\n`
                        message += `━━━━━━━━━━━━━━━━\n`
                        Object.entries(analytics.clicksByDayOfWeek).forEach(([day, count]) => {
                            if (count > 0) {
                                const bar = '█'.repeat(Math.ceil(count / analytics.peakDayOfWeekClicks * 10))
                                message += `${day.substring(0,3)}: ${bar} ${count}\n`
                            }
                        })
                        
                        message += `\n━━━━━━━━━━━━━━━━\n`
                        message += `🕐 *TIME OF DAY*\n`
                        message += `━━━━━━━━━━━━━━━━\n`
                        
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
                                message += `${period}: ${periodClicks} clicks (${percentage}%)\n`
                            }
                        })
                        
                        message += `\n━━━━━━━━━━━━━━━━\n`
                        message += `📅 *TIMELINE*\n`
                        message += `━━━━━━━━━━━━━━━━\n`
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
                        message += `First click: ${firstClick}\n`
                        message += `Latest click: ${lastClick}\n`
                    }

                    // Show updated balance
                    const updatedUser = await UserService.getUserByPhone(phoneNumber)
                    message += `\n━━━━━━━━━━━━━━━━\n`
                    message += `💰 Charged ${LinkService.PRICING.LINK_INFO_CHECK} tums\n`
                    message += `New balance: ${updatedUser.wallet_balance} tums`

                    await sock.sendMessage(jid, { text: message })

                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ *Error*\n\n${error.message}` 
                    })
                }
                return
            }

            // SET TEMPORAL TARGET
            if (intent === 'set_temporal') {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                const parsed = parseTemporalCommand(command)
                
                if (!parsed.shortCode || !parsed.temporalPhone) {
                    await sock.sendMessage(jid, { 
                        text: `⏰ *Temporary Redirect Explained*\n\n` +
                              `This feature lets you temporarily send ALL clicks to a different number.\n\n` +
                              `*Perfect for:*\n` +
                              `• Testing ad performance with a third party\n` +
                              `• Verifying click quality\n` +
                              `• Temporary campaigns\n\n` +
                              `*How to use:*\n` +
                              `redirect LINKCODE PHONENUMBER\n\n` +
                              `*Example:*\n` +
                              `redirect abc123 08012345678\n\n` +
                              `━━━━━━━━━━━━━━━━\n` +
                              `💰 Cost: ${LinkService.PRICING.SET_TEMPORAL_TARGET} tums\n\n` +
                              `💡 Both you and the temporary number can see the stats!\n\n` +
                              `To remove it later:\n` +
                              `*stop redirect LINKCODE*` 
                    })
                    return
                }

                try {
                    // Check balance
                    const user = await UserService.getUserByPhone(phoneNumber)
                    if (user.wallet_balance < LinkService.PRICING.SET_TEMPORAL_TARGET) {
                        await sock.sendMessage(jid, {
                            text: `❌ *Not Enough Tums*\n\n` +
                                  `You need *${LinkService.PRICING.SET_TEMPORAL_TARGET} tums* for this.\n` +
                                  `You have: *${user.wallet_balance} tums*`
                        })
                        return
                    }

                    const result = await LinkService.setTemporalTarget(phoneNumber, parsed.shortCode, parsed.temporalPhone)

                    // Show updated balance
                    const updatedUser = await UserService.getUserByPhone(phoneNumber)

                    await sock.sendMessage(jid, { 
                        text: `✅ *Redirect Set Up!*\n\n` +
                              `🔗 Link: ${parsed.shortCode}\n` +
                              `⏰ Now redirecting to: ${result.temporalTarget}\n\n` +
                              `All clicks will go to this number until you remove the redirect.\n\n` +
                              `━━━━━━━━━━━━━━━━\n` +
                              `💰 Charged: ${LinkService.PRICING.SET_TEMPORAL_TARGET} tums\n` +
                              `New balance: ${updatedUser.wallet_balance} tums\n\n` +
                              `━━━━━━━━━━━━━━━━\n` +
                              `To remove this redirect:\n` +
                              `*stop redirect ${parsed.shortCode}*` 
                    })

                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ *Error*\n\n${error.message}` 
                    })
                }
                return
            }

            // KILL TEMPORAL TARGET
            if (intent === 'kill_temporal') {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                const parsed = parseKillTemporalCommand(command)
                
                if (!parsed.shortCode) {
                    await sock.sendMessage(jid, { 
                        text: `🛑 *Remove Temporary Redirect*\n\n` +
                              `This will stop the temporary redirect and return your link to its original target.\n\n` +
                              `*How to use:*\n` +
                              `stop redirect LINKCODE\n\n` +
                              `*Example:*\n` +
                              `stop redirect abc123\n\n` +
                              `💰 Cost: ${LinkService.PRICING.KILL_TEMPORAL_TARGET} tums` 
                    })
                    return
                }

                try {
                    // Check balance
                    const user = await UserService.getUserByPhone(phoneNumber)
                    if (user.wallet_balance < LinkService.PRICING.KILL_TEMPORAL_TARGET) {
                        await sock.sendMessage(jid, {
                            text: `❌ *Not Enough Tums*\n\n` +
                                  `You need *${LinkService.PRICING.KILL_TEMPORAL_TARGET} tums*.\n` +
                                  `You have: *${user.wallet_balance} tums*`
                        })
                        return
                    }

                    await LinkService.killTemporalTarget(phoneNumber, parsed.shortCode)

                    // Show updated balance
                    const updatedUser = await UserService.getUserByPhone(phoneNumber)

                    await sock.sendMessage(jid, { 
                        text: `✅ *Redirect Removed!*\n\n` +
                              `🔗 Link: ${parsed.shortCode}\n\n` +
                              `Your link is back to its original target number.\n\n` +
                              `━━━━━━━━━━━━━━━━\n` +
                              `💰 Charged: ${LinkService.PRICING.KILL_TEMPORAL_TARGET} tums\n` +
                              `New balance: ${updatedUser.wallet_balance} tums` 
                    })

                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ *Error*\n\n${error.message}` 
                    })
                }
                return
            }

            // MY LINKS
            if (intent === 'my_links') {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                try {
                    const filter = command.toLowerCase().includes('active') ? 'active' : 'all'
                    const links = await LinkService.getUserLinks(phoneNumber, filter)

                    if (!links || links.length === 0) {
                        await sock.sendMessage(jid, { 
                            text: `📋 *Your Links*\n\n` +
                                  `You don't have any links yet.\n\n` +
                                  `*Create your first link:*\n` +
                                  `create 08012345678\n\n` +
                                  `It's quick and easy! 🚀` 
                        })
                        return
                    }

                    // Categorize links
                    const createdByMe = links.filter(l => l.creator_phone === phoneNumber)
                    const sharedWithMe = links.filter(l => l.creator_phone !== phoneNumber)

                    let message = `📋 *Your Links Overview*\n\n`
                    message += `Total: ${links.length} link(s)\n`
                    message += `━━━━━━━━━━━━━━━━\n\n`

                    // Show created by me
                    if (createdByMe.length > 0) {
                        message += `👤 *Created by You* (${createdByMe.length})\n\n`
                        createdByMe.slice(0, 5).forEach((link, index) => {
                            message += `${index + 1}. *${link.short_code}*\n`
                            message += `   📊 ${link.total_clicks} clicks (${link.unique_clicks} unique)\n`
                            message += `   📱 Target: ${link.target_phone}\n`
                            message += `   ${link.is_active ? '✅ Active' : '❌ Inactive'}\n\n`
                        })
                        if (createdByMe.length > 5) {
                            message += `...and ${createdByMe.length - 5} more\n\n`
                        }
                    }

                    // Show shared with me
                    if (sharedWithMe.length > 0) {
                        message += `🔗 *Shared With You* (${sharedWithMe.length})\n\n`
                        sharedWithMe.slice(0, 5).forEach((link, index) => {
                            const relationship = link.target_phone === phoneNumber ? 'Target' : 
                                               link.temporal_target_phone === phoneNumber ? 'Temp Target' : 'Unknown'
                            message += `${index + 1}. *${link.short_code}*\n`
                            message += `   👤 Creator: ${link.creator_phone}\n`
                            message += `   🏷️ You are: ${relationship}\n`
                            message += `   📊 ${link.total_clicks} clicks\n`
                            message += `   ${link.is_active ? '✅ Active' : '❌ Inactive'}\n\n`
                        })
                        if (sharedWithMe.length > 5) {
                            message += `...and ${sharedWithMe.length - 5} more\n\n`
                        }
                    }
                    
                    message += `━━━━━━━━━━━━━━━━\n`
                    message += `💡 *Quick Actions:*\n`
                    message += `• See details: *stats LINKCODE*\n`
                    message += `• Find links: *find 08012345678*\n`
                    message += `• Reactivate: *reactivate LINKCODE*\n`
                    message += `• See top performers: *best*\n`
                    message += `• See low performers: *worst*`

                    await sock.sendMessage(jid, { text: message })

                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ *Error*\n\n${error.message}` 
                    })
                }
                return
            }

            // SEARCH LINKS BY TARGET OR CREATOR
            if (intent === 'search_links') {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                const parsed = parseSearchCommand(command)
                
                if (!parsed.searchPhone) {
                    await sock.sendMessage(jid, { 
                        text: `🔍 *Find Links by Number*\n\n` +
                              `This shows all your links related to a specific phone number.\n\n` +
                              `*How to use:*\n` +
                              `find PHONENUMBER\n\n` +
                              `*Example:*\n` +
                              `find 08012345678\n\n` +
                              `You'll see links where this number is:\n` +
                              `• The destination (target)\n` +
                              `• The creator` 
                    })
                    return
                }

                try {
                    const results = await LinkService.searchLinksByPhone(phoneNumber, parsed.searchPhone)

                    if (!results.asTarget.length && !results.asCreator.length) {
                        await sock.sendMessage(jid, { 
                            text: `🔍 *Search Results*\n\n` +
                                  `No links found for ${parsed.searchPhone}\n\n` +
                                  `*Create one:*\n` +
                                  `create ${parsed.searchPhone}` 
                        })
                        return
                    }

                    let message = `🔍 *Search Results for ${parsed.searchPhone}*\n\n`
                    
                    // Links where this number is the target
                    if (results.asTarget.length > 0) {
                        message += `📱 *As Destination* (${results.asTarget.length})\n`
                        message += `Links that open a chat with this number:\n\n`
                        
                        results.asTarget.slice(0, 5).forEach((link, index) => {
                            message += `${index + 1}. *${link.short_code}*\n`
                            message += `   📊 ${link.total_clicks} clicks\n`
                            message += `   ${link.is_active ? '✅ Active' : '❌ Inactive'}\n\n`
                        })
                        if (results.asTarget.length > 5) {
                            message += `...and ${results.asTarget.length - 5} more\n\n`
                        }
                    }

                    // Links created by this number
                    if (results.asCreator.length > 0) {
                        message += `👤 *Created By This Number* (${results.asCreator.length})\n`
                        message += `Links this person created:\n\n`
                        
                        results.asCreator.slice(0, 5).forEach((link, index) => {
                            message += `${index + 1}. *${link.short_code}*\n`
                            message += `   📱 Target: ${link.target_phone}\n`
                            message += `   📊 ${link.total_clicks} clicks\n`
                            message += `   ${link.is_active ? '✅ Active' : '❌ Inactive'}\n\n`
                        })
                        if (results.asCreator.length > 5) {
                            message += `...and ${results.asCreator.length - 5} more\n\n`
                        }
                    }

                    await sock.sendMessage(jid, { text: message })

                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ *Error*\n\n${error.message}` 
                    })
                }
                return
            }

            // BEST PERFORMING LINKS
            if (intent === 'best_links') {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                try {
                    const links = await LinkService.getBestPerformingLinks(phoneNumber)

                    if (!links || links.length === 0) {
                        await sock.sendMessage(jid, { 
                            text: `🏆 *Top Performers*\n\n` +
                                  `No active links yet.\n\n` +
                                  `Create one: *create 08012345678*` 
                        })
                        return
                    }

                    let message = `🏆 *Your Top Performing Links*\n\n`
                    message += `These are getting the most clicks:\n\n`
                    
                    links.forEach((link, index) => {
                        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`
                        message += `${medal} *${link.short_code}*\n`
                        message += `   📊 ${link.total_clicks} clicks (${link.unique_clicks} unique)\n\n`
                    })
                    
                    message += `💡 Check details: *stats LINKCODE*`

                    await sock.sendMessage(jid, { text: message })

                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ *Error*\n\n${error.message}` 
                    })
                }
                return
            }

            // LOWEST PERFORMING LINKS
            if (intent === 'worst_links') {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                try {
                    const links = await LinkService.getLowestPerformingLinks(phoneNumber)

                    if (!links || links.length === 0) {
                        await sock.sendMessage(jid, { 
                            text: `📉 *Low Performers*\n\n` +
                                  `No active links yet.` 
                        })
                        return
                    }

                    let message = `📉 *Links That Need Attention*\n\n`
                    message += `These links are getting fewer clicks:\n\n`
                    
                    links.forEach((link, index) => {
                        message += `${index + 1}. *${link.short_code}*\n`
                        message += `   📊 ${link.total_clicks} clicks (${link.unique_clicks} unique)\n\n`
                    })
                    
                    message += `💡 *Tips to improve:*\n`
                    message += `• Share in more places\n`
                    message += `• Share at peak times (check stats)\n`
                    message += `• Try different messages`

                    await sock.sendMessage(jid, { text: message })

                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ *Error*\n\n${error.message}` 
                    })
                }
                return
            }

            // REACTIVATE LINK
            if (intent === 'reactivate_link') {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                const parsed = parseReactivateLinkCommand(command)
                
                if (!parsed.shortCode) {
                    await sock.sendMessage(jid, { 
                        text: `♻️ *Reactivate a Link*\n\n` +
                              `Bring an inactive link back to life!\n\n` +
                              `*How to use:*\n` +
                              `reactivate LINKCODE\n\n` +
                              `*Example:*\n` +
                              `reactivate abc123\n\n` +
                              `━━━━━━━━━━━━━━━━\n` +
                              `💰 Cost: ${LinkService.PRICING.REACTIVATE_LINK} tums\n\n` +
                              `📝 The link will be active for 24 hours and resume daily renewals.` 
                    })
                    return
                }

                try {
                    // Check balance
                    const user = await UserService.getUserByPhone(phoneNumber)
                    if (user.wallet_balance < LinkService.PRICING.REACTIVATE_LINK) {
                        await sock.sendMessage(jid, {
                            text: `❌ *Not Enough Tums*\n\n` +
                                  `You need *${LinkService.PRICING.REACTIVATE_LINK} tums* to reactivate.\n` +
                                  `You have: *${user.wallet_balance} tums*\n\n` +
                                  `🎫 Get more with: *coupon CODE*`
                        })
                        return
                    }

                    const result = await LinkService.reactivateLink(phoneNumber, parsed.shortCode)

                    // Show updated balance
                    const updatedUser = await UserService.getUserByPhone(phoneNumber)

                    const expiryTime = new Date(result.expiresAt).toLocaleString('en-GB', {
                        timeZone: 'Africa/Lagos',
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })

                    await sock.sendMessage(jid, { 
                        text: `✅ *Link Reactivated!*\n\n` +
                              `🔗 Link: ${result.shortCode}\n` +
                              `📱 Target: ${result.targetPhone}\n` +
                              `⏰ Active until: ${expiryTime}\n\n` +
                              `Your link is now active and will resume daily renewals!\n\n` +
                              `━━━━━━━━━━━━━━━━\n` +
                              `💰 Charged: ${LinkService.PRICING.REACTIVATE_LINK} tums\n` +
                              `New balance: ${updatedUser.wallet_balance} tums\n\n` +
                              `🔗 ${result.redirectUrl}` 
                    })

                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ *Error*\n\n${error.message}` 
                    })
                }
                return
            }

            // KILL LINK
            if (intent === 'kill_link') {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                const parsed = parseKillLinkCommand(command)
                
                if (!parsed.shortCode) {
                    await sock.sendMessage(jid, { 
                        text: `🗑️ *Delete a Link*\n\n` +
                              `This permanently deactivates a link.\n\n` +
                              `*How to use:*\n` +
                              `delete LINKCODE\n\n` +
                              `*Example:*\n` +
                              `delete abc123\n\n` +
                              `⚠️ This cannot be undone!\n\n` +
                              `💡 To temporarily deactivate, just let it expire or use *reactivate* later.` 
                    })
                    return
                }

                try {
                    await LinkService.killLink(phoneNumber, parsed.shortCode)

                    await sock.sendMessage(jid, { 
                        text: `✅ *Link Deleted*\n\n` +
                              `🔗 ${parsed.shortCode}\n\n` +
                              `This link is now permanently inactive. Anyone who clicks it will see an error message.\n\n` +
                              `💡 Want it back? You can reactivate it with: *reactivate ${parsed.shortCode}*` 
                    })

                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ *Error*\n\n${error.message}` 
                    })
                }
                return
            }

            // COUPON
            if (intent === 'redeem_coupon') {
                const couponRateCheck = UserService.checkRateLimit(phoneNumber, 'coupon')
                if (!couponRateCheck.allowed) {
                    await sock.sendMessage(jid, { 
                        text: `⏳ Please wait *${couponRateCheck.resetIn} seconds* before trying another coupon.` 
                    })
                    return
                }

                await UserService.softRegisterUser(phoneNumber, displayName)

                const parsed = parseCouponCommand(command)
                
                if (!parsed.code) {
                    await sock.sendMessage(jid, { 
                        text: `🎫 *Redeem a Coupon*\n\n` +
                              `Get free tums with coupon codes!\n\n` +
                              `*How to use:*\n` +
                              `coupon CODE\n\n` +
                              `*Example:*\n` +
                              `coupon SAVE100\n\n` +
                              `━━━━━━━━━━━━━━━━\n` +
                              `📱 *Where to find codes?*\n` +
                              `I post fresh coupon codes on my WhatsApp status DAILY!\n\n` +
                              `Check my status regularly for free tums! 🎁` 
                    })
                    return
                }
                
                try {
                    const result = await CouponService.redeemCoupon(phoneNumber, parsed.code)
                    
                    await sock.sendMessage(jid, { 
                        text: `🎉 *Coupon Redeemed!*\n\n` +
                              `Code: ${parsed.code}\n` +
                              `You received: *+${result.coupon.amount} tums*\n\n` +
                              `━━━━━━━━━━━━━━━━\n` +
                              `💰 *Your Balance:*\n` +
                              `New balance: *${result.newBalance} tums*\n\n` +
                              `🎁 Check my status daily for more codes!` 
                    })

                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ *Coupon Error*\n\n${error.message}\n\n💡 Check my WhatsApp status for valid codes!` 
                    })
                }
                return
            }

            // HELP OVERVIEW
            if (intent === 'help_overview') {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                await sock.sendMessage(jid, { 
                    text: `👋 *Welcome ${displayName}!*\n\n` +
                          `I help you create short WhatsApp links that you can track and manage.\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `🚀 *QUICK START*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `*Create a link:*\n` +
                          `create 08012345678\n\n` +
                          `*Check your balance:*\n` +
                          `balance\n\n` +
                          `*Get free tums:*\n` +
                          `coupon CODE\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `📚 *LEARN MORE*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `Type any of these for detailed guides:\n\n` +
                          `*guide create* - How to make links\n` +
                          `*guide stats* - Track performance\n` +
                          `*guide redirect* - Temporary redirects\n` +
                          `*guide manage* - Manage your links\n` +
                          `*guide tums* - About tums & coupons\n` +
                          `*commands* - See all commands\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `💰 *PRICING*\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `Create link: ${LinkService.PRICING.CREATE_LINK} tums\n` +
                          `Daily renewal: ${LinkService.PRICING.DAILY_MAINTENANCE} tums\n` +
                          `Reactivate link: ${LinkService.PRICING.REACTIVATE_LINK} tums\n` +
                          `Check stats: ${LinkService.PRICING.LINK_INFO_CHECK} tums\n` +
                          `Set redirect: ${LinkService.PRICING.SET_TEMPORAL_TARGET} tums\n\n` +
                          `🎁 New users get ${UserService.SIGNUP_BONUS} free tums!\n` +
                          `📱 Check my status daily for coupon codes!`
                })
                return
            }

            // GUIDE: CREATE LINKS
            if (intent === 'guide_create') {
                await sock.sendMessage(jid, {
                    text: `📝 *Guide: Creating Links*\n\n` +
                          `A link is a short URL that opens a WhatsApp chat with any number you choose.\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `🎯 *WHY USE LINKS?*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `• Share one easy link instead of a long number\n` +
                          `• Track how many people clicked\n` +
                          `• See when people are most active\n` +
                          `• Know if your ads are working\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `✨ *BASIC USAGE*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `*Simple link:*\n` +
                          `create 08012345678\n\n` +
                          `You'll get something like:\n` +
                          `d-wey.com/abc123\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `🎨 *CUSTOMIZE IT*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `*Add a custom message:*\n` +
                          `create 08012345678 Hi! I saw your ad\n\n` +
                          `When someone clicks, WhatsApp opens with your message already typed!\n\n` +
                          `*Choose your own link:*\n` +
                          `create 08012345678 / myshop\n` +
                          `create 08012345678 | myshop\n\n` +
                          `You'll get: d-wey.com/myshop\n\n` +
                          `*Do both:*\n` +
                          `create 08012345678 Hello! / myshop\n\n` +
                          `*Multi-line messages:*\n` +
                          `create 08012345678 Line 1\\nLine 2\\nLine 3 / code\n\n` +
                          `The \\n creates a line break in the message!\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `💡 *IMPORTANT NOTES*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `• Links cost ${LinkService.PRICING.CREATE_LINK} tums to create\n` +
                          `• They renew daily for ${LinkService.PRICING.DAILY_MAINTENANCE} tums\n` +
                          `• Both you AND your target can check stats\n` +
                          `• If balance runs low, link stops working\n` +
                          `• Reactivate anytime for ${LinkService.PRICING.REACTIVATE_LINK} tums\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `📖 *MORE GUIDES*\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `*guide stats* - Track performance\n` +
                          `*guide manage* - Manage links\n` +
                          `*help* - Back to main menu`
                })
                return
            }

            // GUIDE: STATS
            if (intent === 'guide_stats') {
                await sock.sendMessage(jid, {
                    text: `📊 *Guide: Tracking Performance*\n\n` +
                          `See exactly how your links are performing with detailed statistics.\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `🔍 *VIEW STATS*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `*For any link:*\n` +
                          `stats LINKCODE\n\n` +
                          `*Example:*\n` +
                          `stats abc123\n\n` +
                          `Cost: ${LinkService.PRICING.LINK_INFO_CHECK} tums per check\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `📈 *WHAT YOU'LL SEE*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `*Click Data:*\n` +
                          `• Total clicks (all visits)\n` +
                          `• Unique clicks (different people)\n` +
                          `• Average clicks per day\n\n` +
                          `*Best Times:*\n` +
                          `• Peak hour (when most people click)\n` +
                          `• Peak day (best performing date)\n` +
                          `• Peak weekday (best day of week)\n\n` +
                          `*Activity Patterns:*\n` +
                          `• Morning vs evening performance\n` +
                          `• Weekend vs weekday clicks\n` +
                          `• Hour-by-hour breakdown\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `💡 *WHO CAN VIEW?*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `Both people can check stats:\n` +
                          `✅ You (the creator)\n` +
                          `✅ The target number\n` +
                          `✅ Temporary redirect number (if set)\n\n` +
                          `This is perfect for:\n` +
                          `• Advertisers showing results to clients\n` +
                          `• Partners tracking joint campaigns\n` +
                          `• Verifying ad performance with buyers\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `📋 *OTHER COMMANDS*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `*See all your links:*\n` +
                          `links\n\n` +
                          `*Find best performers:*\n` +
                          `best\n\n` +
                          `*Find low performers:*\n` +
                          `worst\n\n` +
                          `*Search by number:*\n` +
                          `find 08012345678\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `📖 *MORE GUIDES*\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `*guide create* - Make links\n` +
                          `*guide redirect* - Temporary redirects\n` +
                          `*help* - Back to main menu`
                })
                return
            }

            // GUIDE: REDIRECT
            if (intent === 'guide_redirect') {
                await sock.sendMessage(jid, {
                    text: `⏰ *Guide: Temporary Redirects*\n\n` +
                          `Send all your link's clicks to a different number temporarily.\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `🎯 *WHY USE THIS?*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `*Perfect for advertisers:*\n` +
                          `• Let clients verify ad performance\n` +
                          `• Show real-time click proof\n` +
                          `• Test different target numbers\n\n` +
                          `*Example scenario:*\n` +
                          `You sell ads. Your client wants proof the ads are working. Set a temporary redirect to their number so they can see the messages coming in!\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `✨ *HOW TO USE*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `*Set redirect:*\n` +
                          `redirect LINKCODE PHONENUMBER\n\n` +
                          `*Example:*\n` +
                          `redirect abc123 08012345678\n\n` +
                          `Cost: ${LinkService.PRICING.SET_TEMPORAL_TARGET} tums\n\n` +
                          `*Remove redirect:*\n` +
                          `stop redirect LINKCODE\n\n` +
                          `*Example:*\n` +
                          `stop redirect abc123\n\n` +
                          `Cost: ${LinkService.PRICING.KILL_TEMPORAL_TARGET} tums\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `📊 *IMPORTANT NOTES*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `• Original target is NOT notified\n` +
                          `• All three parties can view stats:\n` +
                          `  - You (creator)\n` +
                          `  - Original target\n` +
                          `  - Temporary target\n\n` +
                          `• Only one redirect at a time\n` +
                          `• Remove old redirect before setting new one\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `💡 *PRO TIP*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `Use this to prove your advertising works! Show clients real messages coming in from your ads.\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `📖 *MORE GUIDES*\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `*guide create* - Make links\n` +
                          `*guide stats* - Track performance\n` +
                          `*help* - Back to main menu`
                })
                return
            }

            // GUIDE: MANAGE
            if (intent === 'guide_manage') {
                await sock.sendMessage(jid, {
                    text: `🔧 *Guide: Managing Your Links*\n\n` +
                          `View, organize, and delete your links easily.\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `📋 *VIEW ALL LINKS*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `*See everything:*\n` +
                          `links\n\n` +
                          `*See only active:*\n` +
                          `links active\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `🔍 *FIND SPECIFIC LINKS*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `*Find links by number:*\n` +
                          `find 08012345678\n\n` +
                          `Shows links where this number is the destination OR creator!\n\n` +
                          `*See best performers:*\n` +
                          `best\n\n` +
                          `*See worst performers:*\n` +
                          `worst\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `♻️ *REACTIVATE LINKS*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `*Bring a link back:*\n` +
                          `reactivate LINKCODE\n\n` +
                          `*Example:*\n` +
                          `reactivate abc123\n\n` +
                          `Cost: ${LinkService.PRICING.REACTIVATE_LINK} tums\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `🗑️ *DELETE LINKS*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `*Permanently delete:*\n` +
                          `delete LINKCODE\n\n` +
                          `*Example:*\n` +
                          `delete abc123\n\n` +
                          `⚠️ Can be reactivated later!\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `💰 *ABOUT RENEWALS*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `• Links renew automatically every 24 hours\n` +
                          `• Costs ${LinkService.PRICING.DAILY_MAINTENANCE} tums per day\n` +
                          `• If balance is low, link stops working\n` +
                          `• Keep enough tums for your active links!\n\n` +
                          `*Calculate daily cost:*\n` +
                          `Number of links × ${LinkService.PRICING.DAILY_MAINTENANCE} tums\n\n` +
                          `Example: 5 links = ${5 * LinkService.PRICING.DAILY_MAINTENANCE} tums per day\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `📖 *MORE GUIDES*\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `*guide create* - Make links\n` +
                          `*guide tums* - About currency\n` +
                          `*help* - Back to main menu`
                })
                return
            }

            // GUIDE: TUMS
            if (intent === 'guide_tums') {
                await sock.sendMessage(jid, {
                    text: `💰 *Guide: Tums & Coupons*\n\n` +
                          `Everything about the currency that powers this service.\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `💵 *WHAT ARE TUMS?*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `Tums are the virtual currency used to pay for features.\n\n` +
                          `*Pricing:*\n` +
                          `• Create link: ${LinkService.PRICING.CREATE_LINK} tums\n` +
                          `• Daily renewal: ${LinkService.PRICING.DAILY_MAINTENANCE} tums\n` +
                          `• Reactivate link: ${LinkService.PRICING.REACTIVATE_LINK} tums\n` +
                          `• Check stats: ${LinkService.PRICING.LINK_INFO_CHECK} tums\n` +
                          `• Set redirect: ${LinkService.PRICING.SET_TEMPORAL_TARGET} tums\n` +
                          `• Remove redirect: ${LinkService.PRICING.KILL_TEMPORAL_TARGET} tums\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `🎁 *FREE TUMS*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `*Welcome bonus:*\n` +
                          `New users get ${UserService.SIGNUP_BONUS} free tums automatically!\n\n` +
                          `*Daily coupons:*\n` +
                          `I post coupon codes on my WhatsApp status EVERY DAY! 📱\n\n` +
                          `Follow these steps:\n` +
                          `1. Check my WhatsApp status\n` +
                          `2. Find the coupon code\n` +
                          `3. Send: coupon CODE\n` +
                          `4. Get free tums instantly!\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `🎫 *USING COUPONS*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `*Redeem a code:*\n` +
                          `coupon CODE\n\n` +
                          `*Example:*\n` +
                          `coupon SAVE100\n\n` +
                          `*Check your balance:*\n` +
                          `balance\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `📊 *TRACK YOUR SPENDING*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `Your balance shows recent transactions:\n` +
                          `• See what you spent tums on\n` +
                          `• Track coupon redemptions\n` +
                          `• Monitor daily renewals\n\n` +
                          `Type *balance* anytime to check!\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `💡 *TIPS TO SAVE TUMS*\n` +
                          `━━━━━━━━━━━━━━━━\n\n` +
                          `• Delete links you're not using\n` +
                          `• Check my status daily for coupons\n` +
                          `• Only check stats when needed\n` +
                          `• Share your best performing links\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `📖 *MORE GUIDES*\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `*guide manage* - Manage links\n` +
                          `*guide create* - Make links\n` +
                          `*help* - Back to main menu`
                })
                return
            }

            // COMMANDS LIST
            if (intent === 'commands_list') {
                await sock.sendMessage(jid, {
                    text: `⚡ *All Commands*\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `📱 *CREATE & MANAGE*\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `create NUMBER - Make new link\n` +
                          `links - See all your links\n` +
                          `links active - Active links only\n` +
                          `reactivate CODE - Bring link back\n` +
                          `delete CODE - Remove a link\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `📊 *TRACK PERFORMANCE*\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `stats CODE - Detailed analytics\n` +
                          `best - Top performers\n` +
                          `worst - Low performers\n` +
                          `find NUMBER - Search by number\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `⏰ *TEMPORARY REDIRECTS*\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `redirect CODE NUMBER - Set redirect\n` +
                          `stop redirect CODE - Remove redirect\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `💰 *WALLET*\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `balance - Check tums\n` +
                          `coupon CODE - Redeem coupon\n\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `📚 *HELP & GUIDES*\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `help - Main menu\n` +
                          `guide create - Link creation guide\n` +
                          `guide stats - Tracking guide\n` +
                          `guide redirect - Redirect guide\n` +
                          `guide manage - Management guide\n` +
                          `guide tums - Currency guide\n` +
                          `commands - This list\n\n` +
                          `💡 Type any command to see detailed help!`
                })
                return
            }

            // FALLBACK - BETTER ERROR HANDLING
            await UserService.softRegisterUser(phoneNumber, displayName)
            
            // Try to give helpful suggestions based on what they typed
            const suggestions = getSuggestions(command)
            
            await sock.sendMessage(jid, { 
                text: `🤔 *I didn't understand that*\n\n` +
                      `${suggestions}\n\n` +
                      `━━━━━━━━━━━━━━━━\n` +
                      `💡 *Need help?*\n` +
                      `Type *help* for the main menu\n` +
                      `Type *commands* to see all options`
            })
            
        } catch (error) {
            console.error('Error:', error)
            await sock.sendMessage(jid, { 
                text: `❌ *Something Went Wrong*\n\n` +
                      `I encountered a technical error. This is usually temporary.\n\n` +
                      `*What to do:*\n` +
                      `• Wait 1-2 minutes\n` +
                      `• Try your command again\n` +
                      `• If it keeps happening, type *help*\n\n` +
                      `Sorry for the inconvenience! 🙏`
            })
        }
    }
}

// Parse create link command - supports /, |, and properly handles \n for line breaks
function parseCreateLinkCommand(text) {
    const cleanText = text.trim()
    const parts = cleanText.split(/\s+/)
    
    if (parts.length < 2) {
        return { targetPhone: null }
    }

    const targetPhone = parts[1]
    
    // Check for custom code with / or |
    let customCode = null
    let customMessage = null
    
    const restOfText = parts.slice(2).join(' ')
    
    // Check for / or | separator
    if (restOfText.includes('/')) {
        const splitIndex = restOfText.indexOf('/')
        customMessage = restOfText.substring(0, splitIndex).trim() || null
        customCode = restOfText.substring(splitIndex + 1).trim() || null
    } else if (restOfText.includes('|')) {
        const splitIndex = restOfText.indexOf('|')
        customMessage = restOfText.substring(0, splitIndex).trim() || null
        customCode = restOfText.substring(splitIndex + 1).trim() || null
    } else if (restOfText) {
        customMessage = restOfText.trim()
    }

    // Handle newline escapes in message - convert \n to actual newlines
    if (customMessage) {
        customMessage = customMessage.replace(/\\n/g, '\n')
    }

    return { targetPhone, customCode, customMessage }
}

// Parse link info command
function parseLinkInfoCommand(text) {
    const parts = text.trim().split(/\s+/)
    return { shortCode: parts[1] || null }
}

// Parse temporal command
function parseTemporalCommand(text) {
    const parts = text.trim().split(/\s+/)
    return { 
        shortCode: parts[1] || null, 
        temporalPhone: parts[2] || null 
    }
}

// Parse kill temporal command
function parseKillTemporalCommand(text) {
    const parts = text.trim().split(/\s+/)
    // Handle "stop redirect CODE" format
    if (parts.length >= 3 && parts[1].toLowerCase().includes('redirect')) {
        return { shortCode: parts[2] || null }
    }
    return { shortCode: parts[1] || null }
}

// Parse search command
function parseSearchCommand(text) {
    const parts = text.trim().split(/\s+/)
    return { searchPhone: parts[1] || null }
}

// Parse kill link command
function parseKillLinkCommand(text) {
    const parts = text.trim().split(/\s+/)
    return { shortCode: parts[1] || null }
}

// Parse reactivate link command
function parseReactivateLinkCommand(text) {
    const parts = text.trim().split(/\s+/)
    return { shortCode: parts[1] || null }
}

// Parse coupon command
function parseCouponCommand(text) {
    const parts = text.trim().split(/\s+/)
    return { code: parts[1] || null }
}

// Get helpful suggestions based on what user typed
function getSuggestions(text) {
    const lower = text.toLowerCase()
    
    if (lower.includes('link') || lower.includes('create') || lower.includes('make')) {
        return `Did you want to create a link?\nTry: *create 08012345678*`
    }
    
    if (lower.includes('balance') || lower.includes('money') || lower.includes('tums')) {
        return `Check your balance with: *balance*`
    }
    
    if (lower.includes('stat') || lower.includes('track') || lower.includes('click')) {
        return `Check link stats with: *stats LINKCODE*`
    }
    
    if (lower.includes('coupon') || lower.includes('code') || lower.includes('free')) {
        return `Redeem a coupon with: *coupon CODE*\n📱 Check my status for fresh codes!`
    }
    
    if (lower.includes('redirect') || lower.includes('temporal') || lower.includes('change')) {
        return `Set up a redirect with: *redirect LINKCODE NUMBER*`
    }

    if (lower.includes('reactivate') || lower.includes('activate') || lower.includes('enable')) {
        return `Reactivate a link with: *reactivate LINKCODE*`
    }
    
    if (lower.match(/\d{10,}/)) {
        return `Did you want to create a link to this number?\nTry: *create ${lower.match(/\d{10,}/)[0]}*`
    }
    
    return `I'm not sure what you mean.\n\n*Common commands:*\n• *create 08012345678* - Make a link\n• *balance* - Check tums\n• *help* - See full menu`
}

module.exports = { handleMessage }