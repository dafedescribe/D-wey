const UserService = require('../services/userService')
const PaymentService = require('../services/paymentService')

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

            // Check if message contains an email
            if (UserService.isValidEmail(text.trim())) {
                const email = text.trim().toLowerCase()
                console.log(`📧 Email detected: ${email}`)
                
                // Check if email is already taken
                const isEmailTaken = await UserService.isEmailTaken(email)
                if (isEmailTaken) {
                    await sock.sendMessage(jid, { 
                        text: '❌ This email is already registered with another number. Please use a different email address.' 
                    })
                    return
                }

                // Store the email
                const result = await UserService.storeUserEmail(phoneNumber, displayName, email)
                
                if (result) {
                    const message = result.isNew ? 
                        `✅ *Email Registered Successfully!*\n\n📧 Email: ${email}\n📱 Phone: ${phoneNumber}\n👤 Name: ${displayName}\n💰 Wallet Balance: 0 tums\n\n*Available Commands:*\n💰 /pay [amount] - Add money to wallet\n🏦 /balance - Check wallet balance\n\n_Send /pay 500 to add ₦500 to your wallet_` :
                        `✅ *Email Updated Successfully!*\n\n📧 New Email: ${email}\n📱 Phone: ${phoneNumber}\n👤 Name: ${displayName}\n\n_Your email has been updated in our records._`

                    await sock.sendMessage(jid, { text: message })
                } else {
                    await sock.sendMessage(jid, { 
                        text: '❌ Sorry, I couldn\'t save your email. Please try again.' 
                    })
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

*Available Commands:*
💰 /pay [amount] - Add money to wallet
🏦 /balance - Check wallet balance
ℹ️ /myinfo - View your information

*Examples:*
/pay 500 (adds ₦500 → 2000 tums)
/pay 1000 (adds ₦1000 → 4000 tums)

_Conversion Rate: ₦1 = 4 tums | Minimum: ₦500_`

                    await sock.sendMessage(jid, { text: response })
                } else {
                    const response = `👋 *Hello ${displayName}!*

I'm your wallet bot for collecting emails and managing your tums balance.

*How to get started:*
📧 Send me your email address (e.g., john@example.com)

*After registering, you can:*
💰 Add money to your wallet
🏦 Check your balance

*Conversion Rate:* ₦1 = 4 tums
*Minimum deposit:* ₦500`

                    await sock.sendMessage(jid, { text: response })
                }
            }
            
            else if (command.startsWith('/pay')) {
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
                            text: `💰 *How to add money to wallet:*

*Format:* /pay [amount]

*Examples:*
/pay 500 (₦500 → 2000 tums)
/pay 1000 (₦1000 → 4000 tums)
/pay 2500 (₦2500 → 10000 tums)

*Minimum:* ₦500.00
*Rate:* ₦1 = 4 tums` 
                        })
                        return
                    }

                    const amountInKobo = PaymentService.parseAmount(parts[1])
                    const amountInNaira = amountInKobo / 100
                    const tumsToReceive = PaymentService.calculateCoins(amountInKobo)

                    // Create payment link
                    const payment = await PaymentService.createPaymentLink(
                        user.email, 
                        phoneNumber, 
                        amountInKobo
                    )

                    const response = `💰 *Payment Link Generated*

Click the link below to add money to your wallet:
${payment.authorization_url}

💳 Amount: ₦${amountInNaira}
🪙 You'll receive: *${tumsToReceive} tums*
📧 Email: ${user.email}
🔐 Reference: ${payment.reference}

_Conversion: ₦1 = 4 tums_
_You'll get a confirmation once payment is successful_`

                    await sock.sendMessage(jid, { text: response })
                    console.log(`💰 Payment link sent: ₦${amountInNaira} → ${tumsToReceive} tums`)

                } catch (error) {
                    console.error('❌ Error creating payment:', error.message)
                    await sock.sendMessage(jid, { 
                        text: `❌ ${error.message}\n\n💡 Use: /pay [amount]\nExample: /pay 500` 
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

💰 Use /pay [amount] to add money`

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

                const response = `👤 *Your Information*

📧 *Email:* ${user.email}
📱 *Phone:* ${user.phone_number}
👤 *Name:* ${user.display_name}
📅 *Registered:* ${new Date(user.created_at).toLocaleDateString()}

💰 *Wallet Balance:* ${balance} tums

*Available Commands:*
💰 /pay [amount] - Add money
🏦 /balance - Check balance

*Rate:* ₦1 = 4 tums | *Min:* ₦500`

                await sock.sendMessage(jid, { text: response })
            }
            
            else {
                // If it's not an email or recognized command, provide guidance
                await sock.sendMessage(jid, { 
                    text: `🤔 I didn't understand that message.

*Available Commands:*
📧 Send your email to register
💬 /start - Welcome message
💰 /pay [amount] - Add money to wallet
🏦 /balance - Check wallet balance
ℹ️ /myinfo - Account information

*Examples:*
john.doe@gmail.com
/pay 500` 
                })
            }
            
        } catch (error) {
            console.error('❌ Error processing message:', error)
            await sock.sendMessage(jid, { 
                text: '❌ Sorry, something went wrong. Please try again or contact support.' 
            })
        }
    }
}

module.exports = { handleMessage }