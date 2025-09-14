const UserService = require('../services/userService')
const PaymentService = require('../services/paymentService')
const CouponService = require('../services/couponService')

function handleMessage(sock) {
    return async (m) => {
        const msg = m.messages[0]
        
        // Skip if no message, status broadcast, or from ourselves
        if (!msg?.message || 
            msg.key.remoteJid === 'status@broadcast' || 
            msg.key.fromMe) return

        // Only process new messages
        if (m.type !== 'notify') return

        const text = msg.message?.conversation || 
                    msg.message?.extendedTextMessage?.text || ''
        
        const jid = msg.key.remoteJid
        const phoneNumber = jid.split('@')[0].replace(/\D/g, '')
        const displayName = msg.pushName || null
        
        console.log(`📨 From: ${phoneNumber} (${displayName})`)
        console.log(`📝 Message: ${text}`)

        try {
            const command = text.toLowerCase().trim()

            // Rate limiting check for all interactions
            const rateLimitCheck = UserService.checkRateLimit(phoneNumber, 'general')
            if (!rateLimitCheck.allowed) {
                await sock.sendMessage(jid, { text: rateLimitCheck.message })
                return
            }

            // Check if message contains an email
            if (UserService.isValidEmail(text.trim())) {
                // Additional rate limiting for email operations
                const emailRateCheck = UserService.checkRateLimit(phoneNumber, 'email')
                if (!emailRateCheck.allowed) {
                    await sock.sendMessage(jid, { text: `⚠️ Too many email attempts. ${emailRateCheck.message}` })
                    return
                }

                const email = text.trim().toLowerCase()
                console.log(`📧 Email detected: ${email}`)
                
                try {
                    // Check if email is already taken by another user
                    const isEmailTaken = await UserService.isEmailTaken(email)
                    if (isEmailTaken) {
                        await sock.sendMessage(jid, { 
                            text: '❌ This email is already registered with another number. Please use a different email address.' 
                        })
                        return
                    }

                    // Store the email
                    const result = await UserService.storeUserEmail(phoneNumber, displayName, email)
                    
                    if (result.isNew) {
                        // New user with signup bonus
                        const message = `🎉 *Welcome! Email Registered Successfully!*

📧 Email: ${email}
📱 Phone: ${phoneNumber}
👤 Name: ${displayName}
💰 Wallet Balance: *${result.signupBonus} tums* (Welcome Bonus!)

🎁 *You received ${result.signupBonus} free tums as a welcome gift!*

*💳 Payment Method: Card Only*
We only accept Credit/Debit Card payments (Visa, Mastercard, Verve)

*Available Commands:*
💰 /pay [amount] - Add money via card
🏦 /balance - Check wallet balance
🎫 /coupon [code] - Redeem coupon codes

*Examples:*
/pay 500 (₦500 → 2000 tums)
/pay 1000 (₦1000 → 4000 tums)
/coupon WELCOME50

*Card Payment Details:*
• Minimum: ₦500.00
• Rate: ₦1 = 4 tums
• Secure payment via Paystack
• Instant credit after successful payment

_🎊 Enjoy your welcome bonus and start exploring!_`

                        await sock.sendMessage(jid, { text: message })
                    } else {
                        // Existing user trying to change email
                        if (result.user.email) {
                            await sock.sendMessage(jid, { 
                                text: `❌ Email cannot be changed. Your registered email is: ${result.user.email}\n\n💡 Use /balance to check your current wallet balance.` 
                            })
                        } else {
                            await sock.sendMessage(jid, { 
                                text: `✅ Welcome back! Your email: ${email}\n\n💰 Wallet Balance: ${result.user.wallet_balance || 0} tums\n\n💡 Use /balance for more details.` 
                            })
                        }
                    }
                } catch (error) {
                    if (error.message.includes('cannot be changed')) {
                        await sock.sendMessage(jid, { text: error.message })
                    } else {
                        await sock.sendMessage(jid, { 
                            text: '❌ Sorry, I couldn\'t process your email. Please try again.' 
                        })
                    }
                }
                
                return
            }

            // Command handling
            if (command === '/start' || command.includes('hi') || command.includes('hello')) {
                const existingUser = await UserService.getUserByPhone(phoneNumber)
                
                if (existingUser && existingUser.email) {
                    const balance = existingUser.wallet_balance || 0
                    const response = `👋 *Welcome back ${displayName}!*

📧 Email: ${existingUser.email}
💰 Wallet Balance: *${balance} tums*

*💳 Payment Method: Card Only*
We accept Visa, Mastercard, and Verve cards

*Available Commands:*
💰 /pay [amount] - Add money via card
🏦 /balance - Check wallet balance
🎫 /coupon [code] - Redeem coupon codes
ℹ️ /myinfo - View your information

*Card Payment Examples:*
/pay 500 (adds ₦500 → 2000 tums)
/pay 1000 (adds ₦1000 → 4000 tums)
/pay 2500 (adds ₦2500 → 10000 tums)

*Coupon Example:*
/coupon SAVE100

*Card Payment Info:*
• Conversion Rate: ₦1 = 4 tums
• Minimum: ₦500.00
• Secure & Instant
• Standard card fees apply`

                    await sock.sendMessage(jid, { text: response })
                } else {
                    const response = `👋 *Hello ${displayName}!*

I'm your wallet bot for collecting emails and managing your tums balance.

*How to get started:*
📧 Send me your email address (e.g., john@example.com)

*After registering, you'll get:*
🎁 1000 free tums as welcome bonus!
💳 Ability to add money via secure card payment
🏦 Wallet balance tracking
🎫 Coupon redemption

*💳 Payment Method: Card Only*
• We accept Visa, Mastercard, Verve
• Minimum deposit: ₦500.00  
• Conversion Rate: ₦1 = 4 tums
• Secure payment via Paystack
• Instant wallet credit`

                    await sock.sendMessage(jid, { text: response })
                }
            }
            
            else if (command.startsWith('/pay')) {
                // Rate limiting for payment commands
                const payRateCheck = UserService.checkRateLimit(phoneNumber, 'payment')
                if (!payRateCheck.allowed) {
                    await sock.sendMessage(jid, { text: `💳 ${payRateCheck.message}\n\nThis prevents accidental duplicate payments.` })
                    return
                }

                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { 
                        text: '❌ Please register your email first by sending it to me (e.g., john@example.com)' 
                    })
                    return
                }

                try {
                    // Parse amount from command
                    const parts = command.split(' ')
                    if (parts.length < 2) {
                        await sock.sendMessage(jid, { 
                            text: `💳 *How to pay with card:*

*Format:* /pay [amount]

*Card Payment Examples:*
/pay 500 (₦500 → 2000 tums)
/pay 1000 (₦1000 → 4000 tums)
/pay 2500 (₦2500 → 10000 tums)
/pay 5000 (₦5000 → 20000 tums)

*Card Payment Info:*
• Minimum: ₦500.00
• Rate: ₦1 = 4 tums
• Accepted: Visa, Mastercard, Verve
• Secure payment via Paystack
• Instant credit after payment

*How it works:*
1. Send /pay [amount]
2. Click the secure payment link
3. Enter your card details
4. Get instant tums credit` 
                        })
                        return
                    }

                    const amountInKobo = PaymentService.parseAmount(parts[1])
                    const amountInNaira = amountInKobo / 100
                    const tumsToReceive = PaymentService.calculateCoins(amountInKobo)

                    // Validate card payment
                    const validation = PaymentService.validateCardPayment(amountInKobo)
                    if (!validation.isValid) {
                        await sock.sendMessage(jid, { 
                            text: `❌ *Card Payment Error*\n\n${validation.errors.join('\n')}\n\n💡 Use: /pay [amount]\nExample: /pay 500` 
                        })
                        return
                    }

                    // Create secure card payment link
                    const payment = await PaymentService.createPaymentLink(
                        user.email, 
                        phoneNumber, 
                        amountInKobo
                    )

                    const response = `💳 *Secure Card Payment Link*

Click the link below to pay with your card:
${payment.authorization_url}

*Payment Details:*
💰 Amount: ₦${amountInNaira}
🪙 You'll receive: *${tumsToReceive} tums*
📧 Email: ${user.email}
🔐 Reference: ${payment.reference}

*Accepted Cards:*
💳 Visa, Mastercard, Verve
🔒 Secure 256-bit SSL encryption
⚡ Instant wallet credit

*Payment Steps:*
1. Click the link above
2. Enter your card details
3. Complete secure payment
4. Get instant tums credit

_Standard card processing fees apply_
_You'll get a confirmation once payment is successful_`

                    await sock.sendMessage(jid, { text: response })
                    console.log(`💳 Card payment link sent: ₦${amountInNaira} → ${tumsToReceive} tums`)

                } catch (error) {
                    console.error('❌ Error creating card payment:', error.message)
                    await sock.sendMessage(jid, { 
                        text: `❌ ${error.message}\n\n💡 Use: /pay [amount]\nExample: /pay 500\n\n💳 Only card payments accepted` 
                    })
                }
            }
            
            else if (command.startsWith('/coupon')) {
                // Rate limiting for coupon redemption
                const couponRateCheck = UserService.checkRateLimit(phoneNumber, 'coupon')
                if (!couponRateCheck.allowed) {
                    await sock.sendMessage(jid, { text: `🎫 ${couponRateCheck.message}\n\nThis prevents coupon spam.` })
                    return
                }

                const parts = command.split(' ')
                if (parts.length < 2) {
                    await sock.sendMessage(jid, { 
                        text: `🎫 *How to redeem coupons:*

*Format:* /coupon [code]

*Examples:*
/coupon WELCOME50
/coupon SAVE100
/coupon BONUS25

*Tips:*
• Coupon codes are case-insensitive
• Each coupon can only be used once per user
• Some coupons have expiry dates
• You must register your email first

💡 *Need to register?* Send your email address first!` 
                    })
                    return
                }

                const couponCode = parts[1].trim().toUpperCase()
                
                try {
                    const result = await CouponService.redeemCoupon(phoneNumber, couponCode)
                    
                    const message = `🎉 *Coupon Redeemed Successfully!*

🎫 Code: ${couponCode}
🪙 Tums Added: *${result.coupon.amount} tums*
💰 New Balance: *${result.newBalance} tums*
📅 Redeemed: ${new Date().toLocaleString()}

${result.coupon.description ? `📋 ${result.coupon.description}` : ''}

*Available Commands:*
🏦 /balance - Check current balance
💳 /pay [amount] - Add more via card
🎫 /coupon [code] - Redeem more coupons

_Thanks for using our coupon system!_ 🎊`

                    await sock.sendMessage(jid, { text: message })
                    console.log(`🎫 Coupon redeemed: ${phoneNumber} - ${couponCode} - ${result.coupon.amount} tums`)

                } catch (error) {
                    console.error('❌ Coupon redemption error:', error.message)
                    await sock.sendMessage(jid, { 
                        text: `${error.message}\n\n💡 *Tips:*\n• Check your spelling\n• Make sure you're registered (send your email first)\n• Each coupon can only be used once\n\n🎫 Use: /coupon [code]` 
                    })
                }
            }
            
            else if (command === '/balance') {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { 
                        text: '📝 Please register your email first by sending it to me!' 
                    })
                    return
                }
                
                const balance = user.wallet_balance || 0

                const response = `🏦 *Wallet Balance*

💰 *Available Balance:* ${balance} tums

💳 *Add Money via Card:*
Use /pay [amount] to add money
• Minimum: ₦500 (2000 tums)
• Rate: ₦1 = 4 tums
• Accepted: Visa, Mastercard, Verve

🎫 *Redeem Coupons:*
Use /coupon [code] to get free tums

*Quick Top-up:*
/pay 500 → 2000 tums
/pay 1000 → 4000 tums
/pay 2500 → 10000 tums

*Coupon Example:*
/coupon SAVE100`

                await sock.sendMessage(jid, { text: response })
            }
            
            else if (command === '/myinfo') {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user) {
                    await sock.sendMessage(jid, { 
                        text: '📝 You haven\'t registered yet. Send me your email address to get started!' 
                    })
                    return
                }
                
                const balance = user.wallet_balance || 0
                const transactionCount = user.transactions ? user.transactions.length : 0
                const couponCount = user.transactions ? 
                    user.transactions.filter(t => t.payment_method === 'coupon').length : 0

                const response = `👤 *Your Information*

📧 *Email:* ${user.email}
📱 *Phone:* ${user.phone_number}
👤 *Name:* ${user.display_name}
📅 *Registered:* ${new Date(user.created_at).toLocaleDateString()}

💰 *Wallet Balance:* ${balance} tums
📊 *Transactions:* ${transactionCount}
🎫 *Coupons Used:* ${couponCount}

*💳 Payment Method: Card Only*
• Visa, Mastercard, Verve accepted
• Minimum payment: ₦500.00
• Rate: ₦1 = 4 tums
• Secure via Paystack

*Available Commands:*
💰 /pay [amount] - Add money via card
🏦 /balance - Check balance
🎫 /coupon [code] - Redeem coupons

*Quick Examples:*
/pay 1000 (₦1000 → 4000 tums)
/pay 2500 (₦2500 → 10000 tums)
/coupon WELCOME50`

                await sock.sendMessage(jid, { text: response })
            }

            else if (command === '/cards' || command === '/payment' || command === '/methods') {
                const methods = PaymentService.getSupportedPaymentMethods()
                
                const response = `💳 *Supported Payment Methods*

*Card Payment Only:*
✅ Credit Cards (Visa, Mastercard)
✅ Debit Cards (Visa, Mastercard, Verve)
✅ Nigerian bank cards

*Payment Details:*
💰 Minimum: ₦${methods.card.min_amount}
🪙 Rate: ₦1 = ${methods.card.conversion_rate} tums
🔒 Security: 256-bit SSL encryption
⚡ Speed: Instant credit

*How to Pay:*
1. Use /pay [amount]
2. Click secure payment link
3. Enter card details
4. Get instant tums

*Examples:*
/pay 500 → Pay ₦500, get 2000 tums
/pay 1000 → Pay ₦1000, get 4000 tums

*Free Tums:*
🎫 Use /coupon [code] to redeem coupons

_${methods.card.fees}_`

                await sock.sendMessage(jid, { text: response })
            }

            else if (command === '/help' || command === 'help') {
                const response = `📖 *Help & Commands*

*Getting Started:*
📧 Send your email to register and get 1000 free tums

*Main Commands:*
👋 /start - Welcome message
💰 /pay [amount] - Add money via card
🏦 /balance - Check wallet balance
🎫 /coupon [code] - Redeem coupon codes
ℹ️ /myinfo - Account information
💳 /cards - Payment methods info
❓ /help - This help menu

*Examples:*
john.doe@gmail.com (register email)
/pay 500 (add ₦500 → 2000 tums)
/balance (check balance)
/coupon WELCOME50 (redeem coupon)

*Payment Info:*
💳 Card payments only (Visa, Mastercard, Verve)
💰 Minimum: ₦500 → 2000 tums
🎁 Welcome bonus: 1000 tums

*Rate Limiting:*
⚠️ 5 messages per minute to prevent spam

*Note:*
🔒 Email cannot be changed once registered`

                await sock.sendMessage(jid, { text: response })
            }
            
            else {
                // If it's not an email or recognized command, provide guidance
                await sock.sendMessage(jid, { 
                    text: `🤔 I didn't understand that message.

*Available Commands:*
📧 Send your email to register (get 1000 free tums!)
💬 /start - Welcome message
💳 /pay [amount] - Add money via card
🏦 /balance - Check wallet balance
🎫 /coupon [code] - Redeem coupon codes
ℹ️ /myinfo - Account information
💳 /cards - Payment methods info
❓ /help - Help & commands

*Payment Method:*
💳 Card payments only (Visa, Mastercard, Verve)

*Examples:*
john.doe@gmail.com
/pay 500
/balance
/coupon SAVE100` 
                })
            }
            
        } catch (error) {
            console.error('❌ Error processing message:', error)
            
            // Check if it's a rate limit error
            if (error.message && error.message.includes('Rate limit')) {
                await sock.sendMessage(jid, { text: error.message })
            } else {
                await sock.sendMessage(jid, { 
                    text: '❌ Sorry, something went wrong. Please try again or contact support.\n\n💳 Remember: We only accept card payments (Visa, Mastercard, Verve)' 
                })
            }
        }
    }
}

module.exports = { handleMessage }