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
                        `✅ *Email Registered Successfully!*\n\n📧 Email: ${email}\n📱 Phone: ${phoneNumber}\n👤 Name: ${displayName}\n💰 Wallet Balance: 0 coins\n\n*Available Commands:*\n💰 /pay [amount] - Add money to wallet\n🏦 /balance - Check wallet balance\n📊 /history - Transaction history\n\n_Send /pay 10 to add ₦10 to your wallet_` :
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
💰 Wallet Balance: *${balance} coins*

*Available Commands:*
💰 /pay [amount] - Add money to wallet
🏦 /balance - Check wallet balance
📊 /history - Transaction history
ℹ️ /myinfo - View your information

*Examples:*
/pay 10 (adds ₦10 → 40 coins)
/pay 25.50 (adds ₦25.50 → 102 coins)

_Conversion Rate: ₦1 = 4 coins | Minimum: ₦5_`

                    await sock.sendMessage(jid, { text: response })
                } else {
                    const response = `👋 *Hello ${displayName}!*

I'm your wallet bot for collecting emails and managing your coin balance.

*How to get started:*
📧 Send me your email address (e.g., john@example.com)

*After registering, you can:*
💰 Add money to your wallet
🏦 Check your balance
📊 View transaction history

*Conversion Rate:* ₦1 = 4 coins
*Minimum deposit:* ₦5`

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
/pay 10 (₦10 → 40 coins)
/pay 25.50 (₦25.50 → 102 coins)
/pay 100 (₦100 → 400 coins)

*Minimum:* ₦5.00
*Rate:* ₦1 = 4 coins` 
                        })
                        return
                    }

                    const amountInKobo = PaymentService.parseAmount(parts[1])
                    const amountInNaira = amountInKobo / 100
                    const coinsToReceive = PaymentService.calculateCoins(amountInKobo)

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
🪙 You'll receive: *${coinsToReceive} coins*
📧 Email: ${user.email}
🔐 Reference: ${payment.reference}

_Conversion: ₦1 = 4 coins_
_You'll get a confirmation once payment is successful_`

                    await sock.sendMessage(jid, { text: response })
                    console.log(`💰 Payment link sent: ₦${amountInNaira} → ${coinsToReceive} coins`)

                } catch (error) {
                    console.error('❌ Error creating payment:', error.message)
                    await sock.sendMessage(jid, { 
                        text: `❌ ${error.message}\n\n💡 Use: /pay [amount]\nExample: /pay 10` 
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
                const pendingTransactions = (user.transactions || []).filter(t => t.status === 'pending')
                const pendingAmount = pendingTransactions.reduce((sum, t) => sum + t.coins_amount, 0)

                let response = `🏦 *Wallet Balance*

💰 *Available Balance:* ${balance} coins`

                if (pendingAmount > 0) {
                    response += `\n⏳ *Pending:* ${pendingAmount} coins`
                }

                response += `\n\n*Recent Activity:*`
                
                const recentTransactions = (user.transactions || []).slice(0, 3)
                if (recentTransactions.length > 0) {
                    recentTransactions.forEach(t => {
                        const icon = t.type === 'credit' ? '💰' : '💸'
                        const status = t.status === 'pending' ? '⏳' : '✅'
                        response += `\n${status} ${icon} ${t.coins_amount} coins - ${t.description}`
                    })
                } else {
                    response += `\n_No transactions yet_`
                }

                response += `\n\n💰 Use /pay [amount] to add money\n📊 Use /history for full transaction history`

                await sock.sendMessage(jid, { text: response })
            }
            
            else if (command === '/history') {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { 
                        text: '📝 Please register your email first!' 
                    })
                    return
                }
                
                const transactions = await UserService.getTransactionHistory(phoneNumber, 10)
                
                if (transactions.length === 0) {
                    await sock.sendMessage(jid, { 
                        text: '📊 *Transaction History*\n\n_No transactions yet_\n\n💰 Use /pay [amount] to get started!' 
                    })
                    return
                }

                let response = `📊 *Transaction History*\n\n`
                
                transactions.forEach((t, index) => {
                    const icon = t.type === 'credit' ? '💰' : '💸'
                    const status = t.status === 'pending' ? '⏳ Pending' : '✅ Completed'
                    const date = new Date(t.created_at).toLocaleDateString('en-GB', {
                        day: '2-digit', month: '2-digit', year: '2-digit'
                    })
                    
                    response += `${icon} *${t.coins_amount} coins* ${status}\n`
                    response += `   ${t.description}\n`
                    response += `   ${date}\n\n`
                })

                response += `_Showing last ${transactions.length} transactions_`

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
                const transactions = user.transactions || []
                const totalDeposited = transactions
                    .filter(t => t.type === 'credit' && t.status === 'completed')
                    .reduce((sum, t) => sum + t.naira_amount, 0)

                const response = `👤 *Your Information*

📧 *Email:* ${user.email}
📱 *Phone:* ${user.phone_number}
👤 *Name:* ${user.display_name}
📅 *Registered:* ${new Date(user.created_at).toLocaleDateString()}

💰 *Wallet Balance:* ${balance} coins
💳 *Total Deposited:* ₦${totalDeposited}
📊 *Total Transactions:* ${transactions.length}

*Available Commands:*
💰 /pay [amount] - Add money
🏦 /balance - Check balance
📊 /history - View transactions

*Rate:* ₦1 = 4 coins | *Min:* ₦5`

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
📊 /history - Transaction history
ℹ️ /myinfo - Account information

*Examples:*
john.doe@gmail.com
/pay 20` 
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