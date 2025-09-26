// FIXED VERSION - Key issues resolved:
// 1. Fixed case sensitivity with better command parsing
// 2. Fixed ownership verification queries
// 3. Added better error handling
// 4. Fixed command splitting logic

const UserService = require('../services/userService')
const PaymentService = require('../services/paymentService')
const CouponService = require('../services/couponService')
const LinkService = require('../services/linkService')
const AnalyticsService = require('../services/analyticsService')

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
        
        console.log(`📨 ${phoneNumber} (${displayName}): ${text}`)

        try {
            // FIXED: Better command parsing - normalize spaces and case
            const normalizedText = text.trim().replace(/\s+/g, ' ')
            const command = normalizedText.toLowerCase()
            const parts = normalizedText.split(' ').filter(p => p.length > 0)

            console.log(`🔧 Debug - Original: "${text}" | Command: "${command}" | Parts:`, parts)

            // Rate limiting
            const rateLimitCheck = UserService.checkRateLimit(phoneNumber, 'general')
            if (!rateLimitCheck.allowed) {
                await sock.sendMessage(jid, { 
                    text: `⚠️ Too fast! Wait ${rateLimitCheck.resetIn} seconds.` 
                })
                return
            }

            // EMAIL DETECTION - Same as before
            if (UserService.isValidEmail(text.trim())) {
                const emailRateCheck = UserService.checkRateLimit(phoneNumber, 'email')
                if (!emailRateCheck.allowed) {
                    await sock.sendMessage(jid, { text: `⚠️ Wait ${emailRateCheck.resetIn}s then try again.` })
                    return
                }

                const email = text.trim().toLowerCase()
                
                try {
                    const isEmailTaken = await UserService.isEmailTaken(email)
                    if (isEmailTaken) {
                        await sock.sendMessage(jid, { 
                            text: '❌ Email already used. Try a different one.' 
                        })
                        return
                    }

                    const result = await UserService.storeUserEmail(phoneNumber, displayName, email)
                    
                    if (result.isNew) {
                        await sock.sendMessage(jid, { 
                            text: `✅ Welcome to d-wey ${displayName}!\n\n🎁 You got 1000 free tums!\n\n*How to Create Links:*\n• Send phone number: +2348012345678\n• Custom link: link +2348012345678 mycode\n\n*Other Commands:*\n• help - Full menu\n• balance - Check tums\n• my links - View your links\n\nLet's create your first link! 🚀` 
                        })
                    } else {
                        if (result.user.email) {
                            await sock.sendMessage(jid, { 
                                text: `❌ Can't change email.\nYour email: ${result.user.email}\nBalance: ${result.user.wallet_balance || 0} tums\n\nSend "help" for available commands.` 
                            })
                        } else {
                            await sock.sendMessage(jid, { 
                                text: `✅ Welcome back to d-wey!\nBalance: ${result.user.wallet_balance || 0} tums\n\nSend "help" to see what's new!` 
                            })
                        }
                    }
                } catch (error) {
                    await sock.sendMessage(jid, { text: '❌ Something went wrong. Try again.' })
                }
                return
            }

            // ANALYTICS REQUEST - FIXED with better parsing and error handling
            if (command.startsWith('report ') || (parts.length === 2 && parts[0].toLowerCase() === 'report')) {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { text: '📧 Register with email first!' })
                    return
                }

                // FIXED: Better shortcode extraction
                let shortCode
                if (parts.length >= 2) {
                    shortCode = parts[1].trim()
                } else {
                    await sock.sendMessage(jid, { 
                        text: `📊 *Get Analytics Report*\n\nUsage: report [shortcode]\nExample: report abc123\n\nCost: 20 tums\n\n_Get code from: my links_` 
                    })
                    return
                }

                console.log(`🔧 Debug - Report command: shortcode="${shortCode}"`)
                
                try {
                    const report = await AnalyticsService.generateAnalyticsReport(phoneNumber, shortCode)
                    const message = AnalyticsService.formatReportForWhatsApp(report, true)
                    
                    await sock.sendMessage(jid, { text: message })
                } catch (error) {
                    console.error(`❌ Report error for ${shortCode}:`, error.message)
                    await sock.sendMessage(jid, { 
                        text: `❌ ${error.message}\n\n_Make sure you own this link. Check: my links_` 
                    })
                }
                return
            }

            // QUICK STATS - FIXED with better parsing
            if (command.startsWith('stats ') || (parts.length === 2 && parts[0].toLowerCase() === 'stats')) {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { text: '📧 Register with email first!' })
                    return
                }

                // FIXED: Better shortcode extraction
                let shortCode
                if (parts.length >= 2) {
                    shortCode = parts[1].trim()
                } else {
                    await sock.sendMessage(jid, { 
                        text: `📊 *Quick Stats*\n\nUsage: stats [shortcode]\nExample: stats abc123\n\n_Free quick overview_\n_Get code from: my links_` 
                    })
                    return
                }

                console.log(`🔧 Debug - Stats command: shortcode="${shortCode}"`)
                
                try {
                    const stats = await AnalyticsService.getQuickStats(shortCode, phoneNumber)
                    
                    let message = `📊 *Quick Stats - ${stats.shortCode}*\n\n`
                    message += `👥 Total Clicks: ${stats.totalClicks}\n`
                    message += `🔄 Unique Visitors: ${stats.uniqueClicks}\n`
                    message += `🔍 Wey Checks: ${stats.weyChecks}\n`
                    message += `⏰ Days Left: ${stats.daysLeft}\n`
                    message += `🟢 Status: ${stats.isActive ? 'Active' : 'Inactive'}\n\n`
                    message += `_Detailed charts: report ${stats.shortCode}_`
                    
                    await sock.sendMessage(jid, { text: message })
                } catch (error) {
                    console.error(`❌ Stats error for ${shortCode}:`, error.message)
                    await sock.sendMessage(jid, { 
                        text: `❌ ${error.message}\n\n_Make sure you own this link. Check: my links_` 
                    })
                }
                return
            }

            // KILL LINK - FIXED with better parsing
            if (command.startsWith('kill ') || (parts.length === 2 && parts[0].toLowerCase() === 'kill')) {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { text: '📧 Register with email first!' })
                    return
                }

                // FIXED: Better shortcode extraction
                let shortCode
                if (parts.length >= 2) {
                    shortCode = parts[1].trim()
                } else {
                    await sock.sendMessage(jid, { 
                        text: `🚫 *Delete Link*\n\nUsage: kill [shortcode]\nExample: kill abc123\n\n⚠️ This action cannot be undone!\n\n_Get code from: my links_` 
                    })
                    return
                }

                console.log(`🔧 Debug - Kill command: shortcode="${shortCode}"`)
                
                try {
                    const result = await LinkService.killLink(phoneNumber, shortCode)
                    await sock.sendMessage(jid, { 
                        text: `✅ Link Deleted!\n\n🚫 *${shortCode}* is now permanently disabled.\n\nThe link will stop working immediately and no more daily fees will be charged.\n\n_Check remaining links: my links_` 
                    })
                } catch (error) {
                    console.error(`❌ Kill error for ${shortCode}:`, error.message)
                    await sock.sendMessage(jid, { 
                        text: `❌ ${error.message}\n\n_Make sure you own this link. Check: my links_` 
                    })
                }
                return
            }

            // CUSTOM LINK CREATION - FIXED command parsing
            if (command.startsWith('link ') || (parts.length >= 2 && parts[0].toLowerCase() === 'link')) {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { 
                        text: '📧 Register with your email first!\nExample: john@gmail.com' 
                    })
                    return
                }
                
                if (parts.length < 2) {
                    await sock.sendMessage(jid, { 
                        text: `🔗 *Create WhatsApp Link*\n\n*Usage:*\n• Random code: link +2348012345678\n• Custom code: link +2348012345678 mycode\n\n*Costs:*\n• Random: 50 tums\n• Custom: 250 tums (50 + 200)\n\nExample: link +2348012345678 dafe` 
                    })
                    return
                }

                const targetPhone = parts[1]
                const customShortCode = parts.length >= 3 ? parts[2] : null
                
                console.log(`🔧 Debug - Link command: target="${targetPhone}", custom="${customShortCode}"`)
                
                try {
                    const result = await LinkService.createWhatsAppLink(
                        phoneNumber, 
                        targetPhone, 
                        customShortCode
                    )
                    
                    let message = `✅ *WhatsApp Link Created!*\n\n`
                    message += `🔗 *Code:* ${result.shortCode}\n`
                    message += `📱 *Target:* +${targetPhone.replace(/\D/g, '')}\n\n`
                    message += `*Your Links:*\n`
                    message += `• Redirect: ${result.redirectUrl}\n`
                    message += `• Verify: ${result.weyUrl}\n\n`
                    message += `*Details:*\n`
                    message += `• Cost: ${result.cost} tums\n`
                    message += `• Type: ${customShortCode ? 'Custom' : 'Random'}\n`
                    message += `• Expires: ${new Date(result.expiresAt).toLocaleDateString()}\n`
                    message += `• Daily fee: 10 tums\n\n`
                    message += `*Commands:*\n`
                    message += `• stats ${result.shortCode}\n`
                    message += `• report ${result.shortCode}\n`
                    message += `• kill ${result.shortCode}`
                    
                    await sock.sendMessage(jid, { text: message })
                } catch (error) {
                    console.error(`❌ Link creation error:`, error.message)
                    await sock.sendMessage(jid, { 
                        text: `❌ ${error.message}` 
                    })
                }
                return
            }

            // SIMPLE PHONE NUMBER DETECTION (for backward compatibility)
            if (isPhoneNumber(text.trim()) && !command.startsWith('link ')) {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { 
                        text: '📧 Register with your email first!\nExample: john@gmail.com' 
                    })
                    return
                }

                const targetPhone = text.trim()
                
                try {
                    const result = await LinkService.createWhatsAppLink(phoneNumber, targetPhone)
                    
                    await sock.sendMessage(jid, { 
                        text: `✅ *Random Link Created!*\n\n🔗 *Code:* ${result.shortCode}\n📱 *Target:* +${targetPhone.replace(/\D/g, '')}\n\n*Links:*\n• ${result.redirectUrl}\n• ${result.weyUrl}\n\n*Cost:* ${result.cost} tums\n*Expires:* ${new Date(result.expiresAt).toLocaleDateString()}\n\n_Want custom code? Use: link +234xxx mycode_` 
                    })
                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ ${error.message}` 
                    })
                }
                return
            }

            // BALANCE CHECK
            if (command.match(/(balance|money|tums|coins|much.*have|check|wallet)/i)) {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { 
                        text: '📧 Register with your email first!\nExample: john@gmail.com' 
                    })
                    return
                }
                
                const balance = user.wallet_balance || 0
                await sock.sendMessage(jid, { 
                    text: `💰 *Your Balance*\n\n🪙 ${balance} tums\n\n*Services & Costs:*\n🔗 Random link: 50 tums\n🏷️ Custom code: +200 tums\n📊 Analytics report: 20 tums\n⚡ Daily maintenance: 10 tums\n\n💳 Add more: pay 500\n🎫 Free tums: coupon CODE` 
                })
                return
            }

            // MY LINKS - ENHANCED DISPLAY
            if (command.match(/(my.*links|list.*links|show.*links|links)/i)) {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { text: '📧 Register with email first!' })
                    return
                }

                try {
                    const links = await LinkService.getUserLinks(phoneNumber)
                    
                    if (links.length === 0) {
                        await sock.sendMessage(jid, { 
                            text: '🔗 *No Active Links*\n\nCreate your first link:\n• Random: +2348012345678\n• Custom: link +2348012345678 mycode\n\n_Need help? Send: help_' 
                        })
                        return
                    }

                    let message = `🔗 *Your Active Links* (${links.length})\n\n`
                    
                    links.slice(0, 10).forEach((link, index) => {
                        const daysLeft = Math.ceil((new Date(link.expires_at) - new Date()) / (1000 * 60 * 60 * 24))
                        message += `${index + 1}. *${link.short_code}*${link.is_custom_shortcode ? ' 🏷️' : ''}\n`
                        message += `   📱 → +${link.target_phone}\n`
                        message += `   👥 ${link.total_clicks || 0} clicks (${link.unique_clicks || 0} unique)\n`
                        message += `   🔍 ${link.wey_checks || 0} verifications\n`
                        message += `   ⏰ ${Math.max(0, daysLeft)} days left\n\n`
                    })

                    if (links.length > 10) {
                        message += `_...and ${links.length - 10} more links_\n\n`
                    }

                    message += `*Quick Commands:*\n`
                    message += `• stats [code] - Overview\n`
                    message += `• report [code] - Full analytics\n`
                    message += `• kill [code] - Delete link\n\n`
                    message += `*Example:* stats ${links[0].short_code}`

                    await sock.sendMessage(jid, { text: message })
                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ Error getting your links: ${error.message}` 
                    })
                }
                return
            }

            // PAYMENT HANDLING - Same as before
            if (command.match(/(pay|buy|add|money|top.*up|purchase)/i) && !command.startsWith('/')) {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { text: '📧 Register with email first!' })
                    return
                }

                await sock.sendMessage(jid, { 
                    text: `💳 *Buy Tums*\n\npay 500 → 2000 tums\npay 1000 → 4000 tums\npay 2000 → 8000 tums\n\nJust send "pay 500" to start!` 
                })
                return
            }

            // EXACT PAYMENT COMMAND
            if (command.startsWith('pay ')) {
                const payRateCheck = UserService.checkRateLimit(phoneNumber, 'payment')
                if (!payRateCheck.allowed) {
                    await sock.sendMessage(jid, { 
                        text: `💳 Wait ${payRateCheck.resetIn}s to prevent duplicate payments.` 
                    })
                    return
                }

                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { text: '📧 Register with email first!' })
                    return
                }

                try {
                    if (parts.length < 2) {
                        await sock.sendMessage(jid, { text: `💳 How much?\n\nTry: pay 500` })
                        return
                    }

                    const amountInKobo = PaymentService.parseAmount(parts[1])
                    const amountInNaira = amountInKobo / 100
                    const tumsToReceive = PaymentService.calculateCoins(amountInKobo)

                    const validation = PaymentService.validateCardPayment(amountInKobo)
                    if (!validation.isValid) {
                        await sock.sendMessage(jid, { text: `❌ ${validation.errors[0]}` })
                        return
                    }

                    const payment = await PaymentService.createPaymentLink(
                        user.email, 
                        phoneNumber, 
                        amountInKobo
                    )

                    await sock.sendMessage(jid, { 
                        text: `💳 Pay ₦${amountInNaira} to get ${tumsToReceive} tums:\n\n${payment.authorization_url}\n\n✅ Instant credit after payment` 
                    })

                } catch (error) {
                    await sock.sendMessage(jid, { text: `❌ ${error.message}` })
                }
                return
            }
            
            // COUPON HANDLING - Same as before
            if (command.startsWith('coupon ')) {
                const couponRateCheck = UserService.checkRateLimit(phoneNumber, 'coupon')
                if (!couponRateCheck.allowed) {
                    await sock.sendMessage(jid, { 
                        text: `🎫 Wait ${couponRateCheck.resetIn}s before trying another coupon.` 
                    })
                    return
                }

                if (parts.length < 2) {
                    await sock.sendMessage(jid, { text: `🎫 What's the code?\n\nTry: coupon SAVE100` })
                    return
                }

                const couponCode = parts[1].trim().toUpperCase()
                
                try {
                    const result = await CouponService.redeemCoupon(phoneNumber, couponCode)
                    
                    await sock.sendMessage(jid, { 
                        text: `🎉 Coupon worked!\n\n+${result.coupon.amount} tums\nNew balance: ${result.newBalance} tums` 
                    })

                } catch (error) {
                    await sock.sendMessage(jid, { text: `❌ ${error.message}` })
                }
                return
            }

            // HELP MENU - ENHANCED with proper commands
            if (command.match(/(help|menu|commands|what|how|start|hi|hello)/i)) {
                const existingUser = await UserService.getUserByPhone(phoneNumber)
                
                if (existingUser && existingUser.email) {
                    await sock.sendMessage(jid, { 
                        text: `👋 *Welcome to d-wey!*\n\n🔗 *WhatsApp Link Shortener*\n\n*Create Links:*\n• Random: +2348012345678\n• Custom: link +234xxx mycode\n\n*Manage Links:*\n• my links - View all your links\n• stats abc123 - Quick overview\n• report abc123 - Detailed charts\n• kill abc123 - Delete link\n\n*Account:*\n• balance - Check tums\n• pay 500 - Buy more tums\n• coupon ABC - Free tums\n\n*Pricing:*\n• Random link: 50 tums\n• Custom code: +200 tums\n• Analytics: 20 tums\n• Daily fee: 10 tums\n\nNeed help? Just ask! 🚀` 
                    })
                } else {
                    await sock.sendMessage(jid, { 
                        text: `👋 *Welcome to d-wey!*\n\n🔗 *WhatsApp Link Shortener & Analytics*\n\n*Get Started:*\n📧 Send your email to register\nExample: john@gmail.com\n\n*What d-wey does:*\n• Create trackable WhatsApp links\n• Advanced click analytics\n• Third-party verification\n• Custom short codes\n• Real-time reports\n\n🎁 Get 1000 free tums on signup!\n\n*Ready?* Send your email now! ✨` 
                    })
                }
                return
            }

            // COMMANDS HELP - Show specific command syntax
            if (command === 'commands') {
                await sock.sendMessage(jid, { 
                    text: `📋 *d-wey Commands*\n\n*Create Links:*\n• +2348012345678 (random)\n• link +234xxx mycode (custom)\n\n*Manage:*\n• my links\n• stats abc123\n• report abc123  \n• kill abc123\n\n*Account:*\n• balance\n• pay 500\n• coupon CODE\n\n*Help:*\n• help\n• how does it work\n• pricing\n\nAll commands are case-insensitive! 😊` 
                })
                return
            }

            // NATURAL LANGUAGE PROCESSING for other requests
            if (command.match(/(how.*work|what.*do|explain|info)/i)) {
                await sock.sendMessage(jid, { 
                    text: `🤖 *How d-wey Works*\n\n1️⃣ *Send* a phone number\n2️⃣ *Get* two special links:\n   • Redirect link (goes to WhatsApp)\n   • Wey link (for verification)\n\n3️⃣ *Share* the redirect link\n4️⃣ *Track* clicks and get reports\n5️⃣ *Verify* authenticity via wey link\n\n*Examples:*\n• Random: +2348012345678\n• Custom: link +234xxx dafe\n\n*Perfect for:*\n• Business promotions\n• Event invitations  \n• Customer support\n• Marketing campaigns\n\nTry it now! 📱` 
                })
                return
            }

            // PRICING INFO - ENHANCED
            if (command.match(/(price|cost|fee|pricing|how.*much)/i)) {
                await sock.sendMessage(jid, { 
                    text: `💰 *d-wey Pricing*\n\n*Link Creation:*\n🔗 Random code: 50 tums\n🏷️ Custom code: 250 tums (50+200)\n📊 Full analytics: 20 tums\n⚡ Daily maintenance: 10 tums\n🔍 Verification check: 5 tums\n\n*Tums Packages:*\n💳 ₦500 → 2,000 tums\n💳 ₦1,000 → 4,000 tums\n💳 ₦2,000 → 8,000 tums\n\n*Free Features:*\n• Quick stats\n• Link management\n• Basic support\n\n🎁 New users get 1,000 free tums!\n\nStart now: Send your email! 📧` 
                })
                return
            }

            // FALLBACK - Enhanced contextual help
            const user = await UserService.getUserByPhone(phoneNumber)
            if (!user || !user.email) {
                await sock.sendMessage(jid, { 
                    text: `📧 *Get Started with d-wey*\n\nSend your email to begin!\nExample: john@gmail.com\n\n✨ Get 1000 free tums on signup!\n\n_Then create your first link by sending a phone number_` 
                })
            } else if (user.wallet_balance < 50) {
                await sock.sendMessage(jid, { 
                    text: `💰 *Low Balance Alert*\n\nYou need at least 50 tums to create links.\nCurrent balance: ${user.wallet_balance} tums\n\nOptions:\n• pay 500 (get 2,000 tums)\n• coupon CODE (free tums)\n\nOr send "help" for free features!` 
                })
            } else {
                await sock.sendMessage(jid, { 
                    text: `🤔 *Not sure what you mean?*\n\nTry these:\n• +2348012345678 (random link)\n• link +234xxx mycode (custom)\n• my links (view all links)\n• help (full menu)\n\nOr ask: "how does d-wey work?" 💡` 
                })
            }
            
        } catch (error) {
            console.error('❌ Handler Error:', error)
            await sock.sendMessage(jid, { 
                text: '❌ Something went wrong. Please try again in a moment.' 
            })
        }
    }
}

// Helper function to detect phone numbers - MOVED OUTSIDE THE CLASS
function isPhoneNumber(text) {
    // Remove all non-numeric characters
    const cleaned = text.replace(/\D/g, '')
    
    // Check if it looks like a phone number (10-15 digits)
    if (cleaned.length >= 10 && cleaned.length <= 15) {
        // Additional validation: should not be all the same digit
        const allSameDigit = /^(.)\1+$/.test(cleaned)
        return !allSameDigit
    }
    
    return false
}

module.exports = { handleMessage }