const crypto = require('crypto')
const PaymentService = require('../services/paymentService')
const { supabase } = require('../config/database')

// Store WhatsApp socket instance
let whatsappSocket = null

function setWhatsAppSocket(sock) {
    whatsappSocket = sock
}

async function handlePaystackWebhook(req, res) {
    try {
        // Verify webhook signature
        const hash = crypto
            .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
            .update(JSON.stringify(req.body))
            .digest('hex')

        if (hash !== req.headers['x-paystack-signature']) {
            console.log('❌ Invalid webhook signature')
            return res.status(400).send('Invalid signature')
        }

        const event = req.body

        if (event.event === 'charge.success') {
            const { reference, status, amount } = event.data
            
            console.log(`💰 Payment webhook: ${reference} - ${status} - ₦${amount/100}`)

            // Complete the payment and credit wallet
            const result = await PaymentService.completePayment(reference)
            
            if (result && whatsappSocket) {
                const { user, transaction, newBalance } = result
                
                // Send confirmation message to user
                const phoneJid = `${user.phone_number}@s.whatsapp.net`
                const message = `🎉 *Payment Successful!*

✅ *Wallet Credited Successfully*
💰 Amount Paid: ₦${transaction.naira_amount}
🪙 Tums Added: *${transaction.tums_amount} tums*
🏦 New Balance: *${newBalance} tums*

🔐 Reference: ${reference}
👤 Name: ${user.display_name}
📅 ${new Date().toLocaleString()}

_Thank you for your payment! Your tums are now available._

*Available Commands:*
🏦 /balance - Check balance
💰 /pay [amount] - Add more money`

                await whatsappSocket.sendMessage(phoneJid, { text: message })
                console.log(`✅ Wallet credited: ${user.phone_number} - ${transaction.tums_amount} tums`)
            } else {
                console.log(`⚠️ Payment completed but no user found or WhatsApp not connected: ${reference}`)
            }
        }

        else if (event.event === 'charge.failed') {
            const { reference, status } = event.data
            console.log(`❌ Payment failed: ${reference} - ${status}`)

            // Find and update the failed transaction
            const pendingData = await PaymentService.getPendingTransaction(reference)
            
            if (pendingData && whatsappSocket) {
                const { user } = pendingData
                
                // Update transaction status to failed
                const updatedTransactions = user.transactions.map(t => 
                    t.reference === reference ? { ...t, status: 'failed' } : t
                )

                // Update database with failed status
                await supabase
                    .from('users')
                    .update({
                        transactions: updatedTransactions,
                        updated_at: new Date().toISOString()
                    })
                    .eq('phone_number', user.phone_number)

                // Notify user of failed payment
                const phoneJid = `${user.phone_number}@s.whatsapp.net`
                const message = `❌ *Payment Failed*

Your payment could not be processed.

🔐 Reference: ${reference}
📅 ${new Date().toLocaleString()}

💡 *What you can do:*
• Try the payment again with /pay [amount]
• Check your card details and try again
• Contact your bank if the issue persists
• Use /balance to check your current wallet

_No money was deducted from your account._`

                await whatsappSocket.sendMessage(phoneJid, { text: message })
                console.log(`❌ Payment failure notification sent: ${user.phone_number}`)
            }
        }

        else {
            console.log(`ℹ️ Unhandled webhook event: ${event.event}`)
        }

        res.status(200).send('OK')
    } catch (error) {
        console.error('❌ Webhook error:', error.message)
        res.status(500).send('Webhook error')
        res.status(500).send('Webhook error')
    }
}

module.exports = { handlePaystackWebhook, setWhatsAppSocket }