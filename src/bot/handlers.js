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
                        `✅ *Email Registered Successfully!*\n\n📧 Email: ${email}\n📱 Phone: ${phoneNumber}\n👤 Name: ${displayName}\n\n_Thank you for registering! You can now make payments using /pay_` :
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
                    const response = `👋 *Welcome back ${displayName}!*

Your registered email: ${existingUser.email}

*Available Commands:*
💰 /pay - Make a payment
ℹ️ /myinfo - View your information

To update your email, simply send me your new email address.`

                    await sock.sendMessage(jid, { text: response })
                } else {
                    const response = `👋 *Hello ${displayName}!*

I'm here to collect your email address and process payments.

*How to register:*
📧 Simply send me your email address (e.g., john@example.com)

*Example:*
john.doe@gmail.com

After registering, you can make payments using /pay`

                    await sock.sendMessage(jid, { text: response })
                }
            }
            
            else if (command === '/pay') {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { 
                        text: '❌ Please register your email first by sending it to me (e.g., john@example.com)' 
                    })
                    return
                }

                try {
                    // Create payment link (₦10 = 1000 kobo)
                    const payment = await PaymentService.createPaymentLink(
                        user.email, 
                        phoneNumber, 
                        1000 // Amount in kobo
                    )

                    const response = `💰 *Payment Link Generated*

Click the link below to make your payment:
${payment.authorization_url}

💳 Amount: ₦10.00
📧 Email: ${user.email}
🔐 Reference: ${payment.reference}

_You'll receive a confirmation message once payment is successful._`

                    await sock.sendMessage(jid, { text: response })
                    console.log(`💰 Payment link sent to: ${phoneNumber}`)

                } catch (error) {
                    console.error('❌ Error creating payment:', error.message)
                    await sock.sendMessage(jid, { 
                        text: '❌ Sorry, I couldn\'t generate the payment link. Please try again.' 
                    })
                }
            }
            
            else if (command === '/myinfo') {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user) {
                    await sock.sendMessage(jid, { 
                        text: '📝 You haven\'t registered yet. Send me your email address to get started!' 
                    })
                    return
                }
                
                const paymentStatus = user.payment_status ? 
                    `💳 *Payment Status:* ${user.payment_status}\n💰 *Amount:* ₦${user.amount_paid ? user.amount_paid/100 : 0}\n📅 *Payment Date:* ${user.payment_date ? new Date(user.payment_date).toLocaleDateString() : 'N/A'}\n` : 
                    '💳 *Payment Status:* No payments yet\n'

                const response = `👤 *Your Information*

📧 *Email:* ${user.email}
📱 *Phone:* ${user.phone_number}
👤 *Name:* ${user.display_name}
📅 *Registered:* ${new Date(user.created_at).toLocaleDateString()}

${paymentStatus}

*Commands:*
💰 /pay - Make a payment
📧 Send new email to update`

                await sock.sendMessage(jid, { text: response })
            }
            
            else {
                // If it's not an email or recognized command, provide guidance
                await sock.sendMessage(jid, { 
                    text: `🤔 I didn't understand that message.

*Available Commands:*
📧 Send your email address to register
💬 /start - Welcome message
💰 /pay - Make a payment
ℹ️ /myinfo - View your information

*Example email:* john.doe@gmail.com` 
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