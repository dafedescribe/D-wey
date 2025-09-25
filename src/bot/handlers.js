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
            const command = text.toLowerCase().trim()

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
                            text: `✅ Welcome to d-wey ${displayName}!\n\n🎁 You got 1000 free tums!\n\n*Available Services:*\n💳 Buy more tums: pay 500\n🔗 Create WhatsApp links\n📊 Get analytics reports\n\nSend "help" to explore all features!` 
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

            // PHONE NUMBER DETECTION - Fixed function call
            if (isPhoneNumber(text.trim())) {
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
                        text: `✅ *WhatsApp Link Created!*\n\n🔗 *Redirect Link:* ${result.redirectUrl}\n📊 *Wey Link:* ${result.weyUrl}\n\n*Features:*\n• Clicks redirect to WhatsApp chat with +${targetPhone.replace(/\D/g, '')}\n• Track clicks & get reports\n• Third-party can verify via wey link\n\n*Cost:* ${result.cost} tums\n*Expires:* ${new Date(result.expiresAt).toLocaleDateString()}\n\n_Daily maintenance: 10 tums/day_` 
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
                    text: `💰 *Your Balance*\n\n🪙 ${balance} tums\n\n*Services & Costs:*\n🔗 Create link: 50 tums\n📊 Analytics report: 20 tums\n🏷️ Custom shortcode: +200 tums\n⚡ Daily maintenance: 10 tums\n\n💳 Add more: pay 500` 
                })
                return
            }

            // ANALYTICS REQUEST - New feature
            if (command.startsWith('report ') || command.startsWith('analytics ')) {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { text: '📧 Register with email first!' })
                    return
                }

                const parts = command.split(' ')
                if (parts.length < 2) {
                    await sock.sendMessage(jid, { 
                        text: `📊 *Get Analytics Report*\n\nUsage: report [shortcode]\nExample: report abc123\n\nCost: 20 tums` 
                    })
                    return
                }

                const shortCode = parts[1].trim()
                
                try {
                    const report = await AnalyticsService.generateAnalyticsReport(phoneNumber, shortCode)
                    const message = AnalyticsService.formatReportForWhatsApp(report, true)
                    
                    await sock.sendMessage(jid, { text: message })
                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ ${error.message}` 
                    })
                }
                return
            }

            // QUICK STATS - Free lightweight version
            if (command.startsWith('stats ')) {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { text: '📧 Register with email first!' })
                    return
                }

                const parts = command.split(' ')
                if (parts.length < 2) {
                    await sock.sendMessage(jid, { text: `📊 Usage: stats [shortcode]\nExample: stats abc123\n\n_Free quick overview_` })
                    return
                }

                const shortCode = parts[1].trim()
                
                try {
                    const stats = await AnalyticsService.getQuickStats(shortCode, phoneNumber)
                    
                    let message = `📊 *Quick Stats - ${stats.shortCode}*\n\n`
                    message += `👥 Total Clicks: ${stats.totalClicks}\n`
                    message += `🔄 Unique Visitors: ${stats.uniqueClicks}\n`
                    message += `🔍 Wey Checks: ${stats.weyChecks}\n`
                    message += `⏰ Days Left: ${stats.daysLeft}\n`
                    message += `🟢 Status: ${stats.isActive ? 'Active' : 'Inactive'}\n\n`
                    message += `_Want detailed charts? Send: report ${stats.shortCode}_`
                    
                    await sock.sendMessage(jid, { text: message })
                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ ${error.message}` 
                    })
                }
                return
            }

            // MY LINKS - List user's active links
            if (command.match(/(my.*links|list.*links|show.*links)/i)) {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { text: '📧 Register with email first!' })
                    return
                }

                try {
                    const links = await LinkService.getUserLinks(phoneNumber)
                    
                    if (links.length === 0) {
                        await sock.sendMessage(jid, { 
                            text: '🔗 No active links found.\n\nCreate one by sending a phone number!\nExample: +2348012345678' 
                        })
                        return
                    }

                    let message = `🔗 *Your Active Links* (${links.length})\n\n`
                    
                    links.slice(0, 5).forEach((link, index) => {
                        const daysLeft = Math.ceil((new Date(link.expires_at) - new Date()) / (1000 * 60 * 60 * 24))
                        message += `${index + 1}. *${link.short_code}*\n`
                        message += `   📱 Target: +${link.target_phone}\n`
                        message += `   👥 ${link.total_clicks} clicks (${link.unique_clicks} unique)\n`
                        message += `   ⏰ ${Math.max(0, daysLeft)} days left\n\n`
                    })

                    if (links.length > 5) {
                        message += `_...and ${links.length - 5} more links_\n\n`
                    }

                    message += `*Commands:*\n• stats [code] - Quick overview\n• report [code] - Detailed analytics\n• kill [code] - Delete link`

                    await sock.sendMessage(jid, { text: message })
                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ Error getting your links: ${error.message}` 
                    })
                }
                return
            }

            // KILL LINK - Delete a link permanently
            if (command.startsWith('kill ')) {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { text: '📧 Register with email first!' })
                    return
                }

                const parts = command.split(' ')
                if (parts.length < 2) {
                    await sock.sendMessage(jid, { 
                        text: `🚫 *Delete Link*\n\nUsage: kill [shortcode]\nExample: kill abc123\n\n⚠️ This action cannot be undone!` 
                    })
                    return
                }

                const shortCode = parts[1].trim()
                
                try {
                    const result = await LinkService.killLink(phoneNumber, shortCode)
                    await sock.sendMessage(jid, { 
                        text: `✅ ${result.message}\n\nLink is now permanently disabled and will stop working immediately.` 
                    })
                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ ${error.message}` 
                    })
                }
                return
            }

            // CUSTOM LINK CREATION - Advanced feature
            if (command.startsWith('create ')) {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { text: '📧 Register with email first!' })
                    return
                }

                const parts = command.split(' ')
                if (parts.length < 3) {
                    await sock.sendMessage(jid, { 
                        text: `🔗 *Create Custom Link*\n\nUsage: create [phone] [shortcode]\nExample: create +2348012345678 mycode\n\n*Costs:*\n• Basic link: 50 tums\n• Custom code: +200 tums\n• Total: 250 tums` 
                    })
                    return
                }

                const targetPhone = parts[1].trim()
                const customShortCode = parts[2].trim()
                
                try {
                    const result = await LinkService.createWhatsAppLink(
                        phoneNumber, 
                        targetPhone, 
                        customShortCode
                    )
                    
                    await sock.sendMessage(jid, { 
                        text: `✅ *Custom Link Created!*\n\n🔗 *Your Code:* ${result.shortCode}\n📱 *Target:* +${targetPhone.replace(/\D/g, '')}\n\n*Links:*\n• Redirect: ${result.redirectUrl}\n• Wey: ${result.weyUrl}\n\n*Cost:* ${result.cost} tums\n*Expires:* ${new Date(result.expiresAt).toLocaleDateString()}` 
                    })
                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ ${error.message}` 
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
                    const parts = command.split(' ')
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

                const parts = command.split(' ')
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

            // HELP MENU - Enhanced with d-wey features
            if (command.match(/(help|menu|commands|what|how|start|hi|hello)/i)) {
                const existingUser = await UserService.getUserByPhone(phoneNumber)
                
                if (existingUser && existingUser.email) {
                    await sock.sendMessage(jid, { 
                        text: `👋 *Welcome to d-wey!*\n\n🔗 *WhatsApp Link Shortener*\n\n*Create Links:*\n• Send a phone number: +2348012345678\n• Custom link: create +234xxx mycode\n\n*Manage Links:*\n• my links - View all your links\n• stats abc123 - Quick overview\n• report abc123 - Detailed analytics\n• kill abc123 - Delete link\n\n*Account:*\n• balance - Check tums\n• pay 500 - Buy more tums\n• coupon ABC - Redeem coupon\n\n*Pricing:*\n• Create link: 50 tums\n• Custom code: +200 tums\n• Analytics: 20 tums\n• Daily fee: 10 tums\n\nNeed help? Just ask! 🚀` 
                    })
                } else {
                    await sock.sendMessage(jid, { 
                        text: `👋 *Welcome to d-wey!*\n\n🔗 *WhatsApp Link Shortener & Analytics*\n\n*Get Started:*\n📧 Send your email to register\nExample: john@gmail.com\n\n*What d-wey does:*\n• Create trackable WhatsApp links\n• Advanced click analytics\n• Third-party verification\n• Custom short codes\n• Real-time reports\n\n🎁 Get 1000 free tums on signup!\n\n*Ready?* Send your email now! ✨` 
                    })
                }
                return
            }

            // NATURAL LANGUAGE PROCESSING for other requests
            if (command.match(/(how.*work|what.*do|explain|info)/i)) {
                await sock.sendMessage(jid, { 
                    text: `🤖 *How d-wey Works*\n\n1️⃣ *Send* a phone number\n2️⃣ *Get* two special links:\n   • Redirect link (goes to WhatsApp)\n   • Wey link (for verification)\n\n3️⃣ *Share* the redirect link\n4️⃣ *Track* clicks and get reports\n5️⃣ *Verify* authenticity via wey link\n\n*Example:*\nYou: +2348012345678\nGet: d-wey.com/abc123 (redirect)\n     d-wey.com/wey/abc123 (verify)\n\n*Perfect for:*\n• Business promotions\n• Event invitations\n• Customer support\n• Marketing campaigns\n\nWant to try? Send a phone number! 📱` 
                })
                return
            }

            // PRICING INFO
            if (command.match(/(price|cost|fee|pricing|how.*much)/i)) {
                await sock.sendMessage(jid, { 
                    text: `💰 *d-wey Pricing*\n\n*Link Creation:*\n🔗 Basic link: 50 tums\n🏷️ Custom shortcode: +200 tums\n📊 Analytics report: 20 tums\n⚡ Daily maintenance: 10 tums\n🔍 Third-party check: 5 tums\n\n*Tums Packages:*\n💳 ₦500 → 2000 tums\n💳 ₦1000 → 4000 tums\n💳 ₦2000 → 8000 tums\n\n*Free Features:*\n• Quick stats (stats abc123)\n• Link list (my links)\n• Basic support\n\n🎁 New users get 1000 free tums!\n\nReady to start? Send your email! 📧` 
                })
                return
            }

            // FALLBACK - Contextual help based on user status
            const user = await UserService.getUserByPhone(phoneNumber)
            if (!user || !user.email) {
                await sock.sendMessage(jid, { 
                    text: `📧 *Get Started with d-wey*\n\nSend your email to begin!\nExample: john@gmail.com\n\n✨ Get 1000 free tums on signup!` 
                })
            } else if (user.wallet_balance < 50) {
                await sock.sendMessage(jid, { 
                    text: `💰 *Low Balance Alert*\n\nYou need at least 50 tums to create links.\n\nOptions:\n• pay 500 (get 2000 tums)\n• coupon CODE (free tums)\n\nOr send "help" to explore free features!` 
                })
            } else {
                await sock.sendMessage(jid, { 
                    text: `🤔 *Not sure what you mean?*\n\nTry:\n• Send a phone number to create a link\n• my links - See your links\n• help - Full menu\n• balance - Check tums\n\nOr just ask: "how does d-wey work?"` 
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