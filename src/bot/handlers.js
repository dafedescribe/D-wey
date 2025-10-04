const UserService = require('../services/userService')
const LinkService = require('../services/linkService')
const CouponService = require('../services/couponService')

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
            const command = text.toLowerCase().trim()

            // Rate limiting
            const rateLimitCheck = UserService.checkRateLimit(phoneNumber, 'general')
            if (!rateLimitCheck.allowed) {
                await sock.sendMessage(jid, { 
                    text: `⚠️ Too fast! Wait ${rateLimitCheck.resetIn} seconds.` 
                })
                return
            }

            // BALANCE CHECK
            if (command.match(/(balance|money|coins|tums|much.*have|check|wallet)/i)) {
                await UserService.softRegisterUser(phoneNumber, displayName)
                const user = await UserService.getUserByPhone(phoneNumber)
                
                const balance = user.wallet_balance || 0
                await sock.sendMessage(jid, { 
                    text: `💰 Balance: ${balance} tums\n\n🎫 Get more: coupon CODE` 
                })
                return
            }

            // CREATE LINK - createlink 2348012345678 hello|customcode
            if (command.startsWith('createlink ')) {
                const linkRateCheck = UserService.checkRateLimit(phoneNumber, 'createlink')
                if (!linkRateCheck.allowed) {
                    await sock.sendMessage(jid, { text: `⚠️ Wait ${linkRateCheck.resetIn}s` })
                    return
                }

                await UserService.softRegisterUser(phoneNumber, displayName)
                
                try {
                    const parts = text.split(' ')
                    if (parts.length < 2) {
                        await sock.sendMessage(jid, { 
                            text: `📝 Create link:\n\ncreatelink 2348012345678\nor\ncreatelink 2348012345678 Hello!|mycode\n\nCost: ${LinkService.PRICING.CREATE_LINK} tums` 
                        })
                        return
                    }

                    const targetPhone = parts[1]
                    let customMessage = null
                    let customCode = null

                    // Parse message and code (format: message|code)
                    if (parts.length > 2) {
                        const extraParts = parts.slice(2).join(' ')
                        if (extraParts.includes('|')) {
                            const [msg, code] = extraParts.split('|')
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

                    // Format expiry time in Nigeria timezone
                    const expiryTime = new Date(result.expiresAt).toLocaleString('en-GB', {
                        timeZone: 'Africa/Lagos',
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })

                    await sock.sendMessage(jid, { 
                        text: `✅ Link created!\n\n🔗 ${result.redirectUrl}\n📱 Target: ${targetPhone}\n💰 Cost: ${result.cost} tums\n⏰ Expires: ${expiryTime}\n\n📊 Check stats: linkinfo ${result.shortCode}` 
                    })

                } catch (error) {
                    await sock.sendMessage(jid, { text: `❌ ${error.message}` })
                }
                return
            }

            // LINK INFO - linkinfo shortcode (ENHANCED WITH FULL ANALYTICS)
            if (command.startsWith('linkinfo ')) {
                const parts = command.split(' ')
                if (parts.length < 2) {
                    await sock.sendMessage(jid, { text: `📊 Usage: linkinfo SHORTCODE` })
                    return
                }

                await UserService.softRegisterUser(phoneNumber, displayName)
                
                try {
                    const shortCode = parts[1]
                    const info = await LinkService.getLinkInfo(phoneNumber, shortCode)

                    const analytics = info.analytics
                    const link = info.link

                    let message = `📊 Link Analytics: ${link.shortCode}\n\n`
                    message += `🔗 ${link.redirectUrl}\n`
                    message += `📱 Target: ${link.targetPhone}\n`
                    if (link.temporalTarget) {
                        message += `⏰ Temporal: ${link.temporalTarget}\n`
                    }
                    message += `\n━━━━━━━━━━━━━━━━\n`
                    message += `📈 PERFORMANCE\n`
                    message += `━━━━━━━━━━━━━━━━\n`
                    message += `Total clicks: ${link.totalClicks}\n`
                    message += `Unique clicks: ${link.uniqueClicks}\n`
                    message += `Unique rate: ${analytics.uniqueClickRate}\n`
                    message += `Avg/day: ${analytics.averageClicksPerDay}\n`
                    
                    if (analytics.totalClicks > 0) {
                        message += `\n━━━━━━━━━━━━━━━━\n`
                        message += `⏰ TIME PATTERNS\n`
                        message += `━━━━━━━━━━━━━━━━\n`
                        message += `Peak hour: ${analytics.peakTime}\n`
                        message += `Peak day: ${analytics.peakDay} (${analytics.peakDayClicks} clicks)\n`
                        message += `Peak weekday: ${analytics.peakDayOfWeek} (${analytics.peakDayOfWeekClicks} clicks)\n`
                        
                        message += `\n━━━━━━━━━━━━━━━━\n`
                        message += `📅 ACTIVITY\n`
                        message += `━━━━━━━━━━━━━━━━\n`
                        message += `Active days: ${analytics.totalDays}\n`
                        message += `Active hours: ${analytics.activeHours}/24\n`
                        message += `Active weekdays: ${analytics.activeDaysOfWeek}/7\n`
                        
                        message += `\n━━━━━━━━━━━━━━━━\n`
                        message += `📊 DAY OF WEEK\n`
                        message += `━━━━━━━━━━━━━━━━\n`
                        Object.entries(analytics.clicksByDayOfWeek).forEach(([day, count]) => {
                            if (count > 0) {
                                const bar = '█'.repeat(Math.ceil(count / analytics.peakDayOfWeekClicks * 10))
                                message += `${day.substring(0,3)}: ${bar} ${count}\n`
                            }
                        })
                        
                        message += `\n━━━━━━━━━━━━━━━━\n`
                        message += `🕐 HOURLY PATTERN\n`
                        message += `━━━━━━━━━━━━━━━━\n`
                        
                        // Group hours into time periods
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
                                message += `${period}: ${periodClicks} (${percentage}%)\n`
                            }
                        })
                        
                        message += `\n━━━━━━━━━━━━━━━━\n`
                        message += `📅 TIMELINE\n`
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
                        message += `First: ${firstClick}\n`
                        message += `Last: ${lastClick}\n`
                    }
                    
                    message += `\n💰 Cost: ${LinkService.PRICING.LINK_INFO_CHECK} tums`

                    await sock.sendMessage(jid, { text: message })

                } catch (error) {
                    await sock.sendMessage(jid, { text: `❌ ${error.message}` })
                }
                return
            }

            // SET TEMPORAL TARGET - settemporal shortcode 2348012345678
            if (command.startsWith('settemporal ')) {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                try {
                    const parts = command.split(' ')
                    if (parts.length < 3) {
                        await sock.sendMessage(jid, { 
                            text: `⏰ Usage: settemporal SHORTCODE PHONE\n\nExample: settemporal abc123 2348012345678\n\nCost: ${LinkService.PRICING.SET_TEMPORAL_TARGET} tums` 
                        })
                        return
                    }

                    const shortCode = parts[1]
                    const temporalPhone = parts[2]

                    const result = await LinkService.setTemporalTarget(phoneNumber, shortCode, temporalPhone)

                    await sock.sendMessage(jid, { 
                        text: `✅ Temporal target set!\n\n🔗 Link: ${shortCode}\n⏰ Temporal: ${result.temporalTarget}\n\n💰 Cost: ${LinkService.PRICING.SET_TEMPORAL_TARGET} tums\n\nKill with: killtemporal ${shortCode}` 
                    })

                } catch (error) {
                    await sock.sendMessage(jid, { text: `❌ ${error.message}` })
                }
                return
            }

            // KILL TEMPORAL TARGET - killtemporal shortcode
            if (command.startsWith('killtemporal ')) {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                try {
                    const parts = command.split(' ')
                    if (parts.length < 2) {
                        await sock.sendMessage(jid, { 
                            text: `Usage: killtemporal SHORTCODE\n\nCost: ${LinkService.PRICING.KILL_TEMPORAL_TARGET} tums` 
                        })
                        return
                    }

                    const shortCode = parts[1]
                    await LinkService.killTemporalTarget(phoneNumber, shortCode)

                    await sock.sendMessage(jid, { 
                        text: `✅ Temporal target removed!\n\n🔗 Link: ${shortCode}\n💰 Cost: ${LinkService.PRICING.KILL_TEMPORAL_TARGET} tums` 
                    })

                } catch (error) {
                    await sock.sendMessage(jid, { text: `❌ ${error.message}` })
                }
                return
            }

            // MY LINKS - mylinks or mylinks active
            if (command.match(/^mylinks/i)) {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                try {
                    const filter = command.includes('active') ? 'active' : 'all'
                    const links = await LinkService.getUserLinks(phoneNumber, filter)

                    if (!links || links.length === 0) {
                        await sock.sendMessage(jid, { 
                            text: `No links found.\n\nCreate one: createlink 2348012345678` 
                        })
                        return
                    }

                    let message = `📋 My Links (${links.length}):\n\n`
                    links.slice(0, 10).forEach(link => {
                        message += `🔗 ${link.short_code}\n`
                        message += `   Clicks: ${link.total_clicks} (${link.unique_clicks} unique)\n`
                        message += `   Status: ${link.is_active ? '✅ Active' : '❌ Inactive'}\n\n`
                    })
                    message += `\nCheck stats: linkinfo CODE\nSearch: searchlinks TARGET`

                    await sock.sendMessage(jid, { text: message })

                } catch (error) {
                    await sock.sendMessage(jid, { text: `❌ ${error.message}` })
                }
                return
            }

            // SEARCH LINKS BY TARGET - searchlinks 2348012345678
            if (command.startsWith('searchlinks ')) {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                try {
                    const parts = command.split(' ')
                    if (parts.length < 2) {
                        await sock.sendMessage(jid, { 
                            text: `🔍 Usage: searchlinks PHONE\n\nExample: searchlinks 2348012345678` 
                        })
                        return
                    }

                    const targetPhone = parts[1]
                    const links = await LinkService.getLinksByTarget(phoneNumber, targetPhone)

                    if (!links || links.length === 0) {
                        await sock.sendMessage(jid, { text: `No links found for that number.` })
                        return
                    }

                    let message = `🔍 Links to ${targetPhone}:\n\n`
                    links.slice(0, 10).forEach(link => {
                        message += `🔗 ${link.short_code} - ${link.total_clicks} clicks\n`
                    })

                    await sock.sendMessage(jid, { text: message })

                } catch (error) {
                    await sock.sendMessage(jid, { text: `❌ ${error.message}` })
                }
                return
            }

            // BEST PERFORMING LINKS
            if (command.match(/^(best|top)/i)) {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                try {
                    const links = await LinkService.getBestPerformingLinks(phoneNumber)

                    if (!links || links.length === 0) {
                        await sock.sendMessage(jid, { text: `No active links yet.` })
                        return
                    }

                    let message = `🏆 Best Performing Links:\n\n`
                    links.forEach((link, index) => {
                        message += `${index + 1}. ${link.short_code}\n`
                        message += `   ${link.total_clicks} clicks (${link.unique_clicks} unique)\n\n`
                    })

                    await sock.sendMessage(jid, { text: message })

                } catch (error) {
                    await sock.sendMessage(jid, { text: `❌ ${error.message}` })
                }
                return
            }

            // LOWEST PERFORMING LINKS
            if (command.match(/^(worst|lowest|bottom)/i)) {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                try {
                    const links = await LinkService.getLowestPerformingLinks(phoneNumber)

                    if (!links || links.length === 0) {
                        await sock.sendMessage(jid, { text: `No active links yet.` })
                        return
                    }

                    let message = `📉 Lowest Performing Links:\n\n`
                    links.forEach((link, index) => {
                        message += `${index + 1}. ${link.short_code}\n`
                        message += `   ${link.total_clicks} clicks (${link.unique_clicks} unique)\n\n`
                    })

                    await sock.sendMessage(jid, { text: message })

                } catch (error) {
                    await sock.sendMessage(jid, { text: `❌ ${error.message}` })
                }
                return
            }

            // KILL LINK - killlink shortcode
            if (command.startsWith('killlink ')) {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                try {
                    const parts = command.split(' ')
                    if (parts.length < 2) {
                        await sock.sendMessage(jid, { text: `Usage: killlink SHORTCODE` })
                        return
                    }

                    const shortCode = parts[1]
                    await LinkService.killLink(phoneNumber, shortCode)

                    await sock.sendMessage(jid, { 
                        text: `✅ Link killed: ${shortCode}\n\nThe link is now permanently inactive.` 
                    })

                } catch (error) {
                    await sock.sendMessage(jid, { text: `❌ ${error.message}` })
                }
                return
            }

            // COUPON - coupon CODE
            if (command.startsWith('coupon ')) {
                const couponRateCheck = UserService.checkRateLimit(phoneNumber, 'coupon')
                if (!couponRateCheck.allowed) {
                    await sock.sendMessage(jid, { 
                        text: `🎫 Wait ${couponRateCheck.resetIn}s` 
                    })
                    return
                }

                await UserService.softRegisterUser(phoneNumber, displayName)

                const parts = command.split(' ')
                if (parts.length < 2) {
                    await sock.sendMessage(jid, { 
                        text: `🎫 Usage: coupon CODE\n\nExample: coupon SAVE100` 
                    })
                    return
                }

                const couponCode = parts[1].trim().toUpperCase()
                
                try {
                    const result = await CouponService.redeemCoupon(phoneNumber, couponCode)
                    
                    await sock.sendMessage(jid, { 
                        text: `🎉 Coupon redeemed!\n\n+${result.coupon.amount} tums\nNew balance: ${result.newBalance} tums` 
                    })

                } catch (error) {
                    await sock.sendMessage(jid, { text: `❌ ${error.message}` })
                }
                return
            }

            // HELP/MENU
            if (command.match(/(help|menu|commands|start|hi|hello)/i)) {
                await UserService.softRegisterUser(phoneNumber, displayName)
                
                await sock.sendMessage(jid, { 
                    text: `👋 Hey ${displayName}!\n\n📱 LINK COMMANDS:\n` +
                          `createlink PHONE - Create link (${LinkService.PRICING.CREATE_LINK} tums)\n` +
                          `linkinfo CODE - Check stats (${LinkService.PRICING.LINK_INFO_CHECK} tums)\n` +
                          `mylinks - View all links\n` +
                          `searchlinks PHONE - Find links\n` +
                          `best - Top performers\n` +
                          `worst - Low performers\n` +
                          `killlink CODE - Delete link\n\n` +
                          `⏰ TEMPORAL:\n` +
                          `settemporal CODE PHONE (${LinkService.PRICING.SET_TEMPORAL_TARGET} tums)\n` +
                          `killtemporal CODE (${LinkService.PRICING.KILL_TEMPORAL_TARGET} tums)\n\n` +
                          `💰 OTHER:\n` +
                          `balance - Check tums\n` +
                          `coupon CODE - Redeem coupon` 
                })
                return
            }

            // FALLBACK
            await UserService.softRegisterUser(phoneNumber, displayName)
            await sock.sendMessage(jid, { 
                text: `🤔 Try:\n\nhelp - See commands\nbalance - Check tums\ncreatelink PHONE - Make link` 
            })
            
        } catch (error) {
            console.error('Error:', error)
            await sock.sendMessage(jid, { 
                text: '❌ Something broke. Try again in 1 minute.' 
            })
        }
    }
}

module.exports = { handleMessage }